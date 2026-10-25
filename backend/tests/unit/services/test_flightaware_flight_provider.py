import copy
import json
from datetime import datetime, timedelta, timezone
from io import BytesIO
from unittest.mock import MagicMock, Mock
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qs, urlsplit

import pytest

from models.api.planning import Endpoint, FlightLookupRequest
from services.flight_providers import FlightAwareFlightProvider, FlightUnavailable

MODULE = 'services.flight_providers.flightaware_flight_provider.urlopen'
DAY = datetime.now(timezone.utc).date() - timedelta(days=1)
INTENT = FlightLookupRequest(flight_number='6e 7384', departure_date=DAY)


@pytest.fixture(autouse=True)
def isolated_airport_cache(monkeypatch):
    monkeypatch.setattr('services.flight_providers.flightaware_flight_provider._AIRPORT_CACHE', {})

AIRPORTS = {
    'VIDP': dict(
        code_icao='VIDP',
        code_iata='DEL',
        name='Delhi',
        latitude=28.56,
        longitude=77.10,
        timezone='Asia/Kolkata',
    ),
    'VABB': dict(
        code_icao='VABB',
        code_iata='BOM',
        name='Mumbai',
        latitude=19.09,
        longitude=72.87,
        timezone='Asia/Kolkata',
    ),
}


def flight(**changes):
    return (
        dict(
            ident='IGO7384',
            ident_icao='IGO7384',
            ident_iata='6E7384',
            origin=dict(
                code='VIDP',
                **{
                    k: v
                    for k, v in AIRPORTS['VIDP'].items()
                    if k not in ('latitude', 'longitude')
                },
            ),
            destination=dict(
                code='VABB',
                **{
                    k: v
                    for k, v in AIRPORTS['VABB'].items()
                    if k not in ('latitude', 'longitude')
                },
            ),
            scheduled_out=f'{DAY}T16:45:00Z',
            scheduled_in=f'{DAY}T19:40:00Z',
        )
        | changes
    )


def install(monkeypatch, rows=None, *, scheduled=False):
    def respond(request, **kwargs):
        path = urlsplit(request.full_url).path
        payload = (
            AIRPORTS[path.rsplit('/', 1)[1]]
            if '/airports/' in path
            else {
                ('scheduled' if scheduled else 'flights'): [flight()]
                if rows is None
                else rows
            }
        )
        response = MagicMock()
        response.__enter__.return_value = response
        response.status = 200
        response.read.return_value = json.dumps(payload).encode()
        return response

    network = Mock(side_effect=respond)
    monkeypatch.setattr(MODULE, network)
    return network


def provider(key='private-key'):
    return FlightAwareFlightProvider(api_key=key)


def test_observed_track_options_validation_sorting_and_corrections(monkeypatch):
    at = datetime.now(timezone.utc) - timedelta(hours=2)
    point = dict(timestamp=at.isoformat(), latitude=52, longitude=5)
    payload = {'positions': [
        dict(point, timestamp=(at + timedelta(minutes=1)).isoformat()),
        point, dict(point, latitude=53), dict(point, latitude=999),
        dict(point, longitude=True), dict(point, timestamp='bad'),
        dict(point, timestamp=(at + timedelta(days=1)).isoformat()), None,
    ]}
    response = MagicMock()
    response.__enter__.return_value = response
    response.status = 200
    response.read.return_value = json.dumps(payload).encode()
    network = Mock(return_value=response)
    monkeypatch.setattr(MODULE, network)
    points = provider().positions('id/with space')
    assert len(points) == 2
    assert points[0].at == at
    assert points[0].latitude == 53
    assert points[1].at > points[0].at
    request = network.call_args.args[0]
    assert request.data is None
    assert request.get_method() == 'GET'
    assert '/flights/id%2Fwith%20space/track?' in request.full_url
    assert parse_qs(urlsplit(request.full_url).query) == {
        'include_estimated_positions': ['false'], 'include_surface_positions': ['false'],
    }


