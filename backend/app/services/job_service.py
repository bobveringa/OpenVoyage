from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from apscheduler.triggers.cron import CronTrigger
from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from jobs.definitions import JOB_DEFINITIONS, JOB_DEFINITIONS_BY_KEY, JobDefinition
from models.database.base import utcnow
from models.database.jobs import (
    JobExecution,
    JobExecutionStatus,
    JobExecutionTrigger,
    ScheduledJob,
)


class JobNotFoundError(LookupError):
    pass


class JobScheduleValidationError(ValueError):
    pass


class JobConflictError(RuntimeError):
    def __init__(self, execution: JobExecution) -> None:
        self.execution = execution
        super().__init__('Job already has an active execution')


@dataclass(frozen=True)
class JobRecord:
    definition: JobDefinition
    job: ScheduledJob
    active_execution: JobExecution | None
    latest_execution: JobExecution | None
    next_run_at: datetime | None
    schedule_error: str | None


class JobService:
    def __init__(self, db: Session, *, scheduler=None, wake_runner=None) -> None:
        self.db = db
        self.scheduler = scheduler
        self.wake_runner = wake_runner

    @staticmethod
    def validate_schedule(
        definition: JobDefinition, cron: str, timezone_name: str
    ) -> tuple[str, str, CronTrigger]:
        cron = cron.strip() if isinstance(cron, str) else ''
        timezone_name = timezone_name.strip() if isinstance(timezone_name, str) else ''
        if not cron or len(cron) > 255 or len(cron.split()) != 5:
            raise JobScheduleValidationError(
                'Cron must be a valid five-field expression'
            )
        weekday = cron.split()[4].lower()
        if any(
            token.isdigit()
            for token in weekday.replace(',', ' ')
            .replace('-', ' ')
            .replace('/', ' ')
            .split()
        ):
            raise JobScheduleValidationError('Cron weekday must use symbolic names')
        try:
            zone = ZoneInfo(timezone_name)
        except ZoneInfoNotFoundError, ValueError:
            raise JobScheduleValidationError(
                'Timezone must be a valid IANA timezone'
            ) from None
        try:
            trigger = CronTrigger.from_crontab(cron, timezone=zone)
        except TypeError, ValueError:
            raise JobScheduleValidationError(
                'Cron must be a valid five-field expression'
            ) from None
        JobService._validate_frequency(definition, trigger, zone)
        return cron, timezone_name, trigger

    @staticmethod
    def _validate_frequency(
        definition: JobDefinition, trigger: CronTrigger, zone: ZoneInfo
    ) -> None:
        previous = None
        now = datetime.now(zone)
        for _ in range(370):
            next_fire = trigger.get_next_fire_time(
                previous, now if previous is None else previous
            )
            if next_fire is None:
                return
            if previous is not None:
                if definition.minimum_interval >= timedelta(days=1):
                    if (
                        next_fire.astimezone(zone).date()
                        == previous.astimezone(zone).date()
                    ):
                        raise JobScheduleValidationError(
                            'Cron runs more frequently than this job permits'
                        )
                elif next_fire - previous < definition.minimum_interval:
                    raise JobScheduleValidationError(
                        'Cron runs more frequently than this job permits'
                    )
            previous = next_fire

    def bootstrap(self) -> None:
        for definition in JOB_DEFINITIONS:
            if self.db.get(ScheduledJob, definition.key.value) is None:
                cron, tz, _ = self.validate_schedule(
                    definition, definition.default_cron, definition.default_timezone
                )
                self.db.add(
                    ScheduledJob(
                        key=definition.key.value,
                        enabled=definition.default_enabled,
                        cron=cron,
                        timezone=tz,
                    )
                )
        self.db.commit()

    def recover_interrupted(self) -> None:
        self.db.execute(
            update(JobExecution)
            .where(JobExecution.status == JobExecutionStatus.RUNNING)
            .values(
                status=JobExecutionStatus.FAILED,
                error_message='Application stopped before the execution completed',
                finished_at=utcnow(),
            )
        )
        self.db.commit()

    def get_record(self, job_key: str) -> JobRecord:
        definition = self._definition(job_key)
        job = self.db.get(ScheduledJob, job_key)
        if job is None:
            raise JobNotFoundError(job_key)
        executions = self.db.scalars(
            select(JobExecution)
            .where(JobExecution.job_key == job_key)
            .order_by(JobExecution.created_at.desc())
        ).all()
        active = next(
            (
                item
                for item in executions
                if item.status
                in (JobExecutionStatus.QUEUED, JobExecutionStatus.RUNNING)
            ),
            None,
        )
        latest = executions[0] if executions else None
        error = None
        next_run_at = None
        if job.enabled:
            try:
                _, _, trigger = self.validate_schedule(
                    definition, job.cron, job.timezone
                )
                next_run_at = (
                    self.scheduler.next_run_at(job_key)
                    if self.scheduler
                    else trigger.get_next_fire_time(None, datetime.now(timezone.utc))
                )
            except JobScheduleValidationError as exc:
                error = str(exc)
        return JobRecord(definition, job, active, latest, next_run_at, error)

    def list_records(self) -> list[JobRecord]:
        return [self.get_record(definition.key.value) for definition in JOB_DEFINITIONS]

    def update(
        self,
        job_key: str,
        *,
        enabled: bool | None = None,
        cron: str | None = None,
        timezone_name: str | None = None,
        updated_by: uuid.UUID | None,
    ) -> JobRecord:
        if enabled is None and cron is None and timezone_name is None:
            raise JobScheduleValidationError('At least one field must be provided')
        definition = self._definition(job_key)
        job = self.db.get(ScheduledJob, job_key)
        if job is None:
            raise JobNotFoundError(job_key)
        candidate_enabled = job.enabled if enabled is None else enabled
        candidate_cron = job.cron if cron is None else cron
        candidate_timezone = job.timezone if timezone_name is None else timezone_name
        normalized_cron, normalized_timezone, trigger = self.validate_schedule(
            definition, candidate_cron, candidate_timezone
        )
        job.enabled, job.cron, job.timezone, job.updated_by, job.updated_at = (
            candidate_enabled,
            normalized_cron,
            normalized_timezone,
            updated_by,
            utcnow(),
        )
        self.db.commit()
        self.db.refresh(job)
        if self.scheduler:
            self.scheduler.apply(job, trigger)
        return self.get_record(job_key)

    def reset(self, job_key: str, *, updated_by: uuid.UUID | None) -> JobRecord:
        definition = self._definition(job_key)
        return self.update(
            job_key,
            enabled=definition.default_enabled,
            cron=definition.default_cron,
            timezone_name=definition.default_timezone,
            updated_by=updated_by,
        )

    def enqueue(
        self,
        job_key: str,
        *,
        trigger: JobExecutionTrigger,
        requested_by: uuid.UUID | None = None,
    ) -> JobExecution | None:
        self._definition(job_key)
        job = self.db.get(ScheduledJob, job_key)
        if job is None:
            raise JobNotFoundError(job_key)
        automatic = trigger != JobExecutionTrigger.MANUAL
        if automatic and not job.enabled:
            return None
        active = self.db.scalar(
            select(JobExecution)
            .where(
                JobExecution.job_key == job_key,
                JobExecution.status.in_(
                    (JobExecutionStatus.QUEUED, JobExecutionStatus.RUNNING)
                ),
            )
            .order_by(JobExecution.created_at)
        )
        if active:
            if not automatic:
                raise JobConflictError(active)
            skipped = JobExecution(
                job_key=job_key,
                trigger=trigger,
                status=JobExecutionStatus.SKIPPED,
                summary={'reason': 'Job already has an active execution'},
                finished_at=utcnow(),
            )
            self.db.add(skipped)
            self.db.commit()
            return skipped
        execution = JobExecution(
            job_key=job_key,
            trigger=trigger,
            status=JobExecutionStatus.QUEUED,
            requested_by=requested_by,
        )
        self.db.add(execution)
        try:
            self.db.commit()
        except IntegrityError:
            self.db.rollback()
            active = self.db.scalar(
                select(JobExecution)
                .where(
                    JobExecution.job_key == job_key,
                    JobExecution.status.in_(
                        (JobExecutionStatus.QUEUED, JobExecutionStatus.RUNNING)
                    ),
                )
                .order_by(JobExecution.created_at)
            )
            if not automatic and active:
                raise JobConflictError(active)
            if automatic:
                skipped = JobExecution(
                    job_key=job_key,
                    trigger=trigger,
                    status=JobExecutionStatus.SKIPPED,
                    summary={'reason': 'Job already has an active execution'},
                    finished_at=utcnow(),
                )
                self.db.add(skipped)
                self.db.commit()
                return skipped
            raise
        self.db.refresh(execution)
        if self.wake_runner:
            self.wake_runner()
        return execution

    def enqueue_startup_jobs(self) -> None:
        for definition in JOB_DEFINITIONS:
            job = self.db.get(ScheduledJob, definition.key.value)
            if (
                not job
                or not job.enabled
                or not definition.run_on_start_until_first_success
            ):
                continue
            success = self.db.scalar(
                select(JobExecution.id)
                .where(
                    JobExecution.job_key == job.key,
                    JobExecution.status == JobExecutionStatus.SUCCEEDED,
                )
                .limit(1)
            )
            if success is None:
                self.enqueue(job.key, trigger=JobExecutionTrigger.STARTUP)

    def _definition(self, job_key: str) -> JobDefinition:
        definition = JOB_DEFINITIONS_BY_KEY.get(job_key)
        if definition is None:
            raise JobNotFoundError(job_key)
        return definition
