"""Synchronous, cooperative flight monitor with an interruptible idle heartbeat."""

import logging
import threading
import time
import uuid
from functools import partial

from core.app_settings import FLIGHTS_PROVIDER_KEY, FLIGHTS_UPDATE_FREQUENCY_KEY
from services.flight_airports import lookup_airport_endpoint
from services.flight_providers.factory import FlightProviderFactory
from services.flight_settings import FlightSettingsSnapshot, configuration_is_current
from services.gps.flight_tracking_service import FlightTrackingService

from .ownership import MonitorOwnership, create_monitor_engine

logger = logging.getLogger(__name__)
HEARTBEAT_SECONDS = 60


class FlightMonitorRuntime:
    def __init__(
        self,
        *,
        engine_factory=create_monitor_engine,
        ownership_factory=MonitorOwnership,
        heartbeat=HEARTBEAT_SECONDS,
        stop_event=None,
        clock=time.monotonic,
    ):
        self._engine_factory = engine_factory
        self._ownership_factory = ownership_factory
        self._heartbeat = heartbeat
        self._stop = stop_event if stop_event is not None else threading.Event()
        self._clock = clock
        self._thread = None
        self._lifecycle_lock = threading.Lock()
        self.instance_id = uuid.uuid4().hex
        self._enabled = None
        self._cycle_provider = 'unconfigured'
        self._cycle_attempted = 0

    def start(self):
        with self._lifecycle_lock:
            if self._thread is not None and self._thread.is_alive():
                return
            self._stop.clear()
            self._thread = threading.Thread(
                target=self._run,
                name='flight-monitor',
                daemon=True,
            )
            self._thread.start()

    def request_stop(self):
        self._stop.set()

    def stop(self):
        self.request_stop()
        with self._lifecycle_lock:
            if self._thread is not None and self._thread.ident is not None:
                self._thread.join()

    def _log(self, level, event, **fields):
        logger.log(level, event, extra={'instance_id': self.instance_id, **fields})

    def _cycle(self, ownership):
        with ownership.session() as db:
            snapshot = FlightSettingsSnapshot.load(db)
            reader = snapshot.reader(db)
            selected = reader.get_value(FLIGHTS_PROVIDER_KEY)
            self._cycle_provider = selected
            enabled = selected != 'none'
            if enabled != self._enabled:
                self._enabled = enabled
                self._log(
                    logging.INFO,
                    'flight_monitor.enabled' if enabled else 'flight_monitor.disabled',
                    provider=selected,
                )
            if not enabled or self._stop.is_set():
                return 0, 'none'
            provider = FlightProviderFactory(
                airport_resolver=partial(lookup_airport_endpoint, db)
            ).create_flight_provider(reader)
            service = FlightTrackingService(
                db,
                update_frequency=reader.get_value(FLIGHTS_UPDATE_FREQUENCY_KEY),
            )
            try:
                calls = service.poll_due(
                    provider,
                    cancelled=self._stop.is_set,
                    verify_ownership=partial(ownership.probe, db),
                    configuration_is_current=partial(
                        configuration_is_current, db, snapshot
                    ),
                    log_context={'instance_id': self.instance_id},
                )
            finally:
                self._cycle_attempted = service.attempted_requests
            return calls, selected

    def _run(self):
        engine = ownership = None
        self._log(logging.INFO, 'flight_monitor.started')
        try:
            while not self._stop.is_set():
                started = self._clock()
                self._cycle_provider, self._cycle_attempted = 'unconfigured', 0
                try:
                    if engine is None:
                        engine = self._engine_factory()
                    if ownership is None:
                        ownership = self._ownership_factory(engine)
                    was_owned = ownership.connection is not None
                    if ownership.acquire():
                        if not was_owned:
                            self._log(logging.INFO, 'flight_monitor.ownership_acquired')
                        calls, provider = self._cycle(ownership)
                        self._log(
                            logging.DEBUG,
                            'flight_monitor.cycle_completed',
                            duration_seconds=self._clock() - started,
                            provider=provider,
                            attempted_requests=calls,
                            outcome='completed' if self._enabled else 'disabled',
                        )
                except Exception as exc:
                    # Exception text/tracebacks can contain SQL parameters or
                    # provider payloads. Only emit the exception category.
                    self._log(
                        logging.ERROR,
                        'flight_monitor.cycle_failed',
                        duration_seconds=self._clock() - started,
                        provider=self._cycle_provider,
                        attempted_requests=self._cycle_attempted,
                        outcome=type(exc).__name__,
                    )
                    if ownership is not None:
                        self._log(logging.WARNING, 'flight_monitor.ownership_lost')
                        self._close(ownership)
                        ownership = None
                self._stop.wait(self._heartbeat)
        finally:
            if ownership is not None:
                self._close(ownership)
            if engine is not None:
                try:
                    engine.dispose()
                except Exception as exc:
                    self._log(
                        logging.WARNING,
                        'flight_monitor.close_failed',
                        outcome=type(exc).__name__,
                    )
            self._log(logging.INFO, 'flight_monitor.stopped')

    def _close(self, ownership):
        try:
            ownership.close()
        except Exception as exc:
            self._log(
                logging.WARNING,
                'flight_monitor.close_failed',
                outcome=type(exc).__name__,
            )
