"""Monitor orchestration and settings races against real PostgreSQL."""
# ruff: noqa: F811 -- reused flight lifecycle fixture

import threading
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from functools import partial
from unittest.mock import Mock

import pytest
from sqlalchemy import event, select, text
from sqlalchemy.orm import Session
from sqlalchemy.exc import DBAPIError

from core.config import settings
from core.app_settings_encryption import AppSettingsEncryption
from factories.trips import create_trip
from flight_monitor.ownership import (
    MonitorOwnership,
    OwnershipLost,
    create_monitor_engine,
)
from flight_monitor.runtime import FlightMonitorRuntime
from integration.api.test_flight_tracking import START, movement, setup  # noqa: F401
from models.database.settings import AppSetting
from models.database.tracked_flights import TrackedFlight
from models.database.trips import Trip
from services.app_settings_service import AppSettingsCache, AppSettingsService
from services.flight_providers.flight_provider import FlightUnavailable
from services.flight_settings import (
    FlightSettingsSnapshot,
    configuration_is_current,
    lock_flight_settings,
    FLIGHT_MONITOR_LOCK_KEY,
)
from services.gps.flight_tracking_service import FlightTrackingService


@pytest.fixture
def monitor_engine(engine):
    dedicated = create_monitor_engine(engine.url)
    try:
        yield dedicated
    finally:
        dedicated.dispose()


def configure(db, key, value):
    AppSettingsService(db, cache=AppSettingsCache()).update_setting(key, value, None)


def poll_owned(engine, provider, now, *, cancelled=lambda: False):
    owner = MonitorOwnership(engine)
    try:
        assert owner.acquire()
        with owner.session() as db:
            snapshot = FlightSettingsSnapshot.load(db)
            return FlightTrackingService(db).poll_due(
                provider,
                now,
                cancelled=cancelled,
                verify_ownership=partial(owner.probe, db),
                configuration_is_current=partial(
                    configuration_is_current, db, snapshot
                ),
            )
    finally:
        owner.close()


@pytest.mark.parametrize('provider_name', ['flightaware', 'none'])
def test_runtime_resolves_only_selected_credentials_after_key_rotation(
    setup,
    monitor_engine,
    monkeypatch,
    provider_name,
):
    s = setup
    monkeypatch.setattr(settings, 'SECRET_KEY', 'old-secret-key')
    s.db.add(AppSetting(key='flights.rapidapi_api_key', secret_value='v1:unreadable-inactive'))
    s.db.commit()
    configure(s.db, 'flights.flightaware_api_key', 'old-fa')
    monkeypatch.setattr(settings, 'SECRET_KEY', 'rotated-secret-key')
    selected_key = 'flights.flightaware_api_key'
    if provider_name != 'none':
        configure(s.db, selected_key, 'working-key')
    configure(s.db, 'flights.provider', provider_name)
    decrypts = []
    original = AppSettingsEncryption.decrypt

    def decrypt(self, ciphertext):
        value = original(self, ciphertext)
        decrypts.append(value)
        return value

    monkeypatch.setattr(AppSettingsEncryption, 'decrypt', decrypt)
    monkeypatch.setattr('services.gps.flight_tracking_service.utcnow', lambda: START)
    track = Mock(return_value=[movement(s, status='BOARDING')])
    monkeypatch.setattr(
        'services.flight_providers.flightaware_flight_provider.FlightAwareFlightProvider.track',
        track,
    )
    before = s.flight.next_check_at
    owner = MonitorOwnership(monitor_engine)
    try:
        assert owner.acquire()
        runtime = FlightMonitorRuntime()
        calls, adapter = runtime._cycle(owner)
        assert adapter == provider_name
        assert calls == (0 if provider_name == 'none' else 1)
        assert decrypts == ([] if provider_name == 'none' else ['working-key'])
    finally:
        owner.close()
    s.db.expire_all()
    if provider_name == 'none':
        track.assert_not_called()
        assert s.flight.next_check_at == before
        assert s.flight.last_check_result == 'NOT_CHECKED'
    else:
        assert s.flight.last_check_result == 'OK'


