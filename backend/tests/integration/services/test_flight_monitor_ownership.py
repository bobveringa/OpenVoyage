import pytest
from sqlalchemy import event, select, text
from sqlalchemy.exc import DBAPIError
from sqlalchemy.orm import Session
from sqlalchemy.pool import NullPool

from flight_monitor.ownership import (
    MonitorOwnership,
    OwnershipLost,
    create_monitor_engine,
)
from models.database.settings import AppSetting
from services.flight_settings import FLIGHT_MONITOR_LOCK_KEY


@pytest.fixture
def monitor_engine(engine):
    dedicated = create_monitor_engine(engine.url)
    try:
        yield dedicated
    finally:
        dedicated.dispose()


@pytest.fixture
def ownership(monitor_engine):
    owner = MonitorOwnership(monitor_engine)
    assert owner.acquire()
    try:
        yield owner
    finally:
        owner.close()


def test_single_owner_probes_never_stack_and_release_hands_over(
    monitor_engine, ownership
):
    standby = MonitorOwnership(monitor_engine)
    try:
        assert isinstance(monitor_engine.pool, NullPool)
        for _ in range(3):
            assert ownership.acquire()
            assert not ownership.connection.in_transaction()
            assert not standby.acquire()
            assert standby.connection is None
            with ownership.session() as db:
                ownership.probe(db)
                db.commit()
                ownership.probe(db)
                db.commit()
            assert not ownership.connection.in_transaction()
        physical = ownership.connection.connection.dbapi_connection
        ownership.close()
        assert physical.closed
        assert standby.acquire()  # one unlock suffices, despite repeated probes
    finally:
        standby.close()


def test_probe_boundaries_preserve_real_commits_and_rollback_pending_work(
    engine, ownership
):
    with engine.begin() as connection:
        connection.execute(
            text('CREATE TABLE monitor_commit_test (id int PRIMARY KEY, value int)')
        )
        connection.execute(text('INSERT INTO monitor_commit_test VALUES (1, 0)'))

    def visible_and_unlocked(expected):
        with engine.connect() as observer:
            assert (
                observer.scalar(
                    text(
                        'SELECT value FROM monitor_commit_test WHERE id=1 FOR UPDATE NOWAIT'
                    )
                )
                == expected
            )
            assert not observer.scalar(
                text('SELECT pg_try_advisory_lock(:a, :b)'),
                dict(zip(('a', 'b'), FLIGHT_MONITOR_LOCK_KEY)),
            )

    ownership.probe()  # later cycle-entry probe must also end its transaction
    with pytest.raises(ValueError), ownership.session() as db:
        for value in (1, 2):
            ownership.probe(db)
            db.execute(
                text('UPDATE monitor_commit_test SET value=:v WHERE id=1'), {'v': value}
            )
            ownership.probe(db)
            db.commit()
            visible_and_unlocked(value)
        db.execute(text('UPDATE monitor_commit_test SET value=3 WHERE id=1'))
        ownership.probe(db)
        raise ValueError('later cycle failure')
    assert not ownership.connection.in_transaction()
    visible_and_unlocked(2)
    # Every later cycle must enter without an external transaction too.
    with ownership.session() as db:
        db.execute(text('UPDATE monitor_commit_test SET value=4 WHERE id=1'))
        db.commit()
        visible_and_unlocked(4)
    assert not ownership.connection.in_transaction()


def test_invalidated_connection_cannot_reconnect_or_commit_pending_changes(
    engine, monitor_engine, ownership
):
    connects = []
    event.listen(monitor_engine, 'connect', lambda *args: connects.append(True))
    with pytest.raises(OwnershipLost), ownership.session() as db:
        db.add(AppSetting(key='flights.provider', value='flightaware'))
        db.flush()
        ownership.connection.invalidate()
        ownership.probe(db)
    assert connects == []
    with Session(engine) as observer:
        assert observer.get(AppSetting, 'flights.provider') is None
    ownership.close()
    assert ownership.acquire()
    assert connects == [True]


