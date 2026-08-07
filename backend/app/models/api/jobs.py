from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, model_validator

from models.database.jobs import JobExecutionStatus, JobExecutionTrigger


class JobExecutionResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    job_key: str
    trigger: JobExecutionTrigger
    status: JobExecutionStatus
    requested_by: uuid.UUID | None
    summary: dict[str, Any] | None
    error_message: str | None
    created_at: datetime
    started_at: datetime | None
    finished_at: datetime | None


class ScheduledJobResponse(BaseModel):
    key: str
    name: str
    description: str
    enabled: bool
    cron: str
    timezone: str
    default_enabled: bool
    default_cron: str
    default_timezone: str
    next_run_at: datetime | None
    schedule_error: str | None
    updated_by: uuid.UUID | None
    updated_at: datetime
    active_execution: JobExecutionResponse | None
    latest_execution: JobExecutionResponse | None


class JobUpdateRequest(BaseModel):
    enabled: bool | None = None
    cron: str | None = Field(default=None, max_length=255)
    timezone: str | None = Field(default=None, max_length=255)

    @model_validator(mode='after')
    def has_value(self):
        if not self.model_fields_set:
            raise ValueError('At least one field must be provided')
        if any(getattr(self, name) is None for name in self.model_fields_set):
            raise ValueError('Job settings must not be null')
        return self


class JobListResponse(BaseModel):
    jobs: list[ScheduledJobResponse]


class JobExecutionListResponse(BaseModel):
    items: list[JobExecutionResponse]
    total: int
    page: int
    page_size: int
