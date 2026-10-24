import asyncio
import logging
import threading
from contextlib import contextmanager
from unittest.mock import Mock

import pytest

from flight_monitor.runtime import FlightMonitorRuntime


class Heartbeats:
    def __init__(self, count):
        self.remaining = count
        self.delays = []

    def is_set(self):
        return self.remaining == 0

    def wait(self, delay):
        self.delays.append(delay)
        self.remaining -= 1


def test_immediate_serial_cycles_wait_after_failure_and_sanitize_logs(caplog):
    event = Heartbeats(3)
    engine = Mock()
    owners = []

    def owner_factory(engine):
        owner = Mock(connection=None)
        owner.acquire.return_value = True
        owners.append(owner)
        return owner

    runtime = FlightMonitorRuntime(
        stop_event=event,
        engine_factory=lambda: engine,
        ownership_factory=owner_factory,
    )
    cycles = []

    def cycle(owner):
        cycles.append(len(event.delays))
        if len(cycles) == 1:
            raise ValueError('secret credential / coordinates / raw payload')
        return 1, 'fake'

    runtime._cycle = cycle
    with caplog.at_level(logging.DEBUG):
        runtime._run()
    assert cycles == [0, 1, 2]
    assert event.delays == [60, 60, 60]
    assert len(owners) == 2
    for owner in owners:
        owner.close.assert_called_once()
    engine.dispose.assert_called_once()
    assert 'secret credential' not in caplog.text
    assert any(
        r.outcome == 'ValueError' for r in caplog.records if hasattr(r, 'outcome')
    )


def test_standby_never_opens_work_session():
    owner = Mock(connection=None)
    owner.acquire.return_value = False
    runtime = FlightMonitorRuntime(
        stop_event=Heartbeats(2),
        engine_factory=Mock(),
        ownership_factory=lambda engine: owner,
    )
    runtime._cycle = Mock()
    runtime._run()
    runtime._cycle.assert_not_called()
    assert owner.acquire.call_count == 2


def test_start_is_nonblocking_duplicate_safe_and_stop_waits_for_current_io():
    entered, release, stopped = threading.Event(), threading.Event(), threading.Event()
    owner = Mock(connection=None)
    owner.acquire.return_value = True
    runtime = FlightMonitorRuntime(
        engine_factory=Mock(), ownership_factory=lambda _: owner
    )

    def cycle(_):
        entered.set()
        assert release.wait(5)
        return 1, 'fake'

    runtime._cycle = cycle
    runtime.stop()  # unstarted is harmless
    runtime.start()
    try:
        assert entered.wait(5)
        worker = runtime._thread
        runtime.start()
        assert runtime._thread is worker
        stopper = threading.Thread(target=lambda: (runtime.stop(), stopped.set()))
        stopper.start()
        assert runtime._stop.wait(5)
        assert not stopped.is_set()
        assert not owner.close.called
    finally:
        release.set()
        runtime.stop()
    stopper.join(5)
    assert stopped.is_set()
    owner.close.assert_called_once()


def test_stop_interrupts_heartbeat():
    completed = threading.Event()
    owner = Mock(connection=None)
    runtime = FlightMonitorRuntime(
        engine_factory=Mock(), ownership_factory=lambda _: owner
    )
    runtime._cycle = lambda _: (completed.set() or 0, 'none')
    runtime.start()
    assert completed.wait(5)
    runtime.stop()
    assert not runtime._thread.is_alive()


@pytest.mark.parametrize(
    'failure', ['monitor_start', 'job_start', 'job_stop', 'monitor_stop', None]
)
def test_lifespan_cleans_resources_and_joins_outside_event_loop(monkeypatch, failure):
    import main

    loop_thread = threading.get_ident()
    events = []

    class Monitor:
        def start(self):
            events.append('monitor_start')
            if failure == 'monitor_start':
                raise RuntimeError()

        def request_stop(self):
            events.append('signal')

        def stop(self):
            assert threading.get_ident() != loop_thread
            events.append('monitor_stop')
            if failure == 'monitor_stop':
                raise RuntimeError()

    class Jobs:
        def start(self):
            assert threading.get_ident() != loop_thread
            events.append('job_start')
            if failure == 'job_start':
                raise RuntimeError()

        def stop(self):
            assert threading.get_ident() != loop_thread
            events.append('job_stop')
            if failure == 'job_stop':
                raise RuntimeError()

    @contextmanager
    def session(_):
        yield Mock()

    monkeypatch.setattr(main, 'Session', session)
    monkeypatch.setattr(main, 'get_engine', Mock())
    monkeypatch.setattr(main, 'MediaCleanupService', Mock())
    monkeypatch.setattr(main, 'JobRuntime', Jobs)
    monkeypatch.setattr(main, 'FlightMonitorRuntime', Monitor)

    async def run():
        async with main.lifespan(main.app):
            events.append('yield')

    if failure:
        with pytest.raises(RuntimeError):
            asyncio.run(run())
    else:
        asyncio.run(run())
    assert events[-3:] == ['signal', 'job_stop', 'monitor_stop']
