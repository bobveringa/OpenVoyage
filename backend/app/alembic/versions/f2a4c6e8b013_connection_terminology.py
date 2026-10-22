"""Use connections consistently without replacing existing itinerary data."""

from alembic import op
import sqlalchemy as sa

revision = 'f2a4c6e8b013'
down_revision = 'e4b8c2d6f103'
branch_labels = None
depends_on = None


def _rename_constraints(table, replacements):
    inspector = sa.inspect(op.get_bind())
    quote = op.get_bind().dialect.identifier_preparer.quote
    constraints = [
        *inspector.get_foreign_keys(table),
        *inspector.get_unique_constraints(table),
        *inspector.get_check_constraints(table),
        inspector.get_pk_constraint(table),
    ]
    for constraint in constraints:
        old = constraint['name']
        new = old
        for before, after in replacements:
            new = new.replace(before, after)
        if new != old:
            op.execute(
                sa.text(
                    f'ALTER TABLE {quote(table)} RENAME CONSTRAINT {quote(old)} TO {quote(new)}'
                )
            )
    for index in sa.inspect(op.get_bind()).get_indexes(table):
        if index.get('duplicates_constraint'):
            continue
        old = index['name']
        new = old
        for before, after in replacements:
            new = new.replace(before, after)
        if new != old:
            op.execute(sa.text(f'ALTER INDEX {quote(old)} RENAME TO {quote(new)}'))


def upgrade():
    op.rename_table('itinerary_travel_legs', 'itinerary_connections')
    for table in ('itinerary_travel_segments', 'itinerary_planning_artifacts'):
        op.alter_column(table, 'leg_id', new_column_name='connection_id')
    for table in (
        'itinerary_connections',
        'itinerary_travel_segments',
        'itinerary_planning_artifacts',
    ):
        _rename_constraints(
            table,
            (
                ('itinerary_travel_legs', 'itinerary_connections'),
                ('itinerary_legs', 'itinerary_connections'),
                ('_leg_id', '_connection_id'),
            ),
        )


def downgrade():
    historical_names = (
        'ck_itinerary_legs_from_endpoint',
        'ck_itinerary_legs_to_endpoint',
        'ck_itinerary_legs_stop_endpoint',
        'fk_itinerary_legs_trip_from_location_id',
        'fk_itinerary_legs_trip_to_location_id',
        'uq_itinerary_legs_trip_id_id',
        'uq_itinerary_legs_departure',
        'uq_itinerary_legs_return',
    )
    replacements = tuple(
        (name.replace('itinerary_legs', 'itinerary_connections'), name)
        for name in historical_names
    ) + (
        ('itinerary_connections', 'itinerary_travel_legs'),
        ('_connection_id', '_leg_id'),
    )
    for table in (
        'itinerary_connections',
        'itinerary_travel_segments',
        'itinerary_planning_artifacts',
    ):
        _rename_constraints(table, replacements)
    for table in ('itinerary_travel_segments', 'itinerary_planning_artifacts'):
        op.alter_column(table, 'connection_id', new_column_name='leg_id')
    op.rename_table('itinerary_connections', 'itinerary_travel_legs')
