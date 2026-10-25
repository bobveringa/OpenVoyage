"""Retain flight job history and retire active work for the dedicated monitor.

Stop all old application processes before upgrading. Mixed runtimes are unsafe.
"""

from alembic import op

revision = 'a5d7f9012346'
down_revision = 'a4c6e8f01235'
branch_labels = None
depends_on = None


def upgrade():
    op.execute("""
        UPDATE job_executions
        SET status = 'FAILED', finished_at = CURRENT_TIMESTAMP,
            error_message = 'Execution ended during migration to the dedicated flight monitor.'
        WHERE job_key = 'flight_tracking' AND status IN ('QUEUED', 'RUNNING')
    """)


def downgrade():
    # The historical parent and its original controls were never modified.
    # Failed work must not be revived. An absent row is bootstrapped by old code.
    pass
