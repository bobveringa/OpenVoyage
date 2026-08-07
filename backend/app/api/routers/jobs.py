from __future__ import annotations

import uuid
from typing import NoReturn

from fastapi import APIRouter, HTTPException, Query
from sqlalchemy import func, select
from starlette import status

from api.deps import CurrentAdmin, JobServiceDep, PaginationDep, SessionDep
from models.api.jobs import (
    JobExecutionListResponse,
    JobExecutionResponse,
    JobAuditResponse,
    JobDefaultsResponse,
    JobExecutionsResponse,
    JobListResponse,
    JobScheduleResponse,
    JobUpdateRequest,
    ScheduledJobResponse,
)
from models.database.jobs import JobExecution, JobExecutionTrigger
from services.job_service import (
    JobConflictError,
    JobNotFoundError,
    JobScheduleValidationError,
    JobRecord,
)

router = APIRouter(prefix='/admin', tags=['admin'])


def _execution(execution: JobExecution | None) -> JobExecutionResponse | None:
    if execution is None:
        return None
    return JobExecutionResponse.model_validate(execution)


def _record(record: JobRecord) -> ScheduledJobResponse:
    job = record.job
    definition = record.definition
    return ScheduledJobResponse(
        key=job.key,
        name=definition.name,
        description=definition.description,
        schedule=JobScheduleResponse(
            enabled=job.enabled,
            cron=job.cron,
            timezone=job.timezone,
            next_run_at=record.next_run_at,
            error=record.schedule_error,
        ),
        defaults=JobDefaultsResponse(
            enabled=definition.default_enabled,
            cron=definition.default_cron,
            timezone=definition.default_timezone,
        ),
        executions=JobExecutionsResponse(
            active=_execution(record.active_execution),
            latest=_execution(record.latest_execution),
        ),
        audit=JobAuditResponse(
            updated_by=job.updated_by,
            updated_at=job.updated_at,
        ),
    )


def _raise(exc: Exception) -> NoReturn:
    if isinstance(exc, JobNotFoundError):
        raise HTTPException(status_code=404, detail='Job not found') from exc
    if isinstance(exc, JobScheduleValidationError):
        raise HTTPException(
            status_code=422,
            detail=[{'loc': ['body'], 'msg': str(exc), 'type': 'value_error'}],
        ) from exc
    raise exc


@router.get('/jobs', response_model=JobListResponse)
def list_jobs(service: JobServiceDep, _admin: CurrentAdmin) -> JobListResponse:
    records = service.list_records()
    jobs = [_record(record) for record in records]
    return JobListResponse(jobs=jobs)


@router.get('/jobs/{job_key}', response_model=ScheduledJobResponse)
def get_job(
    job_key: str, service: JobServiceDep, _admin: CurrentAdmin
) -> ScheduledJobResponse:
    try:
        record = service.get_record(job_key)
        return _record(record)
    except JobNotFoundError as exc:
        _raise(exc)


@router.patch('/jobs/{job_key}', response_model=ScheduledJobResponse)
def update_job(
    job_key: str,
    payload: JobUpdateRequest,
    service: JobServiceDep,
    admin: CurrentAdmin,
) -> ScheduledJobResponse:
    try:
        data = payload.model_dump(exclude_unset=True)
        record = service.update(
            job_key,
            enabled=data.get('enabled'),
            cron=data.get('cron'),
            timezone_name=data.get('timezone'),
            updated_by=admin.id,
        )
        return _record(record)
    except (JobNotFoundError, JobScheduleValidationError) as exc:
        _raise(exc)


@router.post('/jobs/{job_key}/reset', response_model=ScheduledJobResponse)
def reset_job(
    job_key: str, service: JobServiceDep, admin: CurrentAdmin
) -> ScheduledJobResponse:
    try:
        record = service.reset(job_key, updated_by=admin.id)
        return _record(record)
    except (JobNotFoundError, JobScheduleValidationError) as exc:
        _raise(exc)


@router.post(
    '/jobs/{job_key}/executions',
    response_model=JobExecutionResponse,
    status_code=status.HTTP_202_ACCEPTED,
)
def run_job(
    job_key: str, service: JobServiceDep, admin: CurrentAdmin
) -> JobExecutionResponse:
    try:
        execution = service.enqueue(
            job_key, trigger=JobExecutionTrigger.MANUAL, requested_by=admin.id
        )
        assert execution is not None
        return _execution(execution)
    except JobConflictError as exc:
        existing_execution = _execution(exc.execution)
        assert existing_execution is not None
        raise HTTPException(
            status_code=409,
            detail=existing_execution.model_dump(mode='json'),
        ) from exc
    except JobNotFoundError as exc:
        _raise(exc)


@router.get('/job-executions', response_model=JobExecutionListResponse)
def list_executions(
    session: SessionDep,
    pagination: PaginationDep,
    _admin: CurrentAdmin,
    job_key: str | None = Query(default=None),
) -> JobExecutionListResponse:
    statement = select(JobExecution)
    total_statement = select(func.count()).select_from(JobExecution)
    if job_key:
        statement = statement.where(JobExecution.job_key == job_key)
        total_statement = total_statement.where(JobExecution.job_key == job_key)
    paged_statement = (
        statement.order_by(JobExecution.created_at.desc())
        .offset(pagination.offset)
        .limit(pagination.page_size)
    )
    items = session.scalars(paged_statement).all()
    executions = [_execution(item) for item in items]
    total = session.scalar(total_statement) or 0
    return JobExecutionListResponse(
        items=executions,
        total=total,
        page=pagination.page,
        page_size=pagination.page_size,
    )


@router.get('/job-executions/{execution_id}', response_model=JobExecutionResponse)
def get_execution(
    execution_id: str, session: SessionDep, _admin: CurrentAdmin
) -> JobExecutionResponse:
    try:
        execution = session.get(JobExecution, uuid.UUID(execution_id))
    except ValueError:
        execution = None
    if execution is None:
        raise HTTPException(status_code=404, detail='Job execution not found')
    return _execution(execution)
