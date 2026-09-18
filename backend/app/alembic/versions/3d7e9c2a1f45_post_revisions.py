"""add optimistic-concurrency revisions to posts

Revision ID: 3d7e9c2a1f45
Revises: f18c2a7d9b31, 4a9d2e7b1c53
Create Date: 2026-09-18 00:00:00.000000+00:00

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '3d7e9c2a1f45'
down_revision: Union[str, Sequence[str], None] = (
    'f18c2a7d9b31',
    '4a9d2e7b1c53',
)
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        'posts',
        sa.Column('revision', sa.Integer(), server_default='0', nullable=False),
    )
    op.create_check_constraint(
        'ck_posts_revision_non_negative',
        'posts',
        'revision >= 0',
    )


def downgrade() -> None:
    op.drop_constraint('ck_posts_revision_non_negative', 'posts', type_='check')
    op.drop_column('posts', 'revision')
