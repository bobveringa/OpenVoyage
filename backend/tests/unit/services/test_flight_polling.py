from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest

from core.app_settings import FLIGHTS_UPDATE_FREQUENCY_KEY, app_settings_registry
from services.gps.flight_polling import FLIGHT_POLLING_POLICIES

START = datetime(2026, 10, 23, 10, tzinfo=timezone.utc)


def flight(**changes):
    return SimpleNamespace(
        **dict(
            status='SCHEDULED',
            session=None,
            scheduled_departure=START,
            estimated_departure=None,
            scheduled_arrival=START + timedelta(hours=8),
            estimated_arrival=None,
        )
        | changes
    )


PRESETS = [
    ('minimal', 30, 30, 30),
    ('relaxed', 45, 15, 15),
    ('balanced', 60, 10, 10),
    ('frequent', 90, 5, 5),
    ('very_frequent', 120, 5, 5),
]


def test_registered_choices_match_implemented_policies():
    definition = app_settings_registry.require(FLIGHTS_UPDATE_FREQUENCY_KEY)
    assert set(definition.validation['allowed_values']) == set(FLIGHT_POLLING_POLICIES)
    assert definition.default_value == 'balanced'


@pytest.mark.parametrize('name,lead,departure,arrival', PRESETS)
def test_each_preset_follows_departure_cruise_and_arrival_phases(
    name, lead, departure, arrival
):
    policy = FLIGHT_POLLING_POLICIES[name]
    assert policy.next_check(flight(), START - timedelta(hours=3)) == START - timedelta(
        minutes=lead
    )
    imminent = START - timedelta(minutes=5)
    assert policy.next_check(flight(), imminent) == imminent + timedelta(
        minutes=departure
    )
    cruising = START + timedelta(hours=2)
    airborne = flight(session=object(), status='IN_FLIGHT')
    assert policy.next_check(airborne, cruising) == cruising + timedelta(minutes=30)
    landing = START + timedelta(hours=8, minutes=-10)
    assert policy.next_check(airborne, landing) == landing + timedelta(minutes=arrival)


@pytest.mark.parametrize('name,lead,departure,arrival', PRESETS)
def test_delayed_ground_flight_keeps_rechecking_past_original_departure(
    name, lead, departure, arrival
):
    policy = FLIGHT_POLLING_POLICIES[name]
    delayed = flight(status='DELAYED', estimated_departure=START + timedelta(hours=3))
    now = START
    for _ in range(3):
        expected = now + timedelta(minutes=departure)
        assert policy.next_check(delayed, now) == expected
        now = expected


def test_estimated_earlier_departure_brings_first_check_forward():
    early = flight(estimated_departure=START - timedelta(hours=1))
    assert FLIGHT_POLLING_POLICIES['balanced'].next_check(
        early, START - timedelta(hours=4)
    ) == START - timedelta(hours=2)


def test_slow_ground_checks_do_not_skip_the_imminent_departure_window():
    assert FLIGHT_POLLING_POLICIES['balanced'].next_check(
        flight(), START - timedelta(minutes=20)
    ) == START - timedelta(minutes=15)


def test_cruise_checks_do_not_skip_the_arrival_window():
    airborne = flight(session=object(), status='IN_FLIGHT')
    assert FLIGHT_POLLING_POLICIES['frequent'].next_check(
        airborne, START + timedelta(hours=7)
    ) == START + timedelta(hours=7, minutes=15)


def test_revised_arrival_controls_the_arrival_window():
    airborne = flight(
        session=object(),
        status='IN_FLIGHT',
        estimated_arrival=START + timedelta(hours=9),
    )
    now = START + timedelta(hours=7, minutes=50)
    assert FLIGHT_POLLING_POLICIES['balanced'].next_check(
        airborne, now
    ) == now + timedelta(minutes=30)


def test_cancelled_and_expired_flights_stop_polling():
    policy = FLIGHT_POLLING_POLICIES['very_frequent']
    assert policy.next_check(flight(status='CANCELLED'), START) is None
    assert policy.next_check(flight(), START + timedelta(hours=14)) is None
