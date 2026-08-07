"""scheduled jobs

Revision ID: 9f2d6c4b1a70
Revises: e5a1c8f4d2b7
Create Date: 2026-08-06 12:00:00.000000+00:00
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = '9f2d6c4b1a70'
down_revision: Union[str, Sequence[str], None] = 'e5a1c8f4d2b7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'jobs',
        sa.Column('key', sa.String(length=100), nullable=False),
        sa.Column('enabled', sa.Boolean(), nullable=False),
        sa.Column('cron', sa.String(length=255), nullable=False),
        sa.Column('timezone', sa.String(length=255), nullable=False),
        sa.Column('updated_by', sa.Uuid(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.CheckConstraint("length(trim(cron)) > 0", name='ck_jobs_cron_not_blank'),
        sa.CheckConstraint("length(trim(timezone)) > 0", name='ck_jobs_timezone_not_blank'),
        sa.ForeignKeyConstraint(['updated_by'], ['users.id'], name='fk_jobs_updated_by', ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('key'),
    )
    op.create_table(
        'job_executions',
        sa.Column('id', sa.Uuid(), nullable=False),
        sa.Column('job_key', sa.String(length=100), nullable=False),
        sa.Column('trigger', sa.String(length=16), nullable=False),
        sa.Column('status', sa.String(length=16), nullable=False),
        sa.Column('requested_by', sa.Uuid(), nullable=True),
        sa.Column('summary', postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column('error_message', sa.Text(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('started_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('finished_at', sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint("trigger IN ('SCHEDULED', 'STARTUP', 'MANUAL')", name='ck_job_executions_trigger'),
        sa.CheckConstraint("status IN ('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'SKIPPED')", name='ck_job_executions_status'),
        sa.ForeignKeyConstraint(['job_key'], ['jobs.key'], name='fk_job_executions_job_key', ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['requested_by'], ['users.id'], name='fk_job_executions_requested_by', ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_job_executions_job_key_created_at', 'job_executions', ['job_key', 'created_at'], unique=False)
    op.create_index('ix_job_executions_status_created_at', 'job_executions', ['status', 'created_at'], unique=False)
    op.create_index('uq_job_executions_active_job', 'job_executions', ['job_key'], unique=True, postgresql_where=sa.text("status IN ('QUEUED', 'RUNNING')"))
    jobs = sa.table('jobs', sa.column('key', sa.String), sa.column('enabled', sa.Boolean), sa.column('cron', sa.String), sa.column('timezone', sa.String))
    op.bulk_insert(jobs, [
        {'key': 'geonames_import', 'enabled': True, 'cron': '0 0 1 * *', 'timezone': 'UTC'},
        {'key': 'itinerary_route_maintenance', 'enabled': True, 'cron': '0 0 * * *', 'timezone': 'UTC'},
        {'key': 'orphaned_media_cleanup', 'enabled': True, 'cron': '0 0 * * *', 'timezone': 'UTC'},
    ])


def downgrade() -> None:
    op.drop_index('uq_job_executions_active_job', table_name='job_executions')
    op.drop_index('ix_job_executions_status_created_at', table_name='job_executions')
    op.drop_index('ix_job_executions_job_key_created_at', table_name='job_executions')
    op.drop_table('job_executions')
    op.drop_table('jobs')
