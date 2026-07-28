"""itinerary travel leg routes

Revision ID: b4d2f7a1c9e3
Revises: f18c2a7d9b31
Create Date: 2026-07-26 18:30:00.000000+00:00

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = 'b4d2f7a1c9e3'
down_revision: Union[str, Sequence[str], None] = 'f18c2a7d9b31'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        'itinerary_travel_leg_routes',
        sa.Column('id', sa.Uuid(), nullable=False),
        sa.Column('status', sa.String(length=32), nullable=False),
        sa.Column('geometry_geojson', postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column('provider', sa.String(length=64), nullable=False),
        sa.Column('distance_meters', sa.Integer(), nullable=True),
        sa.Column('duration_seconds', sa.Integer(), nullable=True),
        sa.Column('attempt_count', sa.Integer(), server_default='0', nullable=False),
        sa.Column('next_retry_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('error_code', sa.String(length=64), nullable=True),
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
            'attempt_count >= 0',
            name='ck_itinerary_travel_leg_routes_attempt_count_nonnegative',
        ),
        sa.CheckConstraint(
            'distance_meters IS NULL OR distance_meters >= 0',
            name='ck_itinerary_travel_leg_routes_distance_nonnegative',
        ),
        sa.CheckConstraint(
            'duration_seconds IS NULL OR duration_seconds >= 0',
            name='ck_itinerary_travel_leg_routes_duration_nonnegative',
        ),
        sa.CheckConstraint(
            "status <> 'READY' OR geometry_geojson IS NOT NULL",
            name='ck_itinerary_travel_leg_routes_ready_geometry',
        ),
        sa.CheckConstraint(
            "status IN ('READY', 'PENDING', 'FAILED')",
            name='ck_itinerary_travel_leg_routes_status',
        ),
        sa.ForeignKeyConstraint(
            ['id'],
            ['itinerary_travel_legs.id'],
            name='fk_itinerary_travel_leg_routes_id',
            ondelete='CASCADE',
        ),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(
        'ix_itinerary_travel_leg_routes_retry',
        'itinerary_travel_leg_routes',
        ['status', 'next_retry_at'],
        unique=False,
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index(
        'ix_itinerary_travel_leg_routes_retry',
        table_name='itinerary_travel_leg_routes',
    )
    op.drop_table('itinerary_travel_leg_routes')
