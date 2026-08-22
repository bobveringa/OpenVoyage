"""track sample motion fields

Revision ID: d4f6a29c7e13
Revises: c7f4b2e91a83
Create Date: 2026-08-16 09:00:00.000000+00:00

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = 'd4f6a29c7e13'
down_revision: Union[str, Sequence[str], None] = 'c7f4b2e91a83'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column(
        'gps_track_samples',
        sa.Column('speed_mps', sa.Double(), nullable=True),
    )
    op.add_column(
        'gps_track_samples',
        sa.Column('heading_degrees', sa.Double(), nullable=True),
    )
    op.add_column(
        'gps_track_samples',
        sa.Column('altitude_meters', sa.Double(), nullable=True),
    )
    op.create_check_constraint(
        'ck_gps_track_samples_speed_nonnegative',
        'gps_track_samples',
        'speed_mps IS NULL OR speed_mps >= 0',
    )
    op.create_check_constraint(
        'ck_gps_track_samples_heading_range',
        'gps_track_samples',
        'heading_degrees IS NULL OR (heading_degrees >= 0 AND heading_degrees <= 360)',
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_constraint(
        'ck_gps_track_samples_heading_range',
        'gps_track_samples',
        type_='check',
    )
    op.drop_constraint(
        'ck_gps_track_samples_speed_nonnegative',
        'gps_track_samples',
        type_='check',
    )
    op.drop_column('gps_track_samples', 'altitude_meters')
    op.drop_column('gps_track_samples', 'heading_degrees')
    op.drop_column('gps_track_samples', 'speed_mps')
