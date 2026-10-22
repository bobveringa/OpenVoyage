from datetime import date
from types import SimpleNamespace

import pytest
from pydantic import ValidationError

from models.api.planning import ConnectionIntent, Endpoint, FlightLookupRequest
from services.flight_providers import AeroDataBoxFlightProvider, FlightUnavailable
from services.flight_providers.aerodatabox_flight_provider import parse_flights
from services.planning_service import default_mode, same_endpoint


@pytest.mark.parametrize(
    'destination,expected',
    [
        ((52.09, 5.12), 'CAR'),
        ((41.39, 2.17), 'FLIGHT'),
        ((-33.92, 18.42), 'FLIGHT'),
    ],
)
def test_mode_inference(destination, expected):
    assert (
        default_mode(
            SimpleNamespace(latitude=52.37, longitude=4.9),
            SimpleNamespace(latitude=destination[0], longitude=destination[1]),
        )
        == expected
    )


def test_mode_inference_estimate_boundary():
    point = SimpleNamespace(latitude=52, longitude=5)
    assert default_mode(point, point, 43199) == 'CAR'
    assert default_mode(point, point, 43200) == 'FLIGHT'
    assert default_mode(point, point, no_road=True) == 'FLIGHT'


@pytest.mark.parametrize(
    'source,action,status,error,expected',
    [
        ('AUTO', 'infer', 'FAILED', 'NOT_CONFIGURED', 'OTHER'),
        ('AUTO', 'infer', 'FAILED', 'ROUTE_UNAVAILABLE', 'OTHER'),
        ('AUTO', 'refresh', 'UNSUPPORTED', None, 'OTHER'),
        ('AUTO', 'infer', 'FAILED', 'TIMEOUT', 'CAR'),
        ('AUTO', 'infer', 'FAILED', 'ROUTING_LIMIT_REACHED', 'CAR'),
        ('AUTO', 'infer', 'READY', None, 'CAR'),
        ('USER', 'refresh', 'FAILED', 'ROUTE_UNAVAILABLE', 'CAR'),
        ('AUTO', 'explicit', 'FAILED', 'ROUTE_UNAVAILABLE', 'CAR'),
    ],
)
def test_preparation_finalizes_only_unavailable_automatic_transport(
    source, action, status, error, expected
):
    import uuid
    from unittest.mock import Mock
    from models.api.itinerary import ItineraryTravelReplaceRequest
    from models.api.planning import SegmentIntent
    from services.planning_service import PlanningService, ResolvedSegment

    segment_id = uuid.uuid4()
    start, end = Endpoint(latitude=52, longitude=5), Endpoint(latitude=53, longitude=6)
    leg = SimpleNamespace(
        from_stop_id=uuid.uuid4(), to_stop_id=uuid.uuid4(), notes='Journey notes',
        from_stop=SimpleNamespace(location=start),
        to_stop=SimpleNamespace(location=end),
        segments=[SimpleNamespace(id=segment_id, input_version=4)],
    )
    segment = ResolvedSegment(
        SegmentIntent(id=segment_id, travel_mode='CAR'), segment_id, source, 4,
        start, end, None, None, None,
        {'status': status, 'error_code': error},
    )
    service = PlanningService(Mock(), Mock())
    segment.input_hash = service.segment_input_hash(segment)
    if action == 'infer':
        intent = ItineraryTravelReplaceRequest.model_validate({
            'from': {'type': 'STOP', 'stop_id': leg.from_stop_id},
            'to': {'type': 'STOP', 'stop_id': leg.to_stop_id},
        })
    elif action == 'explicit':
        intent = ConnectionIntent(segments=[segment.intent])
    else:
        intent = None
    prepared = service.prepare_connection(leg, intent, [segment])
    resolved = prepared.segments[0]
    fallback = expected == 'OTHER'
    assert resolved.intent.travel_mode == expected
    assert prepared.intent.segments[0].travel_mode == expected
    assert resolved.input_hash == service.segment_input_hash(resolved)
    assert resolved.version == (5 if fallback else 4)
    assert (resolved.result is None) == fallback
    assert bool(prepared.warnings) == fallback
    assert prepared.binding == service.binding(leg, prepared.intent)
    # Finalizing a suggestion must not alter the cached calculation inputs.
    assert segment.intent.travel_mode == 'CAR'
    assert segment.result['status'] == status
    assert segment.version == 4


