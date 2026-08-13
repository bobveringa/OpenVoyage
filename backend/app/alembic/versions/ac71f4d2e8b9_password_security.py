"""password security

Revision ID: ac71f4d2e8b9
Revises: 9f2d6c4b1a70
Create Date: 2026-08-11 22:00:00.000000+00:00
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'ac71f4d2e8b9'
down_revision: Union[str, Sequence[str], None] = '9f2d6c4b1a70'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        'users',
        sa.Column(
            'password_change_required',
            sa.Boolean(),
            server_default=sa.false(),
            nullable=False,
        ),
    )
    op.add_column(
        'users',
        sa.Column(
            'auth_version',
            sa.Integer(),
            server_default='0',
            nullable=False,
        ),
    )
    op.create_check_constraint(
        'ck_users_auth_version_nonnegative',
        'users',
        'auth_version >= 0',
    )


def downgrade() -> None:
    op.drop_constraint(
        'ck_users_auth_version_nonnegative',
        'users',
        type_='check',
    )
    op.drop_column('users', 'auth_version')
    op.drop_column('users', 'password_change_required')
