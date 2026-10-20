import uuid
import pytest
from pydantic import ValidationError, TypeAdapter
from models.api.itinerary import (
    ItineraryTravelReplaceRequest,
    ConnectionEndpointResponse,
)
from datetime import date

from models.api.itinerary import is_itinerary_stop_visited


def test_itinerary_stop_is_visited_on_departure_date() -> None:
    today = date(2026, 7, 28)

    assert is_itinerary_stop_visited(
        planned_start_date=date(2026, 7, 28),
        planned_nights=0,
        today=today,
    )
    assert is_itinerary_stop_visited(
        planned_start_date=date(2026, 7, 27),
        planned_nights=1,
        today=today,
    )
    assert not is_itinerary_stop_visited(
        planned_start_date=date(2026, 7, 28),
        planned_nights=1,
        today=today,
    )
    assert not is_itinerary_stop_visited(
        planned_start_date=date(2026, 7, 29),
        planned_nights=0,
        today=today,
    )


def endpoint_body():
    return {
        'from': {'type': 'LOCATION', 'location': {'latitude': 52, 'longitude': 5}},
        'to': {'type': 'STOP', 'stop_id': str(uuid.uuid4())},
    }


def test_connection_write_defaults_and_strict_endpoint_unions():
    body = endpoint_body()
    assert ItineraryTravelReplaceRequest.model_validate(body).segments is None
    for changes in (
        {'segments': None},
        {'segments': []},
        {'connection_type': 'RETURN'},
        {
            'from': {
                'type': 'LOCATION',
                'location': {'latitude': 52, 'longitude': 5, 'name': 'Trusted?'},
            }
        },
        {'from': {'type': 'STOP', 'stop_id': str(uuid.uuid4()), 'location': {}}},
        {'to': body['from']},
        {'from': body['to']},
        {'segments': [{'travel_mode': 'CAR', 'duration_seconds': 100}]},
    ):
        with pytest.raises(ValidationError):
            ItineraryTravelReplaceRequest.model_validate(body | changes)
    with pytest.raises(ValidationError):
        ItineraryTravelReplaceRequest.model_validate(
            {'segments': [{'travel_mode': 'CAR'}]}
        )


def test_connection_response_stop_endpoints_are_compact():
    adapter = TypeAdapter(ConnectionEndpointResponse)
    endpoint = {'type': 'STOP', 'stop_id': str(uuid.uuid4())}
    assert adapter.validate_python(endpoint).model_dump(mode='json') == endpoint
    with pytest.raises(ValidationError):
        adapter.validate_python(endpoint | {'title': 'No repeated stop data'})
    location = {
        'id': str(uuid.uuid4()),
        'name': 'Outside',
        'latitude': 52,
        'longitude': 5,
        'country_code': 'NL',
        'region': '',
        'full_name': 'Outside',
    }
    assert (
        adapter.validate_python(
            {'type': 'LOCATION', 'location': location}
        ).location.name
        == 'Outside'
    )
