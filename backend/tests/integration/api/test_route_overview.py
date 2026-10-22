from datetime import timedelta

import pytest

from core import security
from factories.places import create_place
from factories.trips import add_trip_member, add_trip_viewer, create_trip
from factories.users import create_user
from models.database.base import utcnow
from models.database.trips import TripVisibility


def auth(user):
    tokens = security.create_auth_tokens(subject=user.id, email=user.email)
    return {'Authorization': f'Bearer {tokens["access_token"]}'}


@pytest.mark.integration
@pytest.mark.parametrize(
    'audience,can_view,can_plan',
    [
        ('owner', True, True),
        ('member', True, True),
        ('viewer', True, False),
        ('share', True, False),
        ('signed_in_share', True, False),
        ('public', True, False),
        ('signed_in_public', True, False),
        ('platform', True, False),
        ('anonymous_platform', False, False),
        ('outsider', False, False),
        ('anonymous', False, False),
        ('revoked_share', False, False),
        ('expired_share', False, False),
        ('invalid_share', False, False),
    ],
)
def test_route_overview_access_and_private_planning_boundaries(
    client,
    db_session,
    api_prefix,
    audience,
    can_view,
    can_plan,
):
    owner = create_user(db_session, password='ItineraryPass123!')
    reader = create_user(db_session, password='ItineraryPass123!')
    visibility = (
        TripVisibility.PUBLIC
        if audience in {'public', 'signed_in_public'}
        else TripVisibility.PLATFORM_PUBLIC
        if 'platform' in audience
        else TripVisibility.PRIVATE
    )
    trip = create_trip(db_session, owner_id=owner.id, visibility=visibility)
    root = f'{api_prefix}/trips/{trip.id}/itinerary'
    headers = auth(owner)
    place = create_place(db_session, name='Amsterdam')
    stop_response = client.post(
        f'{root}/stops',
        headers={**headers, 'If-Match': '"0"'},
        json={
            'location': {'place_id': str(place.id)},
            'title': 'Private title KL597',
            'notes': 'Private stop note',
            'planned_nights': 3,
            'placement': {'planned_start_date': '2099-05-10', 'after_stop_id': None},
        },
    )
    assert stop_response.status_code == 201
    stop_id = stop_response.json()['stops'][0]['id']
    leg_response = client.post(
        f'{root}/connections',
        headers={**headers, 'If-Match': '"1"'},
        json={
            'from': {
                'type': 'LOCATION',
                'location': {'latitude': 51.5, 'longitude': -0.1},
            },
            'to': {'type': 'STOP', 'stop_id': stop_id},
            'notes': 'Private connection note',
            'segments': [
                {
                    'travel_mode': 'FLIGHT',
                    'notes': 'Private segment note',
                    'flight': {
                        'flight_number': 'KL597',
                        'departure_date': '2099-05-09',
                    },
                }
            ],
        },
    )
    assert leg_response.status_code == 201
    leg_id = leg_response.json()['id']

    reader_headers = {}
    if audience == 'owner':
        reader_headers = headers
    elif audience == 'member':
        add_trip_member(db_session, trip_id=trip.id, user_id=reader.id)
        reader_headers = auth(reader)
    elif audience == 'viewer':
        add_trip_viewer(
            db_session, trip_id=trip.id, user_id=reader.id, created_by=owner.id
        )
        reader_headers = auth(reader)
    elif audience in {'outsider', 'platform', 'signed_in_public', 'signed_in_share'}:
        reader_headers = auth(reader)

    if 'share' in audience:
        link = client.post(
            f'{api_prefix}/trips/{trip.id}/share-links', headers=headers, json={}
        )
        assert link.status_code == 201
        reader_headers['X-Trip-Share-Token'] = link.json()['token']
        if audience in {'revoked_share', 'expired_share'}:
            update = (
                {'revoked': True}
                if audience == 'revoked_share'
                else {
                    'expires_at': (utcnow() - timedelta(days=1)).isoformat(),
                }
            )
            result = client.patch(
                f'{api_prefix}/trips/{trip.id}/share-links/{link.json()["id"]}',
                headers=headers,
                json=update,
            )
            assert result.status_code == 200
        elif audience == 'invalid_share':
            reader_headers['X-Trip-Share-Token'] = 'invalid'

    overview = client.get(f'{root}/overview', headers=reader_headers)
    assert overview.status_code == (200 if can_view else 404)
    for path in ['', f'/stops/{stop_id}', f'/connections/{leg_id}']:
        result = client.get(f'{root}{path}', headers=reader_headers)
        assert result.status_code == (200 if can_plan else 403 if can_view else 404)

    if not can_view:
        return
    data = overview.json()
    assert overview.headers['cache-control'] == 'private, no-store'
    assert data['stops'][0]['title'] == 'Amsterdam'
    assert data['stops'][0]['visited'] is False
    assert data['legs'][0]['from']['type'] == 'LOCATION'
    assert data['legs'][0]['to']['stop_id'] == stop_id
    assert (
        data['legs'][0]['route']['geometry'] == leg_response.json()['route']['geometry']
    )
    assert data['legs'][0]['segments'][0]['intent'] == {'travel_mode': 'FLIGHT'}

    forbidden = {
        'notes',
        'planned_start_date',
        'planned_nights',
        'same_day_position',
        'flight',
        'flight_number',
        'departure_date',
        'lookup',
        'candidate_id',
        'scheduled_departure',
        'scheduled_arrival',
        'service_company',
        'service_number',
        'duration_seconds',
        'route_options',
        'warnings',
        'created_by',
        'created_at',
        'updated_at',
        'itinerary_revision',
    }

    def check(value):
        if isinstance(value, dict):
            assert not forbidden.intersection(value)
            for child in value.values():
                check(child)
        elif isinstance(value, list):
            for child in value:
                check(child)

    check(data)
    assert 'KL597' not in overview.text
    assert 'Private' not in overview.text
    assert '2099-05' not in overview.text

    if can_plan:
        assert (
            client.get(f'{root}/connections/{leg_id}', headers=reader_headers).json()['notes']
            == 'Private connection note'
        )