def test_lookup_maps_iata_alias_airports_and_gate_times(monkeypatch):
    network = install(monkeypatch)
    (result,) = provider().lookup(INTENT, timeout=3)
    assert result.flight_number == '6E7384'
    assert result.provider == 'flightaware'
    assert result.departure_airport.iata_code == 'DEL'
    assert result.arrival_airport.latitude == 19.09
    assert result.duration_seconds == 10500
    request = network.call_args_list[0].args[0]
    assert '/flights/6E7384?' in request.full_url
    assert request.get_header('X-apikey') == 'private-key'
    assert 'private-key' not in request.full_url
    params = parse_qs(urlsplit(request.full_url).query)
    assert params['ident_type'] == ['designator']
    assert params['max_pages'] == ['1']
    assert all(0 < call.kwargs['timeout'] <= 3 for call in network.call_args_list)


def test_uses_local_departure_day_and_skips_other_flights_before_airport_requests(
    monkeypatch,
):
    rows = [
        flight(ident='ANZ6827', ident_icao='ANZ6827', ident_iata='NZ6827'),
        flight(scheduled_out=f'{DAY}T23:30:00Z'),
    ]
    network = install(monkeypatch, rows)
    assert provider().lookup(INTENT) == []
    assert network.call_count == 1


def test_utc_previous_day_can_match_local_departure_day(monkeypatch):
    install(monkeypatch, [flight(scheduled_out=f'{DAY - timedelta(days=1)}T23:30:00Z')])
    assert len(provider().lookup(INTENT)) == 1


def test_codeshares_duplicate_candidates_and_airport_request_reuse(monkeypatch):
    raw = flight(ident_iata='XX123', codeshares_iata=['6E7384'])
    network = install(monkeypatch, [raw, copy.deepcopy(raw)])
    assert len(provider().lookup(INTENT)) == 1
    assert network.call_count == 3


def test_airport_cache_reuses_metadata_but_refreshes_flight_facts(monkeypatch):
    network = install(monkeypatch)
    adapter = provider()
    assert adapter.lookup(INTENT)
    assert adapter.track(INTENT)
    assert network.call_count == 4
    assert '/flights/6E7384?' in network.call_args_list[-1].args[0].full_url


def test_airport_cache_survives_new_job_adapters_but_expires(monkeypatch):
    clock = [0]
    monkeypatch.setattr('services.flight_providers.flightaware_flight_provider.monotonic', lambda: clock[0])
    network = install(monkeypatch)
    assert provider().lookup(INTENT)
    assert provider().lookup(INTENT)
    assert network.call_count == 4
    clock[0] = 6 * 3600 + 1
    assert provider().lookup(INTENT)
    assert network.call_count == 7


def test_airport_cache_is_separate_for_custom_endpoints(monkeypatch):
    network = install(monkeypatch)
    assert provider().lookup(INTENT)
    assert FlightAwareFlightProvider(api_key='other', base_url='https://proxy.example.test/aeroapi').lookup(INTENT)
    assert network.call_count == 6


@pytest.mark.parametrize('tracking', [False, True])
def test_local_airports_avoid_remote_metadata_requests(monkeypatch, tracking):
    network = install(monkeypatch, [flight(actual_on=f'{DAY}T19:40:00Z')])
    local = {
        code: Endpoint(
            latitude=details['latitude'], longitude=details['longitude'],
            name='Local ' + details['name'], iata_code=details['code_iata'],
            icao_code=details['code_icao'], timezone=details['timezone'],
        )
        for code, details in AIRPORTS.items()
    }
    resolver = Mock(side_effect=local.get)
    adapter = FlightAwareFlightProvider(api_key='private-key', airport_resolver=resolver)
    results = adapter.track(INTENT) if tracking else adapter.lookup(INTENT)
    assert len(results) == 1
    assert results[0].departure_airport.name == 'Local Delhi'
    destination = results[0].landing_airport if tracking else results[0].arrival_airport
    assert destination.name == 'Local Mumbai'
    assert network.call_count == 1
    assert [call.args[0] for call in resolver.call_args_list] == ['VIDP', 'VABB']


def test_missing_local_airport_uses_cached_remote_fallback(monkeypatch):
    network = install(monkeypatch, [flight(), flight()])
    local = Endpoint(latitude=28.56, longitude=77.10, icao_code='VIDP',
                     iata_code='DEL', timezone='Asia/Kolkata')
    resolver = Mock(side_effect=lambda code: local if code == 'VIDP' else None)
    adapter = FlightAwareFlightProvider(api_key='private-key', airport_resolver=resolver)
    assert len(adapter.lookup(INTENT)) == 1
    assert len(adapter.lookup(INTENT)) == 1
    assert network.call_count == 3  # Two flight calls, one remote destination.
    assert resolver.call_count == 4  # Reuse each local lookup within its operation.


