"""require trip start date

Revision ID: 7c1f9a3d2b4e
Revises: c394c2ff7a4d
Create Date: 2026-07-19 00:00:00.000000+00:00

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '7c1f9a3d2b4e'
down_revision: Union[str, Sequence[str], None] = 'c394c2ff7a4d'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.execute(
        sa.text(
            'UPDATE trips '
            'SET start_date = CAST(created_at AS DATE) '
            'WHERE start_date IS NULL'
        )
    )
    op.alter_column(
        'trips',
        'start_date',
        existing_type=sa.Date(),
        nullable=False,
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.alter_column(
        'trips',
        'start_date',
        existing_type=sa.Date(),
        nullable=True,
    )
