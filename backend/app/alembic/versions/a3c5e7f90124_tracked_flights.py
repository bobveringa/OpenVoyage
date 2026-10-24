"""Independent mobile and flight sessions, and retained flight facts."""

from alembic import op
import sqlalchemy as sa

revision = 'a3c5e7f90124'
down_revision = 'f2a4c6e8b013'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        'gps_tracking_sessions',
        sa.Column('source', sa.String(32), nullable=False, server_default='MOBILE_GPS'),
    )
    op.create_check_constraint(
        'ck_gps_session_source',
        'gps_tracking_sessions',
        "source IN ('MOBILE_GPS', 'FLIGHT_ESTIMATE')",
    )
    op.drop_index(
        'uq_gps_tracking_sessions_trip_open', table_name='gps_tracking_sessions'
    )
    op.create_index(
        'uq_gps_tracking_sessions_trip_open',
        'gps_tracking_sessions',
        ['trip_id', 'source'],
        unique=True,
        postgresql_where=sa.text('ended_at IS NULL AND deleted_at IS NULL'),
    )
    op.create_table(
        'tracked_flights',
        sa.Column('id', sa.Uuid(), primary_key=True),
        sa.Column(
            'trip_id',
            sa.Uuid(),
            sa.ForeignKey('trips.id', ondelete='CASCADE'),
            nullable=False,
        ),
        sa.Column('itinerary_travel_segment_id', sa.Uuid()),
        sa.Column('itinerary_connection_id', sa.Uuid(), nullable=False),
        sa.Column('gps_tracking_session_id', sa.Uuid(), unique=True),
        sa.Column('flight_number', sa.String(16), nullable=False),
        sa.Column(
            'departure_airport_place_id',
            sa.Uuid(),
            sa.ForeignKey('places.id', ondelete='RESTRICT'),
            nullable=False,
        ),
        sa.Column(
            'arrival_airport_place_id',
            sa.Uuid(),
            sa.ForeignKey('places.id', ondelete='RESTRICT'),
        ),
        sa.Column('airline_name', sa.String(255)),
        sa.Column('status', sa.String(32), nullable=False),
        sa.Column('scheduled_departure', sa.DateTime(timezone=True), nullable=False),
        *(
            sa.Column(name, sa.DateTime(timezone=True))
            for name in (
                'scheduled_arrival',
                'estimated_departure',
                'estimated_arrival',
                'actual_departure',
                'actual_arrival',
                'checked_at',
                'next_check_at',
            )
        ),
        sa.Column('completion_source', sa.String(16)),
        sa.Column('stop_reason', sa.String(32)),
        sa.Column('last_check_result', sa.String(32), nullable=False),
        sa.UniqueConstraint(
            'trip_id',
            'flight_number',
            'scheduled_departure',
            'departure_airport_place_id',
            name='uq_tracked_flight_identity',
        ),
        sa.ForeignKeyConstraint(
            ['trip_id', 'itinerary_travel_segment_id'],
            ['itinerary_travel_segments.trip_id', 'itinerary_travel_segments.id'],
            name='fk_tracked_flight_segment',
            ondelete='SET NULL (itinerary_travel_segment_id)',
        ),
        sa.ForeignKeyConstraint(
            ['trip_id', 'gps_tracking_session_id'],
            ['gps_tracking_sessions.trip_id', 'gps_tracking_sessions.id'],
            name='fk_tracked_flight_session',
        ),
        sa.CheckConstraint(
            "completion_source IS NULL OR completion_source IN ('PROVIDER', 'OWNER')"
        ),
        sa.CheckConstraint(
            "stop_reason IS NULL OR stop_reason IN ('MANUAL', 'NEXT_FLIGHT_DEPARTED')"
        ),
        sa.CheckConstraint(
            "flight_number = upper(replace(replace(flight_number, ' ', ''), '-', ''))"
        ),
    )
    op.create_index('ix_tracked_flights_trip_id', 'tracked_flights', ['trip_id'])
    op.create_index(
        'ix_tracked_flights_next_check_at', 'tracked_flights', ['next_check_at']
    )
    op.execute("""
        CREATE FUNCTION check_tracked_flight_source() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
          IF NOT EXISTS (SELECT 1 FROM gps_tracking_sessions WHERE id = NEW.gps_tracking_session_id AND source = 'FLIGHT_ESTIMATE') AND NEW.gps_tracking_session_id IS NOT NULL THEN
            RAISE EXCEPTION 'Flight requires a flight GPS session';
          END IF;
          RETURN NEW;
        END $$;
        CREATE TRIGGER tracked_flight_source BEFORE INSERT OR UPDATE ON tracked_flights
        FOR EACH ROW EXECUTE FUNCTION check_tracked_flight_source();
    """)


def downgrade():
    op.drop_table('tracked_flights')
    op.execute('DROP FUNCTION check_tracked_flight_source()')
    # Refuse a lossy downgrade while flight recordings still exist.
    op.execute(
        "DO $$ BEGIN IF EXISTS (SELECT 1 FROM gps_tracking_sessions WHERE source = 'FLIGHT_ESTIMATE') THEN RAISE EXCEPTION 'Remove flight recordings before downgrading'; END IF; END $$"
    )
    op.drop_index(
        'uq_gps_tracking_sessions_trip_open', table_name='gps_tracking_sessions'
    )
    op.create_index(
        'uq_gps_tracking_sessions_trip_open',
        'gps_tracking_sessions',
        ['trip_id'],
        unique=True,
        postgresql_where=sa.text('ended_at IS NULL AND deleted_at IS NULL'),
    )
    op.drop_constraint('ck_gps_session_source', 'gps_tracking_sessions')
    op.drop_column('gps_tracking_sessions', 'source')