def test_local_airports_take_precedence_over_cached_remote_metadata(monkeypatch):
    network = install(monkeypatch)
    assert provider().lookup(INTENT)
    local = Endpoint(latitude=1, longitude=2, timezone='UTC')
    adapter = FlightAwareFlightProvider(api_key='private-key', airport_resolver=lambda _: local)
    assert adapter.lookup(INTENT)[0].departure_airport.latitude == 1
    assert network.call_count == 4


def test_provider_codes_supplement_local_airports_for_tracking_identity(monkeypatch):
    network = install(monkeypatch)
    local = Endpoint(latitude=28.56, longitude=77.10, icao_code='VIDP',
                     timezone='Asia/Kolkata')
    adapter = FlightAwareFlightProvider(
        api_key='private-key', airport_resolver=lambda _: local,
    )
    assert adapter.track(INTENT)[0].departure_airport.iata_code == 'DEL'
    assert local.iata_code is None
    assert network.call_count == 1


@pytest.mark.parametrize(
    'changes',
    [
        {'origin': None},
        {'scheduled_out': 'bad'},
        {'scheduled_out': f'{DAY}T16:45:00'},
        {
            'origin': {
                'code': 'https://untrusted.test',
                'airport_info_url': 'https://untrusted.test',
            }
        },
        {'destination': {'code': '../secret'}},
        {'origin': {'code': 'VIDP', 'timezone': 'Unknown/Zone'}},
    ],
)
def test_malformed_candidates_are_skipped(monkeypatch, changes):
    install(monkeypatch, [None, 42, flight(**changes)])
    assert provider().lookup(INTENT) == []


def test_future_schedule_endpoint_handles_digit_in_iata_airline(monkeypatch):
    day = DAY + timedelta(days=30)
    raw = flight(
        origin='VIDP',
        origin_icao='VIDP',
        destination='VABB',
        destination_icao='VABB',
        scheduled_out=f'{day}T16:45:00Z',
        scheduled_in=f'{day}T19:40:00Z',
    )
    network = install(monkeypatch, [raw], scheduled=True)
    (result,) = provider().lookup(INTENT.model_copy(update={'departure_date': day}))
    assert result.departure_date == day
    request = network.call_args_list[0].args[0]
    assert '/schedules/' in request.full_url
    params = parse_qs(urlsplit(request.full_url).query)
    assert params['airline'] == ['6E']
    assert params['flight_number'] == ['7384']


@pytest.mark.parametrize('tracking', [False, True])
def test_next_day_request_caps_end_without_fractional_seconds(monkeypatch, tracking):
    now = datetime(2026, 10, 25, 11, 6, 14, 333861, tzinfo=timezone.utc)

    class FrozenDatetime(datetime):
        @classmethod
        def now(cls, tz=None):
            return now.astimezone(tz)

    monkeypatch.setattr(
        'services.flight_providers.flightaware_flight_provider.datetime', FrozenDatetime,
    )
    day = now.date() + timedelta(days=1)
    network = install(monkeypatch, [flight(
        scheduled_out=f'{day}T16:45:00Z', scheduled_in=f'{day}T19:40:00Z',
    )])
    adapter = provider()
    intent = INTENT.model_copy(update={'departure_date': day})
    results = adapter.track(intent) if tracking else adapter.lookup(intent)
    assert len(results) == 1
    request = network.call_args_list[0].args[0]
    assert '/flights/6E7384?' in request.full_url
    params = parse_qs(urlsplit(request.full_url).query)
    assert params['start'] == ['2026-10-25T10:00:00+00:00']
    # AeroAPI rejects fractional seconds when the active window caps the end.
    assert params['end'] == ['2026-10-27T11:06:13+00:00']