def test_snapshot_bypasses_identity_map_cache_and_tracks_absence(engine, db_session):
    configure(db_session, 'flights.provider', 'flightaware')
    service = AppSettingsService(db_session)
    assert service.get_value('flights.provider') == 'flightaware'
    cached_row = db_session.get(AppSetting, 'flights.provider')
    old = FlightSettingsSnapshot.load(db_session)
    with Session(engine) as other:
        configure(other, 'flights.provider', 'none')
    assert cached_row.value == 'flightaware'
    assert service.get_value('flights.provider') == 'flightaware'
    current = FlightSettingsSnapshot.load(db_session)
    assert old != current
    assert current.reader(db_session).get_value('flights.provider') == 'none'
    assert (
        current.reader(db_session).get_value('flights.check_interval_minutes') == 30
    )
    with Session(engine) as other:
        configure(other, 'flights.check_interval_minutes', 30)
    assert FlightSettingsSnapshot.load(db_session) != current


@pytest.mark.parametrize(
    'change',
    ['credential', 'reset', 'provider', 'same_default', 'same_value', 'unchanged'],
)
def test_old_configuration_failure_cannot_undo_settings_fix(
    setup,
    engine,
    monitor_engine,
    change,
    monkeypatch,
):
    s = setup
    monkeypatch.setattr('services.app_settings_service.utcnow', lambda: START + timedelta(minutes=2))
    unrequested = s.add('KL456', START + timedelta(minutes=1))
    configure(s.db, 'flights.provider', 'flightaware')
    configure(s.db, 'flights.flightaware_api_key', 'old-key')
    # Unreadable inactive key must never break the raw comparison.
    s.db.add(
        AppSetting(key='flights.rapidapi_api_key', secret_value='v1:unreadable')
    )
    s.db.commit()
    entered, release = threading.Event(), threading.Event()
    provider = Mock(name='fake')

    def track(request):
        entered.set()
        assert release.wait(10)
        raise FlightUnavailable(result='CONFIGURATION_ERROR')

    provider.track.side_effect = track
    due_before = {f.id: f.next_check_at for f in (s.flight, unrequested)}
    with ThreadPoolExecutor(max_workers=1) as executor:
        work = executor.submit(
            poll_owned, monitor_engine, provider, START + timedelta(minutes=2)
        )
        try:
            assert entered.wait(10)
            with Session(engine) as other:
                if change == 'credential':
                    configure(other, 'flights.flightaware_api_key', 'fixed-key')
                elif change == 'reset':
                    AppSettingsService(other, cache=AppSettingsCache()).reset_setting(
                        'flights.flightaware_api_key'
                    )
                elif change == 'provider':
                    configure(other, 'flights.provider', 'none')
                elif change == 'same_default':
                    configure(other, 'flights.check_interval_minutes', 30)
                elif change == 'same_value':
                    # Same plaintext, different ciphertext is a raw change.
                    configure(other, 'flights.flightaware_api_key', 'old-key')
        finally:
            release.set()
        assert work.result(10) == 1
    assert provider.track.call_count == 1
    s.db.expire_all()
    for flight in (s.flight, unrequested):
        if change == 'unchanged':
            assert flight.last_check_result == 'CONFIGURATION_ERROR'
            assert flight.next_check_at is None
        else:
            assert flight.last_check_result == 'NOT_CHECKED'
            assert flight.next_check_at == (START + timedelta(minutes=12) if change == 'same_default' else due_before[flight.id])
    if change == 'credential':
        # No second settings edit is needed to resume on the next cycle.
        good = Mock()
        good.track.return_value = [movement(s, status='BOARDING')]
        poll_owned(monitor_engine, good, START + timedelta(minutes=2))
        s.db.expire_all()
        assert s.flight.last_check_result == 'OK'


