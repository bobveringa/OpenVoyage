"""Retain deleted recording identities for safe background retries."""
from alembic import op
import sqlalchemy as sa

revision = 'b6d8e0f2a491'
down_revision = '5c8e2a7d9f41'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('gps_tracking_sessions', sa.Column('deleted_at', sa.DateTime(timezone=True)))
    op.drop_index('uq_gps_tracking_sessions_trip_open', table_name='gps_tracking_sessions')
    op.create_index('uq_gps_tracking_sessions_trip_open', 'gps_tracking_sessions', ['trip_id'],
                    unique=True, postgresql_where=sa.text('ended_at IS NULL AND deleted_at IS NULL'))


def downgrade() -> None:
    op.execute('DELETE FROM gps_tracking_sessions WHERE deleted_at IS NOT NULL')
    op.drop_index('uq_gps_tracking_sessions_trip_open', table_name='gps_tracking_sessions')
    op.create_index('uq_gps_tracking_sessions_trip_open', 'gps_tracking_sessions', ['trip_id'],
                    unique=True, postgresql_where=sa.text('ended_at IS NULL'))
    op.drop_column('gps_tracking_sessions', 'deleted_at')
