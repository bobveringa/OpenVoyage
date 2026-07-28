"""add post title

Revision ID: 6e8a9d1f2c3b
Revises: b4d2f7a1c9e3
Create Date: 2026-07-28 22:30:00.000000+00:00

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '6e8a9d1f2c3b'
down_revision: Union[str, Sequence[str], None] = 'b4d2f7a1c9e3'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column('posts', sa.Column('title', sa.String(length=255), nullable=True))
    op.execute(
        sa.text(
            """
            UPDATE posts
            SET title = COALESCE(NULLIF(left(btrim(body), 255), ''), 'Untitled post')
            WHERE title IS NULL
            """
        )
    )
    op.alter_column(
        'posts',
        'title',
        existing_type=sa.String(length=255),
        nullable=False,
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column('posts', 'title')
