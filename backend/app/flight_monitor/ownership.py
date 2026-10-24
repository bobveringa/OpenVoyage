"""One monitor per database, pinned to a dedicated physical connection."""

from contextlib import contextmanager

from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session
from sqlalchemy.pool import NullPool

from core.config import settings
from services.flight_settings import FLIGHT_MONITOR_LOCK_KEY


class OwnershipLost(RuntimeError):
    pass


def create_monitor_engine(url=None):
    return create_engine(
        url if url is not None else str(settings.SQLALCHEMY_DATABASE_URI),
        poolclass=NullPool,
        isolation_level='READ COMMITTED',
        connect_args={
            'connect_timeout': 5,
            'options': '-c statement_timeout=10000 -c lock_timeout=10000',
        },
    )


class MonitorOwnership:
    def __init__(self, engine):
        self.engine = engine
        self.connection = None
        self._physical = None

    def _assert_physical(self):
        connection = self.connection
        # Check invalidation *before* accessing .connection or executing SQL:
        # either could otherwise reconnect without owning the advisory lock.
        if connection is None or connection.closed or connection.invalidated:
            raise OwnershipLost('Monitor connection unavailable')
        if connection.connection.dbapi_connection is not self._physical:
            raise OwnershipLost('Monitor physical connection changed')

    def acquire(self):
        if self.connection is not None:
            self.probe()
            return True
        connection = self.engine.connect()
        try:
            acquired = connection.scalar(
                text('SELECT pg_try_advisory_lock(:namespace, :resource)'),
                self._parameters,
            )
            connection.rollback()
            if not acquired:
                connection.close()
                return False
            self.connection = connection
            self._physical = connection.connection.dbapi_connection
            return True
        except BaseException:
            connection.close()
            raise

    @property
    def _parameters(self):
        return dict(zip(('namespace', 'resource'), FLIGHT_MONITOR_LOCK_KEY))

    def probe(self, session=None):
        """Verify ownership without reacquiring (session locks stack).

        Before session work, end the probe's autobegun transaction. During
        session work, probe only through the session and never end its work.
        """
        self._assert_physical()
        statement = text("""SELECT EXISTS (
            SELECT 1 FROM pg_locks WHERE locktype = 'advisory'
            AND pid = pg_backend_pid() AND classid = :namespace
            AND objid = :resource AND objsubid = 2 AND granted
        )""")
        if session is None:
            try:
                owned = self.connection.scalar(statement, self._parameters)
            finally:
                self.connection.rollback()
        else:
            with session.no_autoflush:
                owned = session.scalar(statement, self._parameters)
        self._assert_physical()
        if not owned:
            raise OwnershipLost('Monitor advisory lock lost')

    @contextmanager
    def session(self):
        self.probe()
        assert not self.connection.in_transaction()
        try:
            # No external transaction: service commits reach PostgreSQL and
            # release trip locks. A failed probe can never commit pending work.
            with Session(bind=self.connection) as session:
                yield session
        finally:
            if not self.connection.closed and self.connection.in_transaction():
                self.connection.rollback()

    def close(self):
        connection, self.connection = self.connection, None
        if connection is None:
            return
        try:
            if not connection.closed and not connection.invalidated:
                if connection.in_transaction():
                    connection.rollback()
                if connection.connection.dbapi_connection is self._physical:
                    connection.execute(
                        text('SELECT pg_advisory_unlock(:namespace, :resource)'),
                        self._parameters,
                    )
                    connection.rollback()
        finally:
            # NullPool physically closes; no session lock enters the app pool.
            connection.close()
            self._physical = None
