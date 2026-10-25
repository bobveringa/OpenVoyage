"""Observed tracks and bounded final retrieval; retire legacy flight settings."""

from alembic import op
import sqlalchemy as sa

revision = 'a6e8f0123457'
down_revision = 'a5d7f9012346'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('tracked_flights', sa.Column('provider_flight_id', sa.String(255)))
    op.add_column(
        'tracked_flights',
        sa.Column(
            'final_track_pending', sa.Boolean(), nullable=False, server_default='false'
        ),
    )
    op.add_column(
        'tracked_flights',
        sa.Column(
            'final_track_attempts', sa.Integer(), nullable=False, server_default='0'
        ),
    )
    op.add_column(
        'tracked_flights', sa.Column('final_track_deadline', sa.DateTime(timezone=True))
    )
    op.drop_constraint('ck_gps_session_source', 'gps_tracking_sessions')
    op.create_check_constraint(
        'ck_gps_session_source',
        'gps_tracking_sessions',
        "source IN ('MOBILE_GPS', 'FLIGHT_ESTIMATE', 'FLIGHT_TRACK')",
    )
    op.drop_index(
        'uq_gps_tracking_sessions_trip_open', table_name='gps_tracking_sessions'
    )
    op.create_index(
        'uq_gps_tracking_sessions_trip_open',
        'gps_tracking_sessions',
        [
            'trip_id',
            sa.text(
                "(CASE WHEN source = 'MOBILE_GPS' THEN 'MOBILE_GPS' ELSE 'FLIGHT' END)"
            ),
        ],
        unique=True,
        postgresql_where=sa.text('ended_at IS NULL AND deleted_at IS NULL'),
    )
    op.execute("""
        CREATE OR REPLACE FUNCTION check_tracked_flight_source() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
          IF NEW.gps_tracking_session_id IS NOT NULL AND NOT EXISTS (
            SELECT 1 FROM gps_tracking_sessions WHERE id = NEW.gps_tracking_session_id AND source IN ('FLIGHT_ESTIMATE', 'FLIGHT_TRACK')
          ) THEN
            RAISE EXCEPTION 'Flight requires a flight GPS session';
          END IF;
          RETURN NEW;
        END $$;
        CREATE OR REPLACE FUNCTION guard_flight_session_source() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
          IF NEW.source NOT IN ('FLIGHT_ESTIMATE', 'FLIGHT_TRACK') AND EXISTS (
            SELECT 1 FROM tracked_flights WHERE gps_tracking_session_id = NEW.id
          ) THEN
            RAISE EXCEPTION 'Flight requires a flight GPS session' USING ERRCODE = '23514';
          END IF;
          RETURN NEW;
        END $$;
        INSERT INTO app_settings (key, value, created_at, updated_at)
        SELECT 'flights.check_interval_minutes', '30'::jsonb, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
        FROM app_settings WHERE key = 'flights.update_frequency'
        ON CONFLICT (key) DO NOTHING;
        INSERT INTO app_settings (key, value, created_at, updated_at)
        SELECT 'flights.check_more_often_before_departure', to_jsonb(value <> '"minimal"'::jsonb), CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
        FROM app_settings WHERE key = 'flights.update_frequency'
        ON CONFLICT (key) DO NOTHING;
        UPDATE app_settings SET value = '"none"'::jsonb, updated_at = CURRENT_TIMESTAMP
        WHERE key = 'flights.provider' AND value = '"aerodatabox"'::jsonb;
        DELETE FROM app_settings WHERE key IN ('flights.update_frequency', 'flights.aerodatabox_base_url', 'flights.aerodatabox_rapidapi_host', 'flights.rapidapi_api_key');
    """)


def downgrade():
    op.execute("""
        DO $$ BEGIN
          IF EXISTS (SELECT 1 FROM gps_tracking_sessions WHERE source = 'FLIGHT_TRACK')
             OR EXISTS (SELECT 1 FROM tracked_flights WHERE final_track_pending) THEN
            RAISE EXCEPTION 'Settle pending retrievals and remove observed flight recordings before downgrading';
          END IF;
        END $$;
        INSERT INTO app_settings (key, value, created_at, updated_at)
        SELECT 'flights.update_frequency', CASE WHEN value = 'false'::jsonb THEN '"minimal"'::jsonb ELSE '"balanced"'::jsonb END,
          CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
        FROM app_settings WHERE key = 'flights.check_more_often_before_departure'
        ON CONFLICT (key) DO NOTHING;
        DELETE FROM app_settings WHERE key IN ('flights.check_interval_minutes', 'flights.check_more_often_before_departure');
        CREATE OR REPLACE FUNCTION check_tracked_flight_source() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
          IF NEW.gps_tracking_session_id IS NOT NULL AND NOT EXISTS (
            SELECT 1 FROM gps_tracking_sessions WHERE id = NEW.gps_tracking_session_id AND source = 'FLIGHT_ESTIMATE'
          ) THEN RAISE EXCEPTION 'Flight requires a flight GPS session'; END IF;
          RETURN NEW;
        END $$;
        CREATE OR REPLACE FUNCTION guard_flight_session_source() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
          IF NEW.source <> 'FLIGHT_ESTIMATE' AND EXISTS (
            SELECT 1 FROM tracked_flights WHERE gps_tracking_session_id = NEW.id
          ) THEN RAISE EXCEPTION 'Flight requires a flight GPS session' USING ERRCODE = '23514'; END IF;
          RETURN NEW;
        END $$;
    """)
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
    op.drop_constraint('ck_gps_session_source', 'gps_tracking_sessions')
    op.create_check_constraint(
        'ck_gps_session_source',
        'gps_tracking_sessions',
        "source IN ('MOBILE_GPS', 'FLIGHT_ESTIMATE')",
    )
    for name in (
        'final_track_deadline',
        'final_track_attempts',
        'final_track_pending',
        'provider_flight_id',
    ):
        op.drop_column('tracked_flights', name)