def test_failed_probe_does_not_autoflush_or_commit(engine, ownership):
    with ownership.session() as db:
        pending = AppSetting(key='flights.provider', value='flightaware')
        db.add(pending)
        ownership.probe(db)
        assert pending in db.new
        db.flush()
        # Unlock to simulate lost ownership on an otherwise usable connection.
        db.execute(
            text('SELECT pg_advisory_unlock(:a, :b)'),
            dict(zip(('a', 'b'), FLIGHT_MONITOR_LOCK_KEY)),
        )
        with pytest.raises(OwnershipLost):
            ownership.probe(db)
        db.rollback()
    with Session(engine) as observer:
        assert observer.scalar(select(AppSetting)) is None
    assert not ownership.connection.in_transaction()


def test_disconnect_during_work_discards_results_and_allows_takeover(
    engine, monitor_engine, ownership
):
    with pytest.raises(DBAPIError), ownership.session() as db:
        pid = db.scalar(text('SELECT pg_backend_pid()'))
        db.add(AppSetting(key='flights.provider', value='flightaware'))
        db.flush()
        with engine.connect() as killer:
            assert killer.scalar(
                text('SELECT pg_terminate_backend(:pid)'), {'pid': pid}
            )
        ownership.probe(db)
    with pytest.raises(OwnershipLost):
        ownership.probe()
    with Session(engine) as observer:
        assert observer.get(AppSetting, 'flights.provider') is None
    standby = MonitorOwnership(monitor_engine)
    try:
        assert standby.acquire()
    finally:
        standby.close()


def test_monitor_timeouts_are_finite_and_wait_failure_rolls_back(engine, ownership):
    with ownership.session() as db:
        assert db.scalar(text('SHOW statement_timeout')) == '10s'
        assert db.scalar(text('SHOW lock_timeout')) == '10s'
    with engine.begin() as locker:
        locker.execute(text('CREATE TABLE monitor_wait_test (id int PRIMARY KEY)'))
        locker.execute(text('INSERT INTO monitor_wait_test VALUES (1)'))
    with engine.begin() as locker:
        locker.execute(text('SELECT id FROM monitor_wait_test FOR UPDATE'))
        with pytest.raises(DBAPIError), ownership.session() as db:
            # Shorten only the test's wait; production defaults checked above.
            db.execute(text("SET LOCAL lock_timeout='100ms'"))
            db.execute(text('SELECT id FROM monitor_wait_test FOR UPDATE'))
    assert not ownership.connection.in_transaction()


def test_monitor_cycle_runs_while_maintenance_is_blocked(monitor_engine, ownership):
    import threading
    from flight_monitor.runtime import FlightMonitorRuntime

    blocked, release, cycle = threading.Event(), threading.Event(), threading.Event()
    maintenance = threading.Thread(target=lambda: (blocked.set(), release.wait(5)))
    runtime = FlightMonitorRuntime(engine_factory=lambda: monitor_engine)
    runtime._cycle = lambda _: (cycle.set() or 0, 'none')
    maintenance.start()
    ownership.close()
    runtime.start()
    try:
        assert blocked.wait(5)
        assert cycle.wait(5)
        assert maintenance.is_alive()
    finally:
        runtime.stop()
        release.set()
        maintenance.join(5)


def test_shutdown_waits_for_database_timeout_then_closes_on_worker(
    engine, monitor_engine
):
    import threading
    from flight_monitor.runtime import FlightMonitorRuntime

    with engine.begin() as connection:
        connection.execute(
            text('CREATE TABLE monitor_shutdown_test (id int PRIMARY KEY)')
        )
        connection.execute(text('INSERT INTO monitor_shutdown_test VALUES (1)'))
    waiting, stopped = threading.Event(), threading.Event()
    runtime = FlightMonitorRuntime(engine_factory=lambda: monitor_engine)

    def cycle(owner):
        with owner.session() as db:
            db.execute(text("SET LOCAL lock_timeout='1s'"))
            waiting.set()
            db.execute(text('SELECT id FROM monitor_shutdown_test FOR UPDATE'))
        return 0, 'none'

    runtime._cycle = cycle
    with engine.begin() as locker:
        locker.execute(text('SELECT id FROM monitor_shutdown_test FOR UPDATE'))
        runtime.start()
        stopper = threading.Thread(target=lambda: (runtime.stop(), stopped.set()))
        try:
            assert waiting.wait(10)
            stopper.start()
            assert runtime._stop.wait(5)
            assert not stopped.is_set()
        finally:
            runtime.stop()
            if stopper.ident is not None:
                stopper.join(10)
    assert stopped.is_set()
    assert not runtime._thread.is_alive()
