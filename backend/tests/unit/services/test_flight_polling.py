from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest

from core.app_settings import app_settings_registry
from services.gps.flight_polling import FlightPollingPolicy

START = datetime(2026, 10, 23, 10, tzinfo=timezone.utc)


def flight(**changes):
    return SimpleNamespace(**(dict(status='SCHEDULED', session=None,
        scheduled_departure=START, estimated_departure=None,
        scheduled_arrival=START + timedelta(hours=8), estimated_arrival=None) | changes))


def test_setting_defaults_and_removed_presets():
    assert app_settings_registry.require('flights.check_interval_minutes').default_value == 30
    assert app_settings_registry.require('flights.check_more_often_before_departure').default_value is True
    assert app_settings_registry.get('flights.update_frequency') is None


@pytest.mark.parametrize('minutes', [5, 10, 15, 30, 60])
@pytest.mark.parametrize('ground', [False, True])
def test_cadence_for_all_intervals_and_ground_settings(minutes, ground):
    policy = FlightPollingPolicy(minutes, ground)
    assert policy.next_check(flight(), START - timedelta(hours=3)) == START - timedelta(hours=1)
    assert policy.next_check(flight(), START) == START + timedelta(minutes=min(10, minutes) if ground else minutes)
    airborne = flight(session=object(), status='IN_FLIGHT')
    for now in (START, START + timedelta(hours=7, minutes=55)):
        assert policy.next_check(airborne, now) == now + timedelta(minutes=minutes)


def test_earlier_estimate_advances_window_and_delay_cannot_postpone_it():
    policy = FlightPollingPolicy()
    assert policy.next_check(flight(estimated_departure=START - timedelta(hours=1)), START - timedelta(hours=4)) == START - timedelta(hours=2)
    assert policy.next_check(flight(estimated_departure=START + timedelta(hours=3)), START - timedelta(hours=4)) == START - timedelta(hours=1)


def test_cancelled_and_unresolved_cutoff():
    policy = FlightPollingPolicy()
    assert policy.next_check(flight(status='CANCELLED'), START) is None
    assert policy.next_check(flight(), START + timedelta(hours=14)) is None
