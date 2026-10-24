from datetime import datetime, timezone

import pytest

from models.api.planning import FlightLookupRequest
from services.flight_providers.aerodatabox_flight_provider import parse_movements
from services.gps.flight_geometry import arc, arc_point

NOW = datetime(2026, 10, 23, 11, tzinfo=timezone.utc)
INTENT = FlightLookupRequest(flight_number='KL123', departure_date=NOW.date())


def payload(status, departure='2026-10-23T10:00:00Z', arrival='2026-10-23T12:00:00Z'):
    airport = {
        'name': 'Airport',
        'iata': 'AMS',
        'timeZone': 'Europe/Amsterdam',
        'location': {'lat': 52, 'lon': 5},
    }
    return [
        {
            'number': 'KL123',
            'status': status,
            'departure': {
                'airport': airport,
                'scheduledTime': {'utc': '2026-10-23T10:00:00Z'},
                'runwayTime': {'utc': departure},
            },
            'arrival': {
                'airport': airport,
                'scheduledTime': {'utc': '2026-10-23T12:00:00Z'},
                'runwayTime': {'utc': arrival},
            },
        }
    ]


@pytest.mark.parametrize(
    'status',
    [
        'Expected',
        'CheckIn',
        'Boarding',
        'GateClosed',
        'Delayed',
        'Unknown',
        'CanceledUncertain',
        'Diverted',
    ],
)
def test_predicted_and_passed_timestamps_do_not_confirm_movement(status):
    facts = parse_movements(payload(status), INTENT, NOW)[0]
    assert not facts.departure_confirmed and not facts.arrival_confirmed
    assert facts.actual_departure is None and facts.actual_arrival is None
    assert facts.estimated_departure is not None


@pytest.mark.parametrize('status', ['Departed', 'EnRoute', 'Approaching', 'Arrived'])
def test_confirmed_movement_can_have_no_actual_time(status):
    facts = parse_movements(payload(status, departure=None, arrival=None), INTENT, NOW)[
        0
    ]
    assert facts.departure_confirmed
    assert facts.arrival_confirmed == (status == 'Arrived')
    assert facts.actual_departure is None and facts.actual_arrival is None


def test_future_movement_time_stays_estimated_even_with_confirmation():
    facts = parse_movements(payload('Arrived'), INTENT, NOW)[0]
    assert facts.actual_departure is not None
    assert facts.actual_arrival is None
    assert facts.estimated_arrival is not None


def test_unusable_runway_time_falls_back_to_revised_movement_time():
    raw = payload('Arrived', departure='2026-10-23T12:00:00Z')
    raw[0]['departure']['revisedTime'] = {'utc': '2026-10-23T10:15:00Z'}
    facts = parse_movements(raw, INTENT, NOW)[0]
    assert facts.actual_departure.hour == 10
    assert facts.actual_departure.minute == 15


def test_diversion_without_arrival_airport_is_still_a_usable_update():
    raw = payload('Diverted')
    raw[0]['arrival'] = {}
    facts = parse_movements(raw, INTENT, NOW)[0]
    assert facts.diverted
    assert facts.landing_airport is None
    assert not facts.arrival_confirmed


def test_predicted_time_never_becomes_actual():
    raw = payload('Arrived', departure=None, arrival=None)
    raw[0]['departure']['predictedTime'] = {'utc': '2026-10-23T10:15:00Z'}
    facts = parse_movements(raw, INTENT, NOW)[0]
    assert facts.actual_departure is None
    assert facts.estimated_departure.minute == 15


def test_dateline_and_antipodal_geometry_is_finite_and_keeps_endpoints():
    points = arc((179, 20), (-179, 20))
    assert points[0] == pytest.approx((179, 20))
    assert points[-1] == pytest.approx((-179, 20))
    assert abs(arc_point((179, 20), (-179, 20), 0.5)[0]) == pytest.approx(180)
    assert len(arc((0, 0), (180, 0))) == 65


@pytest.mark.parametrize(
    'field,value', [('departure', []), ('arrival', 'unavailable'), ('status', {})]
)
def test_malformed_provider_fields_do_not_crash_tracking(field, value):
    raw = payload('Expected')
    raw[0][field] = value
    parse_movements(raw, INTENT, NOW)


@pytest.mark.parametrize(
    'headers,expected',
    [
        ({'Retry-After': '120'}, 120),
        ({'Retry-After': 'Fri, 23 Oct 2026 11:30:00 GMT'}, 1800),
        ({'X-RateLimit-Reset': '3600'}, 3600),
        ({'X-RateLimit-Requests-Reset': str(int(NOW.timestamp()) + 7200)}, 7200),
        ({'Retry-After': '120', 'X-RateLimit-Reset': '3600'}, 3600),
        ({'Retry-After': 'invalid', 'X-RateLimit-Reset': 'nan'}, None),
    ],
)
def test_reported_provider_retry_and_reset_times_are_honored(headers, expected):
    from services.flight_providers.aerodatabox_flight_provider import (
        retry_after_seconds,
    )

    assert retry_after_seconds(headers, NOW) == expected
