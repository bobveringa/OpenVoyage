"""Keep linked flight sessions server-managed when a session is updated."""
from alembic import op

revision = 'a4c6e8f01235'
down_revision = 'a3c5e7f90124'
branch_labels = None
depends_on = None


def upgrade():
    op.execute("""
        CREATE FUNCTION guard_flight_session_source() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
          IF NEW.source <> 'FLIGHT_ESTIMATE' AND EXISTS (
              SELECT 1 FROM tracked_flights WHERE gps_tracking_session_id = NEW.id
          ) THEN
            RAISE EXCEPTION 'Flight requires a flight GPS session' USING ERRCODE = '23514';
          END IF;
          RETURN NEW;
        END $$;
        CREATE TRIGGER flight_session_source BEFORE UPDATE OF source ON gps_tracking_sessions
        FOR EACH ROW EXECUTE FUNCTION guard_flight_session_source();
    """)


def downgrade():
    op.execute('DROP TRIGGER flight_session_source ON gps_tracking_sessions')
    op.execute('DROP FUNCTION guard_flight_session_source()')