@pytest.mark.parametrize(
    'segments',
    [
        [],
        [{'travel_mode': 'CAR'}] * 21,
        [{'travel_mode': 'CAR', 'via': [{'latitude': 1, 'longitude': 2}]}],
        [{'travel_mode': 'CAR', 'duration_seconds': 900}],
        [{'travel_mode': 'FLIGHT', 'flight': {'lookup': {}}}],
        [{'travel_mode': 'TRAIN', 'via': {'latitude': 1, 'longitude': 2}}],
        [{'travel_mode': 'CAR', 'from': {'place_id': 'not-a-uuid', 'latitude': 1}}],
        [{'travel_mode': 'UNKNOWN'}],
    ],
)
def test_intent_rejects_invalid_or_calculated_fields(segments):
    with pytest.raises(ValidationError):
        ConnectionIntent(segments=segments)


def test_incomplete_flight_draft_is_valid():
    assert ConnectionIntent(segments=[{'travel_mode': 'FLIGHT', 'flight': {}}])


def test_airport_codes_match_despite_coordinate_differences():
    a = Endpoint(latitude=52.3, longitude=4.7, iata_code='AMS')
    b = Endpoint(latitude=52.31, longitude=4.71, iata_code='AMS')
    assert same_endpoint(a, b)
    assert not same_endpoint(a, b.model_copy(update={'iata_code': 'RTM'}))
    assert not same_endpoint(
        a.model_copy(update={'iata_code': None}),
        b.model_copy(update={'iata_code': None}),
    )


def flight_payload():
    return [
        {
            'number': 'KL 597',
            'airline': {'name': 'KLM'},
            'departure': {
                'airport': {
                    'name': 'Schiphol',
                    'iata': 'AMS',
                    'timeZone': 'Europe/Amsterdam',
                    'location': {'lat': 52.3, 'lon': 4.7},
                },
                'scheduledTime': {'local': '2026-11-18T10:00:00+01:00'},
            },
            'arrival': {
                'airport': {
                    'name': 'Cape Town',
                    'iata': 'CPT',
                    'timeZone': 'Africa/Johannesburg',
                    'location': {'lat': -33.97, 'lon': 18.6},
                },
                'scheduledTime': {'local': '2026-11-18T22:00:00+02:00'},
            },
        }
    ]


def test_provider_normalizes_and_compares_instants():
    intent = FlightLookupRequest(
        flight_number='kl 597', departure_date=date(2026, 11, 18)
    )
    result = parse_flights(flight_payload(), intent)
    assert len(result) == 1
    assert result[0].duration_seconds == 11 * 3600
    assert result[0].departure_airport.iata_code == 'AMS'
    assert 'status' not in result[0].model_dump()


def test_missing_offsets_do_not_invent_estimate():
    payload = flight_payload()
    payload[0]['departure']['scheduledTime'] = {'local': '2026-11-18T10:00:00'}
    result = parse_flights(
        payload, FlightLookupRequest(flight_number='KL597', departure_date='2026-11-18')
    )
    assert result[0].duration_seconds is None


def test_no_key_never_calls_provider(monkeypatch):
    monkeypatch.setattr(
        'services.flight_providers.aerodatabox_flight_provider.urlopen',
        lambda *_a, **_k: pytest.fail('Unexpected network call'),
    )
    with pytest.raises(FlightUnavailable):
        AeroDataBoxFlightProvider(
            api_key=None, base_url='https://example.test', rapidapi_host='example.test'
        ).lookup(
            FlightLookupRequest(flight_number='KL597', departure_date='2026-11-18')
        )


