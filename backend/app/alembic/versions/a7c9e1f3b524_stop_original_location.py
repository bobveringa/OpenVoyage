"""Remember the place a stop was made for, so its marker can move within it.

Adds ``itinerary_stops.original_location_id``, filled from ``location_id``.
The two differ once a member moves the stop's marker.
"""

from alembic import op
import sqlalchemy as sa

revision = 'a7c9e1f3b524'
down_revision = 'f5b7d9e1a346'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        'itinerary_stops', sa.Column('original_location_id', sa.Uuid(), nullable=True)
    )
    op.execute('UPDATE itinerary_stops SET original_location_id = location_id')
    op.alter_column('itinerary_stops', 'original_location_id', nullable=False)
    op.create_foreign_key(
        'fk_itinerary_stops_trip_original_location_id',
        'itinerary_stops',
        'locations',
        ['trip_id', 'original_location_id'],
        ['trip_id', 'id'],
    )
    op.create_index(
        'ix_itinerary_stops_trip_original_location_id',
        'itinerary_stops',
        ['trip_id', 'original_location_id'],
    )


def downgrade() -> None:
    op.drop_index(
        'ix_itinerary_stops_trip_original_location_id', table_name='itinerary_stops'
    )
    op.drop_constraint(
        'fk_itinerary_stops_trip_original_location_id',
        'itinerary_stops',
        type_='foreignkey',
    )
    op.drop_column('itinerary_stops', 'original_location_id')