@pytest.mark.parametrize('reset', [False, True])
def test_configuration_application_serializes_before_settings_update(
    setup,
    engine,
    monitor_engine,
    reset,
):
    s = setup
    configure(s.db, 'flights.provider', 'flightaware')
    configure(s.db, 'flights.flightaware_api_key', 'bad-key')
    locked, updating = threading.Event(), threading.Event()
    owner = MonitorOwnership(monitor_engine)
    assert owner.acquire()
    s.db.commit()

    def update():
        assert locked.wait(10)
        with Session(engine) as update_db:
            updating.set()
            if reset:
                AppSettingsService(update_db).reset_setting('flights.flightaware_api_key')
            else:
                configure(update_db, 'flights.flightaware_api_key', 'fixed')

    provider = Mock()
    provider.track.side_effect = FlightUnavailable(result='CONFIGURATION_ERROR')
    try:
        with ThreadPoolExecutor(max_workers=1) as executor:
            future = executor.submit(update)
            with owner.session() as db:
                snapshot = FlightSettingsSnapshot.load(db)

                def guard():
                    assert configuration_is_current(db, snapshot)
                    locked.set()
                    assert updating.wait(10)
                    # Observe a real blocked PostgreSQL lock request before
                    # committing the failure and allowing admin recovery.
                    for _ in range(100):
                        with engine.connect() as observer:
                            waiting = observer.scalar(
                                text(
                                    "SELECT count(*) FROM pg_locks WHERE locktype='advisory' AND NOT granted"
                                )
                            )
                        if waiting:
                            assert not future.done()
                            return True
                    raise AssertionError('settings update did not wait for monitor')

                try:
                    FlightTrackingService(db).poll_due(
                        provider,
                        START,
                        configuration_is_current=guard,
                        verify_ownership=partial(owner.probe, db),
                    )
                finally:
                    locked.set()
            future.result(10)
    finally:
        owner.close()
    s.db.expire_all()
    assert s.flight.last_check_result == 'NOT_CHECKED'
    assert s.flight.next_check_at is not None


def test_cancellation_applies_collected_facts_without_requesting_backlog(
    setup, monitor_engine
):
    s = setup
    second = s.add('KL456', START + timedelta(minutes=1))
    cancelled = threading.Event()
    provider = Mock()

    def track(request):
        cancelled.set()
        return [movement(s, departure_confirmed=True, actual_departure=START)]

    provider.track.side_effect = track
    poll_owned(
        monitor_engine,
        provider,
        START + timedelta(minutes=2),
        cancelled=cancelled.is_set,
    )
    s.db.expire_all()
    assert provider.track.call_count == 1
    assert s.flight.last_check_result == 'OK'
    assert s.flight.session is not None
    assert second.last_check_result == 'NOT_CHECKED'
    assert second.next_check_at <= START + timedelta(minutes=2)


def test_ownership_loss_after_provider_request_discards_collected_facts(
    setup, monitor_engine
):
    s = setup
    owner = MonitorOwnership(monitor_engine)
    assert owner.acquire()
    provider = Mock()

    def track(request):
        owner.connection.invalidate()
        return [movement(s, departure_confirmed=True, actual_departure=START)]

    provider.track.side_effect = track
    try:
        with pytest.raises(OwnershipLost), owner.session() as db:
            FlightTrackingService(db).poll_due(
                provider, START, verify_ownership=partial(owner.probe, db)
            )
    finally:
        owner.close()
    s.db.expire_all()
    assert s.flight.last_check_result == 'NOT_CHECKED'
    assert s.flight.session is None


def test_stale_configuration_keeps_valid_facts_and_other_failure_backoff(
    setup, engine, monitor_engine
):
    s = setup
    other = s.add('KL456', START + timedelta(minutes=1))
    third = s.add('KL789', START + timedelta(minutes=2))
    configure(s.db, 'flights.provider', 'flightaware')
    provider = Mock()

    def track(request):
        if request.flight_number == 'KL123':
            return [movement(s, status='BOARDING')]
        if request.flight_number == 'KL456':
            raise FlightUnavailable(result='UNAVAILABLE')
        with Session(engine) as db:
            configure(db, 'flights.check_interval_minutes', 30)
        raise FlightUnavailable(result='CONFIGURATION_ERROR')

    provider.track.side_effect = track
    poll_owned(monitor_engine, provider, START + timedelta(minutes=3))
    s.db.expire_all()
    assert s.flight.last_check_result == 'OK'
    # Collected ordinary failures survive discarding account-wide configuration errors.
    assert other.last_check_result == 'UNAVAILABLE'
    assert other.next_check_at > START + timedelta(minutes=3)
    assert third.last_check_result == 'NOT_CHECKED'