@pytest.mark.parametrize(
    'overlap,airport_change,expected',
    [
        (False, False, 12600),
        (True, False, None),
        (False, True, None),
    ],
)
def test_flight_chains_include_layovers_across_dst_and_reject_invalid_totals(
    overlap, airport_change, expected
):
    import uuid
    from models.api.planning import FlightLookup, SegmentIntent
    from services.planning_service import PlanningService, ResolvedSegment
    from unittest.mock import Mock

    a = Endpoint(latitude=52, longitude=5, iata_code='AMS')
    b = Endpoint(latitude=51, longitude=0, iata_code='LHR')
    c = Endpoint(latitude=48, longitude=2, iata_code='CDG')
    first = FlightLookup(
        flight_number='KL123',
        departure_date='2026-10-25',
        fetched_at='2026-10-18T12:00:00Z',
        departure_airport=a,
        arrival_airport=b,
        scheduled_departure='2026-10-25T01:30:00+02:00',
        scheduled_arrival='2026-10-25T01:15:00+01:00',
    )
    second = FlightLookup(
        flight_number='KL124',
        departure_date='2026-10-25',
        fetched_at='2026-10-18T12:00:00Z',
        departure_airport=c if airport_change else b,
        arrival_airport=c,
        scheduled_departure='2026-10-25T01:00:00+01:00'
        if overlap
        else '2026-10-25T02:00:00+01:00',
        scheduled_arrival='2026-10-25T04:00:00+01:00',
    )
    segments = [
        ResolvedSegment(
            SegmentIntent(travel_mode='FLIGHT'),
            uuid.uuid4(),
            'USER',
            1,
            lookup.departure_airport,
            lookup.arrival_airport,
            None,
            lookup,
            uuid.uuid4(),
            None,
        )
        for lookup in (first, second)
    ]
    stop = SimpleNamespace(planned_start_date=date(2026, 10, 25))
    result = PlanningService(Mock(), Mock()).connection(
        SimpleNamespace(from_stop=stop, to_stop=stop), segments
    )
    assert result['duration_seconds'] == expected
    assert result['duration_scope'] == ('FLIGHT_JOURNEY' if expected else None)
    assert bool(result['warnings']) == (overlap or airport_change)


def test_calculation_deadline_does_not_dispatch_remaining_segments(monkeypatch):
    import uuid
    from unittest.mock import Mock
    from models.api.planning import SegmentIntent
    from services.planning_service import PlanningService, ResolvedSegment

    point = Endpoint(latitude=52, longitude=5)
    segments = [
        ResolvedSegment(
            SegmentIntent(travel_mode='CAR'),
            uuid.uuid4(),
            'USER',
            1,
            point,
            point,
            None,
            None,
            None,
            None,
        )
        for _ in range(3)
    ]
    clock = iter([0, 0, 31])
    monkeypatch.setattr('services.planning_service.time.monotonic', lambda: next(clock))
    service = PlanningService(Mock(), Mock())
    service._calculate_one = Mock(return_value={'status': 'READY'})
    service.calculate(segments)
    assert service._calculate_one.call_count == 2
    assert segments[-1].result is None


@pytest.mark.parametrize(
    'kind,departure_warning,arrival_warning',
    [
        ('DEPARTURE', False, True),
        ('RETURN', True, False),
        ('BETWEEN_STOPS', True, True),
    ],
)
def test_flight_dates_only_compare_real_stop_sides(
    kind, departure_warning, arrival_warning
):
    import uuid
    from unittest.mock import Mock
    from models.api.planning import FlightLookup, SegmentIntent
    from services.planning_service import PlanningService, ResolvedSegment

    point = Endpoint(latitude=52, longitude=5)
    lookup = FlightLookup(
        flight_number='KL597',
        departure_date='2026-11-18',
        fetched_at='2026-11-17T12:00:00Z',
        departure_airport=point,
        arrival_airport=point,
        scheduled_departure='2026-11-18T10:00:00+01:00',
        scheduled_arrival='2026-11-18T14:00:00+02:00',
    )
    stop = SimpleNamespace(planned_start_date=date(2026, 11, 17), planned_nights=3)
    leg = SimpleNamespace(
        from_stop=None if kind == 'DEPARTURE' else stop,
        to_stop=None if kind == 'RETURN' else stop,
    )
    segment = ResolvedSegment(
        SegmentIntent(travel_mode='FLIGHT', flight={'departure_date': '2026-11-18'}),
        uuid.uuid4(),
        'USER',
        1,
        point,
        point,
        None,
        lookup,
        uuid.uuid4(),
        None,
    )
    warnings = PlanningService(Mock(), Mock()).connection(leg, [segment])['warnings']
    assert any('preceding stop' in warning for warning in warnings) == departure_warning
    assert any('destination stop' in warning for warning in warnings) == arrival_warning
