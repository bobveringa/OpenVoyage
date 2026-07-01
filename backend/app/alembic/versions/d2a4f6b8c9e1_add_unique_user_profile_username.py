"""add unique user profile username

Revision ID: d2a4f6b8c9e1
Revises: c4b2f3a1d6e7
Create Date: 2026-07-01 00:00:00.000000+00:00

"""
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = 'd2a4f6b8c9e1'
down_revision: Union[str, Sequence[str], None] = 'c4b2f3a1d6e7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.execute(
        """
        DO $$
        BEGIN
            IF EXISTS (
                SELECT 1
                FROM user_profiles
                GROUP BY username
                HAVING count(*) > 1
            ) THEN
                RAISE EXCEPTION 'Duplicate user profile usernames exist';
            END IF;
        END
        $$;
        """
    )
    op.create_index(
        op.f('ix_user_profiles_username'),
        'user_profiles',
        ['username'],
        unique=True,
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index(op.f('ix_user_profiles_username'), table_name='user_profiles')