@pytest.mark.parametrize('selected', ['flightaware'])
def test_runtime_reloads_fixed_credentials_after_stale_request_with_unreadable_inactive_key(
    setup,
    engine,
    monitor_engine,
    monkeypatch,
    selected,
    caplog,
):
    s = setup
    selected_key, inactive_key, adapter = (
        'flights.flightaware_api_key', 'flights.rapidapi_api_key',
        'services.flight_providers.flightaware_flight_provider.FlightAwareFlightProvider',
    )
    configure(s.db, 'flights.provider', selected)
    configure(s.db, selected_key, 'old-key')
    s.db.add(AppSetting(key=inactive_key, secret_value='v1:unreadable-inactive'))
    s.db.commit()
    facts = movement(s, status='BOARDING')
    initial_due = s.flight.next_check_at
    entered, release = threading.Event(), threading.Event()
    credentials = []
    monkeypatch.setattr('services.gps.flight_tracking_service.utcnow', lambda: START)

    def track(self, request):
        credentials.append(self._api_key)
        if self._api_key == 'old-key':
            entered.set()
            assert release.wait(10)
            raise FlightUnavailable(
                'private provider payload with old-key', result='CONFIGURATION_ERROR'
            )
        return [facts]

    monkeypatch.setattr(f'{adapter}.track', track)
    flight_type, flight_id = type(s.flight), s.flight.id

    def cycles():
        owner = MonitorOwnership(monitor_engine)
        runtime = FlightMonitorRuntime()
        try:
            assert owner.acquire()
            assert runtime._cycle(owner) == (1, selected)
            with Session(engine) as observer:
                flight = observer.get(flight_type, flight_id)
                assert flight.last_check_result == 'NOT_CHECKED'
                assert flight.next_check_at == initial_due
            assert runtime._cycle(owner) == (1, selected)
        finally:
            owner.close()

    # Only immutable IDs/facts are used by the background fake provider.
    with ThreadPoolExecutor(max_workers=1) as executor:
        work = executor.submit(cycles)
        try:
            assert entered.wait(10)
            with Session(engine) as other:
                configure(other, selected_key, 'fixed-key')
        finally:
            release.set()
        work.result(10)
    s.db.expire_all()
    assert s.flight.last_check_result == 'OK'
    assert credentials == ['old-key', 'fixed-key']
    assert 'private provider payload' not in caplog.text
    assert 'old-key' not in caplog.text
    assert 'unreadable-inactive' not in caplog.text


def test_settings_guard_timeout_leaves_due_flights_unsuspended(
    setup, engine, monitor_engine
):
    s = setup
    provider = Mock()
    provider.track.side_effect = FlightUnavailable(result='CONFIGURATION_ERROR')
    owner = MonitorOwnership(monitor_engine)
    assert owner.acquire()
    before = s.flight.next_check_at
    try:
        with Session(engine) as admin:
            lock_flight_settings(admin)
            with pytest.raises(DBAPIError), owner.session() as db:
                snapshot = FlightSettingsSnapshot.load(db)

                def guard():
                    db.execute(text("SET LOCAL lock_timeout='100ms'"))
                    return configuration_is_current(db, snapshot)

                FlightTrackingService(db).poll_due(
                    provider,
                    START,
                    configuration_is_current=guard,
                    verify_ownership=partial(owner.probe, db),
                )
            admin.rollback()
        assert not owner.connection.in_transaction()
    finally:
        owner.close()
    s.db.expire_all()
    assert s.flight.next_check_at == before
    assert s.flight.last_check_result == 'NOT_CHECKED'


