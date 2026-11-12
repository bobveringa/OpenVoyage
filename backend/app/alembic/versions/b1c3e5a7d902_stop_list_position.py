"""Store each itinerary stop's place in the trip as its own list position.

Replaces ``itinerary_stops.same_day_position`` with ``position``: the stop's
index in the whole trip, starting at 0 and unique per trip. The uniqueness is
checked at the end of the transaction so stops can swap places.

The upgrade fills ``position`` from today's order (planned start date, then
same-day position). The downgrade numbers stops within each date again, in
their stored order.
"""

from alembic import op
import sqlalchemy as sa

revision = 'b1c3e5a7d902'
down_revision = '5e7a9c1b3d24'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('itinerary_stops', sa.Column('position', sa.Integer(), nullable=True))
    op.execute(
        """
        UPDATE itinerary_stops AS stop
        SET position = ordered.position
        FROM (
            SELECT id, ROW_NUMBER() OVER (
                PARTITION BY trip_id
                ORDER BY planned_start_date, same_day_position, id
            ) - 1 AS position
            FROM itinerary_stops
        ) AS ordered
        WHERE stop.id = ordered.id
        """
    )
    op.alter_column('itinerary_stops', 'position', nullable=False)
    op.drop_index('ix_itinerary_stops_trip_date_position', table_name='itinerary_stops')
    op.drop_constraint(
        'uq_itinerary_stops_trip_date_position', 'itinerary_stops', type_='unique'
    )
    op.drop_constraint(
        'ck_itinerary_stops_same_day_position_nonnegative',
        'itinerary_stops',
        type_='check',
    )
    op.drop_column('itinerary_stops', 'same_day_position')
    op.create_check_constraint(
        'ck_itinerary_stops_position_nonnegative', 'itinerary_stops', 'position >= 0'
    )
    op.create_unique_constraint(
        'uq_itinerary_stops_trip_position',
        'itinerary_stops',
        ['trip_id', 'position'],
        deferrable=True,
        initially='DEFERRED',
    )


def downgrade() -> None:
    op.add_column(
        'itinerary_stops', sa.Column('same_day_position', sa.Integer(), nullable=True)
    )
    op.execute(
        """
        UPDATE itinerary_stops AS stop
        SET same_day_position = ordered.same_day_position
        FROM (
            SELECT id, ROW_NUMBER() OVER (
                PARTITION BY trip_id, planned_start_date
                ORDER BY position, id
            ) - 1 AS same_day_position
            FROM itinerary_stops
        ) AS ordered
        WHERE stop.id = ordered.id
        """
    )
    op.alter_column('itinerary_stops', 'same_day_position', nullable=False)
    op.drop_constraint(
        'uq_itinerary_stops_trip_position', 'itinerary_stops', type_='unique'
    )
    op.drop_constraint(
        'ck_itinerary_stops_position_nonnegative', 'itinerary_stops', type_='check'
    )
    op.drop_column('itinerary_stops', 'position')
    op.create_check_constraint(
        'ck_itinerary_stops_same_day_position_nonnegative',
        'itinerary_stops',
        'same_day_position >= 0',
    )
    op.create_unique_constraint(
        'uq_itinerary_stops_trip_date_position',
        'itinerary_stops',
        ['trip_id', 'planned_start_date', 'same_day_position'],
        deferrable=True,
        initially='DEFERRED',
    )
    op.create_index(
        'ix_itinerary_stops_trip_date_position',
        'itinerary_stops',
        ['trip_id', 'planned_start_date', 'same_day_position'],
        unique=False,
    )
