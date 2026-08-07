from __future__ import annotations

from typing import NoReturn

from fastapi import APIRouter, HTTPException, Query
from sqlalchemy import func, select
from starlette import status

from api.deps import CurrentAdmin, JobRuntimeDep, PaginationDep, SessionDep
from models.api.jobs import JobExecutionListResponse, JobExecutionResponse, JobListResponse, JobUpdateRequest, ScheduledJobResponse
from models.database.jobs import JobExecution, JobExecutionTrigger
from services.job_service import JobConflictError, JobNotFoundError, JobScheduleValidationError, JobService, JobRecord

router = APIRouter(prefix='/admin', tags=['admin'])


def _service(db, runtime) -> JobService:
    return JobService(db, scheduler=runtime.scheduler, wake_runner=runtime.runner.wake)


def _execution(execution: JobExecution | None) -> JobExecutionResponse | None:
    return JobExecutionResponse.model_validate(execution) if execution else None


def _record(record: JobRecord) -> ScheduledJobResponse:
    job, definition = record.job, record.definition
    return ScheduledJobResponse(
        key=job.key, name=definition.name, description=definition.description,
        enabled=job.enabled, cron=job.cron, timezone=job.timezone,
        default_enabled=definition.default_enabled, default_cron=definition.default_cron,
        default_timezone=definition.default_timezone, next_run_at=record.next_run_at,
        schedule_error=record.schedule_error, updated_by=job.updated_by, updated_at=job.updated_at,
        active_execution=_execution(record.active_execution), latest_execution=_execution(record.latest_execution),
    )


def _raise(exc: Exception) -> NoReturn:
    if isinstance(exc, JobNotFoundError):
        raise HTTPException(status_code=404, detail='Job not found') from exc
    if isinstance(exc, JobScheduleValidationError):
        raise HTTPException(status_code=422, detail=[{'loc': ['body'], 'msg': str(exc), 'type': 'value_error'}]) from exc
    raise exc


@router.get('/jobs', response_model=JobListResponse)
def list_jobs(session: SessionDep, runtime: JobRuntimeDep, _admin: CurrentAdmin) -> JobListResponse:
    return JobListResponse(jobs=[_record(record) for record in _service(session, runtime).list_records()])


@router.get('/jobs/{job_key}', response_model=ScheduledJobResponse)
def get_job(job_key: str, session: SessionDep, runtime: JobRuntimeDep, _admin: CurrentAdmin) -> ScheduledJobResponse:
    try:
        return _record(_service(session, runtime).get_record(job_key))
    except JobNotFoundError as exc:
        _raise(exc)


@router.patch('/jobs/{job_key}', response_model=ScheduledJobResponse)
def update_job(job_key: str, payload: JobUpdateRequest, session: SessionDep, runtime: JobRuntimeDep, admin: CurrentAdmin) -> ScheduledJobResponse:
    try:
        data = payload.model_dump(exclude_unset=True)
        return _record(_service(session, runtime).update(job_key, enabled=data.get('enabled'), cron=data.get('cron'), timezone_name=data.get('timezone'), updated_by=admin.id))
    except (JobNotFoundError, JobScheduleValidationError) as exc:
        _raise(exc)


@router.post('/jobs/{job_key}/reset', response_model=ScheduledJobResponse)
def reset_job(job_key: str, session: SessionDep, runtime: JobRuntimeDep, admin: CurrentAdmin) -> ScheduledJobResponse:
    try:
        return _record(_service(session, runtime).reset(job_key, updated_by=admin.id))
    except (JobNotFoundError, JobScheduleValidationError) as exc:
        _raise(exc)


@router.post('/jobs/{job_key}/executions', response_model=JobExecutionResponse, status_code=status.HTTP_202_ACCEPTED)
def run_job(job_key: str, session: SessionDep, runtime: JobRuntimeDep, admin: CurrentAdmin) -> JobExecutionResponse:
    try:
        execution = _service(session, runtime).enqueue(job_key, trigger=JobExecutionTrigger.MANUAL, requested_by=admin.id)
        assert execution is not None
        return _execution(execution)
    except JobConflictError as exc:
        raise HTTPException(status_code=409, detail=_execution(exc.execution).model_dump(mode='json')) from exc
    except JobNotFoundError as exc:
        _raise(exc)


@router.get('/job-executions', response_model=JobExecutionListResponse)
def list_executions(session: SessionDep, pagination: PaginationDep, _admin: CurrentAdmin, job_key: str | None = Query(default=None)) -> JobExecutionListResponse:
    statement = select(JobExecution)
    total_statement = select(func.count()).select_from(JobExecution)
    if job_key:
        statement = statement.where(JobExecution.job_key == job_key)
        total_statement = total_statement.where(JobExecution.job_key == job_key)
    items = session.scalars(statement.order_by(JobExecution.created_at.desc()).offset(pagination.offset).limit(pagination.page_size)).all()
    return JobExecutionListResponse(items=[_execution(item) for item in items], total=session.scalar(total_statement) or 0, page=pagination.page, page_size=pagination.page_size)


@router.get('/job-executions/{execution_id}', response_model=JobExecutionResponse)
def get_execution(execution_id: str, session: SessionDep, _admin: CurrentAdmin) -> JobExecutionResponse:
    try:
        import uuid
        execution = session.get(JobExecution, uuid.UUID(execution_id))
    except ValueError:
        execution = None
    if execution is None:
        raise HTTPException(status_code=404, detail='Job execution not found')
    return _execution(execution)
