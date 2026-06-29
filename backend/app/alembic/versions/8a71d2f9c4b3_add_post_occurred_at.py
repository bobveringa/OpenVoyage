"""add post occurred_at

Revision ID: 8a71d2f9c4b3
Revises: 775c052be5d5
Create Date: 2026-06-30 00:00:00.000000+00:00

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '8a71d2f9c4b3'
down_revision: Union[str, Sequence[str], None] = '775c052be5d5'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column(
        'posts',
        sa.Column(
            'occurred_at',
            sa.DateTime(timezone=True),
            server_default=sa.text('now()'),
            nullable=False,
        ),
    )
    op.create_index(
        'ix_posts_trip_id_occurred_at',
        'posts',
        ['trip_id', 'occurred_at'],
        unique=False,
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index('ix_posts_trip_id_occurred_at', table_name='posts')
    op.drop_column('posts', 'occurred_at')
