"""Replace alpha travel legs with ordered segments and private planning artifacts."""

from alembic import op
import sqlalchemy as sa

revision = 'c7e9f1a3b502'
down_revision = 'b6d8e0f2a491'
branch_labels = None
depends_on = None


def upgrade():
    for name, kind in [
        ('feature_code', sa.String(10)),
        ('iata_code', sa.String(3)),
        ('icao_code', sa.String(4)),
        ('timezone', sa.String(64)),
    ]:
        op.add_column('places', sa.Column(name, kind, nullable=True))
    op.create_unique_constraint('uq_places_iata_code', 'places', ['iata_code'])
    op.create_unique_constraint('uq_places_icao_code', 'places', ['icao_code'])
    op.add_column('locations', sa.Column('source_place_id', sa.Uuid(), nullable=True))
    op.create_foreign_key(
        'fk_locations_source_place',
        'locations',
        'places',
        ['source_place_id'],
        ['id'],
        ondelete='RESTRICT',
    )
    op.create_index('ix_locations_source_place_id', 'locations', ['source_place_id'])
    op.create_unique_constraint(
        'uq_itinerary_legs_trip_id_id', 'itinerary_travel_legs', ['trip_id', 'id']
    )
    op.execute(
        "\nCREATE TABLE itinerary_travel_segments (\n\tid UUID NOT NULL, \n\ttrip_id UUID NOT NULL, \n\tleg_id UUID NOT NULL, \n\tposition INTEGER NOT NULL, \n\ttravel_mode VARCHAR(32) NOT NULL, \n\tmode_source VARCHAR(8) NOT NULL, \n\tnotes TEXT NOT NULL, \n\tservice_company VARCHAR(255), \n\tservice_number VARCHAR(255), \n\tfrom_location_id UUID, \n\tto_location_id UUID, \n\tvia_location_id UUID, \n\tinput_version BIGINT DEFAULT '1' NOT NULL, \n\tcreated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, \n\tupdated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, \n\tPRIMARY KEY (id), \n\tUNIQUE (trip_id, id), \n\tUNIQUE (leg_id, position) DEFERRABLE INITIALLY DEFERRED, \n\tFOREIGN KEY(trip_id, leg_id) REFERENCES itinerary_travel_legs (trip_id, id) ON DELETE CASCADE, \n\tFOREIGN KEY(trip_id, from_location_id) REFERENCES locations (trip_id, id), \n\tFOREIGN KEY(trip_id, to_location_id) REFERENCES locations (trip_id, id), \n\tFOREIGN KEY(trip_id, via_location_id) REFERENCES locations (trip_id, id), \n\tCHECK (position >= 0 AND input_version >= 1), \n\tCHECK (mode_source IN ('AUTO', 'USER')), \n\tCHECK (via_location_id IS NULL OR travel_mode IN ('CAR', 'BIKE', 'WALK')), \n\tFOREIGN KEY(trip_id) REFERENCES trips (id) ON DELETE CASCADE\n)\n\n"
    )
    op.execute(
        'CREATE INDEX ix_itinerary_travel_segments_from_location_id ON itinerary_travel_segments (from_location_id)'
    )
    op.execute(
        'CREATE INDEX ix_itinerary_travel_segments_leg_id ON itinerary_travel_segments (leg_id)'
    )
    op.execute(
        'CREATE INDEX ix_itinerary_travel_segments_to_location_id ON itinerary_travel_segments (to_location_id)'
    )
    op.execute(
        'CREATE INDEX ix_itinerary_travel_segments_via_location_id ON itinerary_travel_segments (via_location_id)'
    )
    op.execute(
        '\nCREATE TABLE itinerary_segment_flights (\n\tsegment_id UUID NOT NULL, \n\ttrip_id UUID NOT NULL, \n\tflight_number VARCHAR(16), \n\tdeparture_date DATE, \n\tdeparture_airport_place_id UUID, \n\tarrival_airport_place_id UUID, \n\tairline_name VARCHAR(255), \n\tlookup_owner_user_id UUID, \n\tlookup JSONB, \n\tPRIMARY KEY (segment_id), \n\tFOREIGN KEY(trip_id, segment_id) REFERENCES itinerary_travel_segments (trip_id, id) ON DELETE CASCADE, \n\tCHECK ((lookup IS NULL) = (lookup_owner_user_id IS NULL)), \n\tFOREIGN KEY(departure_airport_place_id) REFERENCES places (id) ON DELETE RESTRICT, \n\tFOREIGN KEY(arrival_airport_place_id) REFERENCES places (id) ON DELETE RESTRICT, \n\tFOREIGN KEY(lookup_owner_user_id) REFERENCES users (id) ON DELETE RESTRICT\n)\n\n'
    )
    op.execute(
        'CREATE INDEX ix_itinerary_segment_flights_arrival_airport_place_id ON itinerary_segment_flights (arrival_airport_place_id)'
    )
    op.execute(
        'CREATE INDEX ix_itinerary_segment_flights_departure_airport_place_id ON itinerary_segment_flights (departure_airport_place_id)'
    )
    op.execute(
        'CREATE INDEX ix_itinerary_segment_flights_lookup_owner_user_id ON itinerary_segment_flights (lookup_owner_user_id)'
    )
    op.execute(
        "\nCREATE TABLE itinerary_segment_routes (\n\tsegment_id UUID NOT NULL, \n\ttrip_id UUID NOT NULL, \n\tinput_version BIGINT NOT NULL, \n\tinput_hash VARCHAR(64) NOT NULL, \n\tstatus VARCHAR(32) NOT NULL, \n\tprovider VARCHAR(64), \n\tgeometry_geojson JSONB, \n\tdistance_meters INTEGER, \n\tduration_seconds INTEGER, \n\terror_code VARCHAR(64), \n\tgenerated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, \n\tPRIMARY KEY (segment_id), \n\tFOREIGN KEY(trip_id, segment_id) REFERENCES itinerary_travel_segments (trip_id, id) ON DELETE CASCADE, \n\tCHECK (status IN ('READY', 'FAILED', 'UNSUPPORTED')), \n\tCHECK (status <> 'READY' OR (geometry_geojson IS NOT NULL AND provider IS NOT NULL)), \n\tCHECK (distance_meters IS NULL OR distance_meters >= 0), \n\tCHECK (duration_seconds IS NULL OR duration_seconds >= 0)\n)\n\n"
    )
    op.execute(
        "\nCREATE TABLE itinerary_planning_artifacts (\n\tid UUID NOT NULL, \n\tkind VARCHAR(32) NOT NULL, \n\ttrip_id UUID NOT NULL, \n\tleg_id UUID NOT NULL, \n\tcreated_by_user_id UUID NOT NULL, \n\titinerary_revision BIGINT, \n\tinput_hash VARCHAR(64) NOT NULL, \n\tpayload JSONB NOT NULL, \n\texpires_at TIMESTAMP WITH TIME ZONE NOT NULL, \n\tcreated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, \n\tPRIMARY KEY (id), \n\tFOREIGN KEY(trip_id, leg_id) REFERENCES itinerary_travel_legs (trip_id, id) ON DELETE CASCADE, \n\tCHECK (kind IN ('FLIGHT_CANDIDATE', 'PREVIEW')), \n\tCHECK ((kind = 'PREVIEW') = (itinerary_revision IS NOT NULL)), \n\tFOREIGN KEY(trip_id) REFERENCES trips (id) ON DELETE CASCADE, \n\tFOREIGN KEY(created_by_user_id) REFERENCES users (id) ON DELETE CASCADE\n)\n\n"
    )
    op.execute(
        'CREATE INDEX ix_itinerary_planning_artifacts_expires_at ON itinerary_planning_artifacts (expires_at)'
    )
    op.execute(
        'CREATE INDEX ix_planning_artifacts_scope ON itinerary_planning_artifacts (trip_id, created_by_user_id, leg_id, kind, input_hash)'
    )
    # Use only existing coordinates/estimates; never contact providers during upgrade.
    op.execute("""
        INSERT INTO itinerary_travel_segments
            (id, trip_id, leg_id, position, travel_mode, mode_source, notes, input_version)
        SELECT gen_random_uuid(), l.trip_id, l.id, 0,
          CASE WHEN l.travel_mode <> 'UNKNOWN' THEN l.travel_mode
               WHEN (r.status = 'READY' AND r.duration_seconds >= 43200)
                 OR 6371.0088 * 2 * asin(sqrt(least(1.0,
                   power(sin(radians(b.latitude-a.latitude)/2),2) +
                   cos(radians(a.latitude))*cos(radians(b.latitude))*power(sin(radians(b.longitude-a.longitude)/2),2)))) >= 1000
               THEN 'FLIGHT' ELSE 'CAR' END,
          CASE WHEN l.travel_mode = 'UNKNOWN' THEN 'AUTO' ELSE 'USER' END,
          '', 1
        FROM itinerary_travel_legs l
        JOIN itinerary_stops f ON f.id=l.from_stop_id
        JOIN itinerary_stops t ON t.id=l.to_stop_id
        JOIN locations a ON a.id=f.location_id
        JOIN locations b ON b.id=t.location_id
        LEFT JOIN itinerary_travel_leg_routes r ON r.id=l.id
    """)
    op.drop_table('itinerary_travel_leg_routes')
    for name in ['travel_mode', 'operator', 'reference']:
        op.drop_column('itinerary_travel_legs', name)
    op.execute("DELETE FROM jobs WHERE key = 'itinerary_route_maintenance'")


