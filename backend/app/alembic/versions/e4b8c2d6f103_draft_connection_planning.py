"""Allow actor-owned planning artifacts before a connection is saved."""

from alembic import op
import sqlalchemy as sa

revision = 'e4b8c2d6f103'
down_revision = 'd9a3b7c1e502'
branch_labels = None
depends_on = None


def upgrade():
    op.alter_column(
        'itinerary_planning_artifacts', 'leg_id', existing_type=sa.Uuid(), nullable=True
    )


def downgrade():
    op.execute('DELETE FROM itinerary_planning_artifacts WHERE leg_id IS NULL')
    op.alter_column(
        'itinerary_planning_artifacts',
        'leg_id',
        existing_type=sa.Uuid(),
        nullable=False,
    )
