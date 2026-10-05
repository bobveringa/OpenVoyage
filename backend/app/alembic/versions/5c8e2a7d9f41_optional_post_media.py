"""allow posts without media

Revision ID: 5c8e2a7d9f41
Revises: 2f6b8a1c4d90
"""

from alembic import op
import sqlalchemy as sa


revision: str = '5c8e2a7d9f41'
down_revision: str = '2f6b8a1c4d90'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.alter_column('posts', 'bubble_media_id', existing_type=sa.UUID(), nullable=True)


def downgrade() -> None:
    # PostgreSQL rejects this if text-only posts remain, preserving their data.
    op.alter_column('posts', 'bubble_media_id', existing_type=sa.UUID(), nullable=False)