def test_cancellation_during_reconciliation_stops_before_next_trip(
    setup, monitor_engine, monkeypatch
):
    s = setup
    other_trip = create_trip(s.db, owner_id=s.owner.id)
    s.db.add(
        TrackedFlight(
            trip_id=other_trip.id,
            itinerary_connection_id=uuid.uuid4(),
            flight_number='KL999',
            scheduled_departure=START,
            departure_airport_place_id=s.departure.id,
            next_check_at=START,
        )
    )
    s.db.commit()
    cancelled = threading.Event()
    original = FlightTrackingService.sync_itinerary
    reconciled = []

    def reconcile(self, trip_id):
        reconciled.append(trip_id)
        original(self, trip_id)
        cancelled.set()

    monkeypatch.setattr(FlightTrackingService, 'sync_itinerary', reconcile)
    provider = Mock()
    assert poll_owned(monitor_engine, provider, START, cancelled=cancelled.is_set) == 0
    assert reconciled == [min(s.trip.id, other_trip.id)]
    provider.track.assert_not_called()


def test_service_commits_are_visible_and_release_trip_locks_with_probes(
    setup, engine, monitor_engine
):
    s = setup
    owner = MonitorOwnership(monitor_engine)
    assert owner.acquire()
    provider = Mock()
    provider.track.return_value = [movement(s, status='BOARDING')]
    trip_id, flight_id = s.trip.id, s.flight.id
    observed = []
    try:
        owner.probe()  # include a later cycle-entry probe, too
        with owner.session() as db:

            def committed(session):
                with Session(engine) as observer:
                    assert (
                        observer.scalar(
                            select(Trip.id)
                            .where(Trip.id == trip_id)
                            .with_for_update(nowait=True)
                        )
                        == trip_id
                    )
                    observed.append(
                        observer.get(TrackedFlight, flight_id).last_check_result
                    )
                    assert not observer.scalar(
                        text('SELECT pg_try_advisory_lock(:a,:b)'),
                        dict(zip(('a', 'b'), FLIGHT_MONITOR_LOCK_KEY)),
                    )

            event.listen(db, 'after_commit', committed)
            FlightTrackingService(db).poll_due(
                provider, START, verify_ownership=partial(owner.probe, db)
            )
        assert observed[:2] == ['NOT_CHECKED', 'NOT_CHECKED']
        assert observed[2:] and all(state == 'OK' for state in observed[2:])
        assert not owner.connection.in_transaction()
    finally:
        owner.close()


def test_shutdown_during_atomic_result_application_finishes_before_unlock(
    setup,
    engine,
    monitor_engine,
    monkeypatch,
):
    s = setup
    configure(s.db, 'flights.provider', 'flightaware')
    configure(s.db, 'flights.flightaware_api_key', 'configured-key')
    facts = movement(s, departure_confirmed=True, actual_departure=START)
    applied, release, stopped = threading.Event(), threading.Event(), threading.Event()
    original = FlightTrackingService.apply_updates

    def apply(self, *args):
        original(self, *args)
        applied.set()
        assert release.wait(10)

    monkeypatch.setattr(FlightTrackingService, 'apply_updates', apply)
    monkeypatch.setattr('services.gps.flight_tracking_service.utcnow', lambda: START)
    monkeypatch.setattr(
        'services.flight_providers.flightaware_flight_provider.FlightAwareFlightProvider.track',
        lambda *args: [facts],
    )
    runtime = FlightMonitorRuntime(engine_factory=lambda: monitor_engine)
    runtime.start()
    stopper = threading.Thread(target=lambda: (runtime.stop(), stopped.set()))
    try:
        assert applied.wait(10)
        stopper.start()
        assert runtime._stop.wait(5)
        assert not stopped.is_set()
        with engine.connect() as observer:
            assert not observer.scalar(
                text('SELECT pg_try_advisory_lock(:a,:b)'),
                dict(zip(('a', 'b'), FLIGHT_MONITOR_LOCK_KEY)),
            )
    finally:
        release.set()
        runtime.stop()
        if stopper.ident is not None:
            stopper.join(10)
    assert stopped.is_set()
    s.db.expire_all()
    assert s.flight.last_check_result == 'OK'
    assert s.flight.session is not None
