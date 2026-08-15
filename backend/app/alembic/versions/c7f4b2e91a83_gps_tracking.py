"""gps tracking

Revision ID: c7f4b2e91a83
Revises: ac71f4d2e8b9
Create Date: 2026-08-14 10:00:00.000000+00:00

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = 'c7f4b2e91a83'
down_revision: Union[str, Sequence[str], None] = 'ac71f4d2e8b9'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column(
        'trips',
        sa.Column(
            'share_live_location',
            sa.Boolean(),
            server_default='false',
            nullable=False,
        ),
    )

    op.create_table(
        'gps_privacy_zones',
        sa.Column('id', sa.Uuid(), nullable=False),
        sa.Column('user_id', sa.Uuid(), nullable=False),
        sa.Column('name', sa.String(length=100), nullable=False),
        sa.Column('latitude', sa.Double(), nullable=False),
        sa.Column('longitude', sa.Double(), nullable=False),
        sa.Column('radius_meters', sa.Integer(), nullable=False),
        sa.Column(
            'created_at',
            sa.DateTime(timezone=True),
            server_default=sa.text('now()'),
            nullable=False,
        ),
        sa.Column(
            'updated_at',
            sa.DateTime(timezone=True),
            server_default=sa.text('now()'),
            nullable=False,
        ),
        sa.CheckConstraint(
            'latitude >= -90 AND latitude <= 90',
            name='ck_gps_privacy_zones_latitude_range',
        ),
        sa.CheckConstraint(
            'longitude >= -180 AND longitude <= 180',
            name='ck_gps_privacy_zones_longitude_range',
        ),
        sa.CheckConstraint(
            'radius_meters > 0',
            name='ck_gps_privacy_zones_radius_positive',
        ),
        sa.ForeignKeyConstraint(
            ['user_id'],
            ['users.id'],
            name='fk_gps_privacy_zones_user_id',
            ondelete='CASCADE',
        ),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(
        'ix_gps_privacy_zones_user_id_id',
        'gps_privacy_zones',
        ['user_id', 'id'],
        unique=False,
    )

    op.create_table(
        'gps_tracking_sessions',
        sa.Column('id', sa.Uuid(), nullable=False),
        sa.Column('trip_id', sa.Uuid(), nullable=False),
        sa.Column('recorded_by_user_id', sa.Uuid(), nullable=True),
        sa.Column('started_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('ended_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            'created_at',
            sa.DateTime(timezone=True),
            server_default=sa.text('now()'),
            nullable=False,
        ),
        sa.Column(
            'updated_at',
            sa.DateTime(timezone=True),
            server_default=sa.text('now()'),
            nullable=False,
        ),
        sa.CheckConstraint(
            'ended_at IS NULL OR ended_at >= started_at',
            name='ck_gps_tracking_sessions_ended_after_started',
        ),
        sa.ForeignKeyConstraint(
            ['trip_id'],
            ['trips.id'],
            name='fk_gps_tracking_sessions_trip_id',
            ondelete='CASCADE',
        ),
        sa.ForeignKeyConstraint(
            ['recorded_by_user_id'],
            ['users.id'],
            name='fk_gps_tracking_sessions_recorded_by_user_id',
            ondelete='SET NULL',
        ),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint(
            'trip_id',
            'id',
            name='uq_gps_tracking_sessions_trip_id_id',
        ),
    )
    op.create_index(
        'uq_gps_tracking_sessions_trip_open',
        'gps_tracking_sessions',
        ['trip_id'],
        unique=True,
        postgresql_where=sa.text('ended_at IS NULL'),
    )
    op.create_index(
        'ix_gps_tracking_sessions_trip_started_at_id',
        'gps_tracking_sessions',
        ['trip_id', 'started_at', 'id'],
        unique=False,
    )

    op.create_table(
        'gps_track_samples',
        sa.Column('id', sa.Uuid(), nullable=False),
        sa.Column('trip_id', sa.Uuid(), nullable=False),
        sa.Column('session_id', sa.Uuid(), nullable=False),
        sa.Column('recorded_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('latitude', sa.Double(), nullable=False),
        sa.Column('longitude', sa.Double(), nullable=False),
        sa.Column('accuracy_meters', sa.Double(), nullable=True),
        sa.Column(
            'travel_mode',
            sa.String(length=32),
            server_default='UNKNOWN',
            nullable=False,
        ),
        sa.Column(
            'created_at',
            sa.DateTime(timezone=True),
            server_default=sa.text('now()'),
            nullable=False,
        ),
        sa.Column(
            'updated_at',
            sa.DateTime(timezone=True),
            server_default=sa.text('now()'),
            nullable=False,
        ),
        sa.CheckConstraint(
            'latitude >= -90 AND latitude <= 90',
            name='ck_gps_track_samples_latitude_range',
        ),
        sa.CheckConstraint(
            'longitude >= -180 AND longitude <= 180',
            name='ck_gps_track_samples_longitude_range',
        ),
        sa.CheckConstraint(
            'accuracy_meters IS NULL OR accuracy_meters >= 0',
            name='ck_gps_track_samples_accuracy_nonnegative',
        ),
        sa.ForeignKeyConstraint(
            ['trip_id'],
            ['trips.id'],
            name='fk_gps_track_samples_trip_id',
            ondelete='CASCADE',
        ),
        sa.ForeignKeyConstraint(
            ['trip_id', 'session_id'],
            ['gps_tracking_sessions.trip_id', 'gps_tracking_sessions.id'],
            name='fk_gps_track_samples_trip_session_id',
            ondelete='CASCADE',
        ),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(
        'ix_gps_track_samples_trip_recorded_at_id',
        'gps_track_samples',
        ['trip_id', 'recorded_at', 'id'],
        unique=False,
    )
    op.create_index(
        'ix_gps_track_samples_session_recorded_at_id',
        'gps_track_samples',
        ['session_id', 'recorded_at', 'id'],
        unique=False,
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index(
        'ix_gps_track_samples_session_recorded_at_id',
        table_name='gps_track_samples',
    )
    op.drop_index(
        'ix_gps_track_samples_trip_recorded_at_id',
        table_name='gps_track_samples',
    )
    op.drop_table('gps_track_samples')

    op.drop_index(
        'ix_gps_tracking_sessions_trip_started_at_id',
        table_name='gps_tracking_sessions',
    )
    op.drop_index(
        'uq_gps_tracking_sessions_trip_open',
        table_name='gps_tracking_sessions',
    )
    op.drop_table('gps_tracking_sessions')

    op.drop_index(
        'ix_gps_privacy_zones_user_id_id',
        table_name='gps_privacy_zones',
    )
    op.drop_table('gps_privacy_zones')

    op.drop_column('trips', 'share_live_location')
