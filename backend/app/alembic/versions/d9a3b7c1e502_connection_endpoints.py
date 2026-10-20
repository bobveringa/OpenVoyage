"""Allow trip-scoped locations as departure and return connection endpoints."""

from alembic import op
import sqlalchemy as sa

revision = 'd9a3b7c1e502'
down_revision = 'c7e9f1a3b502'
branch_labels = None
depends_on = None
TABLE = 'itinerary_travel_legs'


def upgrade():
    for side in ('from', 'to'):
        op.alter_column(
            TABLE, f'{side}_stop_id', existing_type=sa.Uuid(), nullable=True
        )
        op.add_column(TABLE, sa.Column(f'{side}_location_id', sa.Uuid(), nullable=True))
        op.create_foreign_key(
            f'fk_itinerary_legs_trip_{side}_location_id',
            TABLE,
            'locations',
            ['trip_id', f'{side}_location_id'],
            ['trip_id', 'id'],
        )
        op.create_check_constraint(
            f'ck_itinerary_legs_{side}_endpoint',
            TABLE,
            f'({side}_stop_id IS NOT NULL) <> ({side}_location_id IS NOT NULL)',
        )
    op.create_check_constraint(
        'ck_itinerary_legs_stop_endpoint',
        TABLE,
        'from_stop_id IS NOT NULL OR to_stop_id IS NOT NULL',
    )
    op.drop_constraint('ck_itinerary_travel_legs_distinct_stops', TABLE, type_='check')
    op.create_check_constraint(
        'ck_itinerary_travel_legs_distinct_stops',
        TABLE,
        'from_stop_id IS NULL OR to_stop_id IS NULL OR from_stop_id <> to_stop_id',
    )
    for name, side in (('departure', 'from'), ('return', 'to')):
        op.create_index(
            f'uq_itinerary_legs_{name}',
            TABLE,
            ['trip_id'],
            unique=True,
            postgresql_where=sa.text(f'{side}_stop_id IS NULL'),
        )


def downgrade():
    # Never discard an outer journey to make the old NOT NULL schema fit.
    op.execute("""DO $$ BEGIN
        IF EXISTS (SELECT 1 FROM itinerary_travel_legs
                   WHERE from_stop_id IS NULL OR to_stop_id IS NULL) THEN
            RAISE EXCEPTION 'Remove departure and return connections before downgrading';
        END IF;
    END $$""")
    for name in ('departure', 'return'):
        op.drop_index(f'uq_itinerary_legs_{name}', table_name=TABLE)
    op.drop_constraint('ck_itinerary_legs_stop_endpoint', TABLE, type_='check')
    op.drop_constraint('ck_itinerary_travel_legs_distinct_stops', TABLE, type_='check')
    op.create_check_constraint(
        'ck_itinerary_travel_legs_distinct_stops', TABLE, 'from_stop_id <> to_stop_id'
    )
    for side in ('from', 'to'):
        op.drop_constraint(f'ck_itinerary_legs_{side}_endpoint', TABLE, type_='check')
        op.drop_constraint(
            f'fk_itinerary_legs_trip_{side}_location_id', TABLE, type_='foreignkey'
        )
        op.drop_column(TABLE, f'{side}_location_id')
        op.alter_column(
            TABLE, f'{side}_stop_id', existing_type=sa.Uuid(), nullable=False
        )
