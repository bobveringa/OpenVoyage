"""add user preferences

Revision ID: 1b4d9e2a7c6f
Revises: b7c3e5d18f42
Create Date: 2026-08-24 19:00:00.000000+00:00

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = '1b4d9e2a7c6f'
down_revision: Union[str, Sequence[str], None] = 'b7c3e5d18f42'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'user_preferences',
        sa.Column('user_id', sa.Uuid(), nullable=False),
        sa.Column('time_format', sa.String(length=16), nullable=False),
        sa.Column(
            'theme_palette',
            postgresql.JSONB(astext_type=sa.Text(), none_as_null=True),
            nullable=True,
        ),
        sa.Column(
            'created_at',
            sa.DateTime(timezone=True),
            server_default=sa.text('now()'),
            nullable=False,
        ),
        sa.Column(
            'updated_at',
            sa.DateTime(timezone=True),
            server_default=sa.text('now()'),
            nullable=False,
        ),
        sa.CheckConstraint(
            "time_format IN ('12-hour', '24-hour')",
            name='ck_user_preferences_time_format',
        ),
        sa.ForeignKeyConstraint(
            ['user_id'],
            ['users.id'],
            name='fk_user_preferences_user_id',
            ondelete='CASCADE',
        ),
        sa.PrimaryKeyConstraint('user_id'),
    )


def downgrade() -> None:
    op.drop_table('user_preferences')
