"""add place population

Revision ID: d8a3e1b9c4f2
Revises: 6e8a9d1f2c3b
Create Date: 2026-07-30 00:00:00.000000+00:00

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'd8a3e1b9c4f2'
down_revision: Union[str, Sequence[str], None] = '6e8a9d1f2c3b'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column(
        'places',
        sa.Column('population', sa.Integer(), server_default='0', nullable=False),
    )
    op.create_check_constraint(
        'ck_places_population_nonnegative',
        'places',
        'population >= 0',
    )
    op.create_index(
        'ix_places_population',
        'places',
        ['population'],
        unique=False,
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index('ix_places_population', table_name='places')
    op.drop_constraint(
        'ck_places_population_nonnegative',
        'places',
        type_='check',
    )
    op.drop_column('places', 'population')
