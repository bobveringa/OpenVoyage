"""GPS derived track flags

Stores the three per-session derived sets on the sample row so reads select on
them instead of re-deriving a trip's whole raw history on every request.

Columns only. Existing points are left false, which reads as a trip with no
drawn track and no post candidates until its sessions are written to again.
Every deployment that held real tracking data was migrated while this revision
still carried a backfill; pre-alpha, nothing else needs carrying forward.

Revision ID: b7c3e5d18f42
Revises: d4f6a29c7e13
Create Date: 2026-08-22

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = 'b7c3e5d18f42'
down_revision: Union[str, Sequence[str], None] = 'd4f6a29c7e13'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        'gps_track_samples',
        sa.Column(
            'is_long_stay',
            sa.Boolean(),
            nullable=False,
            server_default=sa.text('false'),
        ),
    )
    op.add_column(
        'gps_track_samples',
        sa.Column(
            'is_post_candidate',
            sa.Boolean(),
            nullable=False,
            server_default=sa.text('false'),
        ),
    )
    op.add_column(
        'gps_track_samples',
        sa.Column(
            'is_display_retained',
            sa.Boolean(),
            nullable=False,
            server_default=sa.text('false'),
        ),
    )
    op.create_index(
        'ix_gps_track_samples_trip_post_candidates',
        'gps_track_samples',
        ['trip_id', 'recorded_at', 'id'],
        unique=False,
        postgresql_where=sa.text('is_post_candidate'),
    )
    op.create_index(
        'ix_gps_track_samples_trip_display_track',
        'gps_track_samples',
        ['trip_id', 'recorded_at', 'id'],
        unique=False,
        postgresql_where=sa.text('is_display_retained'),
    )


def downgrade() -> None:
    op.drop_index(
        'ix_gps_track_samples_trip_display_track',
        table_name='gps_track_samples',
        postgresql_where=sa.text('is_display_retained'),
    )
    op.drop_index(
        'ix_gps_track_samples_trip_post_candidates',
        table_name='gps_track_samples',
        postgresql_where=sa.text('is_post_candidate'),
    )
    op.drop_column('gps_track_samples', 'is_display_retained')
    op.drop_column('gps_track_samples', 'is_post_candidate')
    op.drop_column('gps_track_samples', 'is_long_stay')