@pytest.mark.parametrize(
    'changes,status,departed,arrived',
    [
        ({'actual_out': f'{DAY}T16:50:00Z'}, 'SCHEDULED', False, False),
        (
            {'status': 'Arrived', 'estimated_on': f'{DAY}T19:20:00Z'},
            'SCHEDULED',
            False,
            False,
        ),
        ({'departure_delay': 600}, 'DELAYED', False, False),
        ({'actual_off': f'{DAY}T17:00:00Z'}, 'IN_FLIGHT', True, False),
        (
            {'actual_off': f'{DAY}T17:00:00Z', 'actual_on': f'{DAY}T19:20:00Z'},
            'ARRIVED',
            True,
            True,
        ),
        ({'cancelled': True}, 'CANCELLED', False, False),
        (
            {'diverted': True, 'actual_off': f'{DAY}T17:00:00Z', 'destination': None},
            'DIVERTED',
            True,
            False,
        ),
        (
            {'actual_off': '2999-01-01T00:00:00Z', 'actual_on': '2999-01-01T03:00:00Z'},
            'SCHEDULED',
            False,
            False,
        ),
    ],
)
def test_tracking_requires_confirmed_runway_movements(
    monkeypatch, changes, status, departed, arrived
):
    install(monkeypatch, [flight(**changes)])
    (result,) = provider().track(INTENT)
    assert result.status == status
    assert result.departure_confirmed is departed
    assert result.arrival_confirmed is arrived
    if changes.get('diverted'):
        assert result.diverted
        assert result.landing_airport is None


@pytest.mark.parametrize('key', [None, '', '  '])
def test_unconfigured_provider_does_not_request(monkeypatch, key):
    network = install(monkeypatch)
    with pytest.raises(FlightUnavailable) as error:
        provider(key).lookup(INTENT)
    assert error.value.result == 'CONFIGURATION_ERROR'
    network.assert_not_called()


@pytest.mark.parametrize(
    'code,result',
    [
        (401, 'CONFIGURATION_ERROR'),
        (403, 'CONFIGURATION_ERROR'),
        (429, 'RATE_LIMITED'),
        (500, 'UNAVAILABLE'),
    ],
)
def test_http_errors_are_redacted_and_rate_limits_preserved(monkeypatch, code, result):
    monkeypatch.setattr(
        MODULE,
        Mock(
            side_effect=HTTPError(
                'url',
                code,
                'private-key',
                {'Retry-After': '60'},
                BytesIO(b'private response'),
            )
        ),
    )
    with pytest.raises(FlightUnavailable) as error:
        provider().lookup(INTENT)
    assert error.value.result == result
    assert 'private' not in str(error.value)
    assert error.value.retry_after_seconds == 60


@pytest.mark.parametrize(
    'body',
    [b'not json', b'{}', b'[]', b'{"flights":{}}', b'x' * 2_000_001],
    ids=['invalid-json', 'missing-flights', 'array', 'invalid-flights', 'oversized'],
)
def test_invalid_response_is_unavailable(monkeypatch, body):
    network = install(monkeypatch)
    network.side_effect = None
    network.return_value = MagicMock()
    network.return_value.__enter__.return_value.read.return_value = body
    with pytest.raises(FlightUnavailable):
        provider().lookup(INTENT)


def test_network_errors_are_redacted(monkeypatch):
    monkeypatch.setattr(MODULE, Mock(side_effect=URLError('private-key')))
    with pytest.raises(FlightUnavailable, match='^Flight lookup unavailable$'):
        provider().lookup(INTENT)


def test_timeout_is_shared_with_airport_requests(monkeypatch):
    network = install(monkeypatch)
    ticks = iter([0, 0.1, 11])
    monkeypatch.setattr(
        'services.flight_providers.flightaware_flight_provider.monotonic',
        lambda: next(ticks),
    )
    with pytest.raises(FlightUnavailable):
        provider().lookup(INTENT)
    assert network.call_count == 1


def test_old_dates_use_history_endpoint(monkeypatch):
    day = DAY - timedelta(days=20)
    network = install(monkeypatch, [flight(scheduled_out=f'{day}T16:45:00Z')])
    assert provider().lookup(INTENT.model_copy(update={'departure_date': day}))
    assert '/history/flights/6E7384?' in network.call_args_list[0].args[0].full_url


def test_404_is_empty(monkeypatch):
    monkeypatch.setattr(
        MODULE, Mock(side_effect=HTTPError('url', 404, 'missing', {}, BytesIO()))
    )
    assert provider().lookup(INTENT) == []
