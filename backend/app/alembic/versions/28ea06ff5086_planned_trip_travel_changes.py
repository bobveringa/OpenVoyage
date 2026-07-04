"""planned trip/travel changes

Revision ID: 28ea06ff5086
Revises: a2e88e4b08ba
Create Date: 2026-07-04 14:56:14.505172+00:00

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '28ea06ff5086'
down_revision: Union[str, Sequence[str], None] = 'a2e88e4b08ba'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column('trips', sa.Column('start_date', sa.Date(), nullable=True))
    op.add_column('trips', sa.Column('end_date', sa.Date(), nullable=True))

    op.drop_index(op.f('ix_planned_steps_trip_id_step_number'), table_name='planned_steps')
    op.alter_column(
        'planned_steps',
        'step_number',
        new_column_name='position',
        existing_type=sa.Integer(),
        existing_nullable=False,
    )
    op.alter_column(
        'planned_steps',
        'position',
        existing_type=sa.Integer(),
        type_=sa.BigInteger(),
        existing_nullable=False,
    )
    op.create_index(
        'ix_planned_steps_trip_id_position',
        'planned_steps',
        ['trip_id', 'position'],
        unique=True,
    )

    op.drop_index(op.f('ix_planned_travel_trip_from_to'), table_name='planned_travel')
    op.create_index(
        'ix_planned_travel_trip_from_to',
        'planned_travel',
        ['trip_id', 'from_planned_step_id', 'to_planned_step_id'],
        unique=True,
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index('ix_planned_travel_trip_from_to', table_name='planned_travel')
    op.create_index(
        op.f('ix_planned_travel_trip_from_to'),
        'planned_travel',
        ['trip_id', 'from_planned_step_id', 'to_planned_step_id'],
        unique=False,
    )

    op.drop_index('ix_planned_steps_trip_id_position', table_name='planned_steps')
    op.alter_column(
        'planned_steps',
        'position',
        existing_type=sa.BigInteger(),
        type_=sa.Integer(),
        existing_nullable=False,
    )
    op.alter_column(
        'planned_steps',
        'position',
        new_column_name='step_number',
        existing_type=sa.Integer(),
        existing_nullable=False,
    )
    op.create_index(
        op.f('ix_planned_steps_trip_id_step_number'),
        'planned_steps',
        ['trip_id', 'step_number'],
        unique=False,
    )

    op.drop_column('trips', 'end_date')
    op.drop_column('trips', 'start_date')
