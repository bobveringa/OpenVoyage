"""dynamic app settings

Revision ID: e5a1c8f4d2b7
Revises: d8a3e1b9c4f2
Create Date: 2026-08-05 19:00:00.000000+00:00

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = 'e5a1c8f4d2b7'
down_revision: Union[str, Sequence[str], None] = 'd8a3e1b9c4f2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        'app_settings',
        sa.Column('key', sa.String(length=255), nullable=False),
        sa.Column(
            'value',
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=True,
        ),
        sa.Column('secret_value', sa.Text(), nullable=True),
        sa.Column('updated_by', sa.Uuid(), nullable=True),
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
            '((value IS NOT NULL AND secret_value IS NULL) OR '
            '(value IS NULL AND secret_value IS NOT NULL))',
            name='ck_app_settings_exactly_one_payload',
        ),
        sa.CheckConstraint(
            "value IS NULL OR value <> 'null'::jsonb",
            name='ck_app_settings_value_not_json_null',
        ),
        sa.ForeignKeyConstraint(
            ['updated_by'],
            ['users.id'],
            name='fk_app_settings_updated_by',
            ondelete='SET NULL',
        ),
        sa.PrimaryKeyConstraint('key'),
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_table('app_settings')