def downgrade():
    # Mixed travel cannot be converted back; restore the old empty alpha structure.
    for name in [
        'itinerary_planning_artifacts',
        'itinerary_segment_routes',
        'itinerary_segment_flights',
        'itinerary_travel_segments',
    ]:
        op.drop_table(name)
    op.drop_constraint(
        'uq_itinerary_legs_trip_id_id', 'itinerary_travel_legs', type_='unique'
    )
    op.add_column(
        'itinerary_travel_legs',
        sa.Column(
            'travel_mode', sa.String(32), nullable=False, server_default='UNKNOWN'
        ),
    )
    op.add_column(
        'itinerary_travel_legs', sa.Column('operator', sa.String(255), nullable=True)
    )
    op.add_column(
        'itinerary_travel_legs', sa.Column('reference', sa.String(255), nullable=True)
    )
    from pathlib import Path
    import runpy

    previous = runpy.run_path(
        str(Path(__file__).with_name('b4d2f7a1c9e3_itinerary_travel_leg_routes.py'))
    )
    previous['upgrade']()
    op.drop_index('ix_locations_source_place_id', table_name='locations')
    op.drop_constraint('fk_locations_source_place', 'locations', type_='foreignkey')
    op.drop_column('locations', 'source_place_id')
    op.drop_constraint('uq_places_iata_code', 'places', type_='unique')
    op.drop_constraint('uq_places_icao_code', 'places', type_='unique')
    for name in ['feature_code', 'iata_code', 'icao_code', 'timezone']:
        op.drop_column('places', name)
