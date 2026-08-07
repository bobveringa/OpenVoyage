from __future__ import annotations

import enum
import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Index, String, Text, func, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base, utcnow


class JobExecutionTrigger(str, enum.Enum):
    SCHEDULED = 'SCHEDULED'
    STARTUP = 'STARTUP'
    MANUAL = 'MANUAL'


class JobExecutionStatus(str, enum.Enum):
    QUEUED = 'QUEUED'
    RUNNING = 'RUNNING'
    SUCCEEDED = 'SUCCEEDED'
    FAILED = 'FAILED'
    SKIPPED = 'SKIPPED'


class ScheduledJob(Base):
    __tablename__ = 'jobs'
    __table_args__ = (
        CheckConstraint("length(trim(cron)) > 0", name='ck_jobs_cron_not_blank'),
        CheckConstraint("length(trim(timezone)) > 0", name='ck_jobs_timezone_not_blank'),
    )

    key: Mapped[str] = mapped_column(String(100), primary_key=True)
    enabled: Mapped[bool] = mapped_column(nullable=False)
    cron: Mapped[str] = mapped_column(String(255), nullable=False)
    timezone: Mapped[str] = mapped_column(String(255), nullable=False)
    updated_by: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey('users.id', ondelete='SET NULL', name='fk_jobs_updated_by'), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow, onupdate=utcnow, server_default=func.now())


class JobExecution(Base):
    __tablename__ = 'job_executions'
    __table_args__ = (
        Index('ix_job_executions_job_key_created_at', 'job_key', 'created_at'),
        Index('ix_job_executions_status_created_at', 'status', 'created_at'),
        Index('uq_job_executions_active_job', 'job_key', unique=True,
              postgresql_where=text("status IN ('QUEUED', 'RUNNING')")),
        CheckConstraint("trigger IN ('SCHEDULED', 'STARTUP', 'MANUAL')", name='ck_job_executions_trigger'),
        CheckConstraint("status IN ('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'SKIPPED')", name='ck_job_executions_status'),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    job_key: Mapped[str] = mapped_column(String(100), ForeignKey('jobs.key', ondelete='CASCADE', name='fk_job_executions_job_key'), nullable=False)
    trigger: Mapped[JobExecutionTrigger] = mapped_column(String(16), nullable=False)
    status: Mapped[JobExecutionStatus] = mapped_column(String(16), nullable=False)
    requested_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey('users.id', ondelete='SET NULL', name='fk_job_executions_requested_by'), nullable=True)
    summary: Mapped[dict[str, Any] | None] = mapped_column(JSONB, nullable=True)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow, server_default=func.now())
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
