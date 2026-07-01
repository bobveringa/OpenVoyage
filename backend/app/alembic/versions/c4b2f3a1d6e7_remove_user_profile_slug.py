"""remove user profile slug

Revision ID: c4b2f3a1d6e7
Revises: 8a71d2f9c4b3
Create Date: 2026-07-01 00:00:00.000000+00:00

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'c4b2f3a1d6e7'
down_revision: Union[str, Sequence[str], None] = '8a71d2f9c4b3'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.drop_index(op.f('ix_user_profiles_slug'), table_name='user_profiles')
    op.drop_column('user_profiles', 'slug')


def downgrade() -> None:
    """Downgrade schema."""
    op.add_column(
        'user_profiles',
        sa.Column('slug', sa.String(length=48), nullable=True),
    )
    op.execute("UPDATE user_profiles SET slug = user_id::text")
    op.alter_column('user_profiles', 'slug', nullable=False)
    op.create_index(
        op.f('ix_user_profiles_slug'),
        'user_profiles',
        ['slug'],
        unique=True,
    )
