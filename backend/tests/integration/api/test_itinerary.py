from __future__ import annotations

import uuid

import pytest

from core import security
from factories.places import create_place
from factories.trips import add_trip_viewer, create_trip
from factories.users import create_user
from models.database.trips import TripVisibility


def _auth_headers(user, *, etag: str | None = None) -> dict[str, str]:
    tokens = security.create_auth_tokens(subject=user.id, email=user.email)
    headers = {'Authorization': f'Bearer {tokens["access_token"]}'}
    if etag is not None:
        headers['If-Match'] = etag
    return headers


def _place_location(place) -> dict[str, str]:
    return {'place_id': str(place.id)}


def _stop_payload(
    place,
    *,
    title: str,
    planned_start_date: str = '2026-08-14',
    after_stop_id: str | None = None,
    incoming_travel: dict | None = None,
    outgoing_travel: dict | None = None,
) -> dict:
    return {
        'location': _place_location(place),
        'title': title,
        'notes': '',
        'planned_nights': 0,
        'placement': {
            'planned_start_date': planned_start_date,
            'after_stop_id': after_stop_id,
        },
        'incoming_travel': incoming_travel,
        'outgoing_travel': outgoing_travel,
    }


@pytest.mark.integration
def test_itinerary_create_insert_and_delete_rebalances_legs(
    client,
    db_session,
    api_prefix,
) -> None:
    owner = create_user(
        db_session,
        password='ItineraryPass123!',
        username='owner',
        first_name='Trip',
        last_name='Owner',
    )
    trip = create_trip(
        db_session,
        owner_id=owner.id,
        visibility=TripVisibility.PUBLIC,
    )
    eindhoven = create_place(db_session, name='Eindhoven', country_code='NL')
    utrecht = create_place(db_session, name='Utrecht', country_code='NL')
    amsterdam = create_place(db_session, name='Amsterdam', country_code='NL')

    empty_response = client.get(f'{api_prefix}/trips/{trip.id}/itinerary')
    assert empty_response.status_code == 200
    assert empty_response.headers['etag'] == '"0"'
    assert empty_response.json() == {
        'trip_id': str(trip.id),
        'itinerary_revision': 0,
        'stops': [],
        'legs': [],
    }

    first_response = client.post(
        f'{api_prefix}/trips/{trip.id}/itinerary/stops',
        headers=_auth_headers(owner, etag='"0"'),
        json=_stop_payload(eindhoven, title='Start in Eindhoven'),
    )
    assert first_response.status_code == 201
    first_payload = first_response.json()
    first_stop_id = first_payload['stops'][0]['id']
    assert first_response.headers['etag'] == '"1"'
    assert first_payload['itinerary_revision'] == 1
    assert first_payload['legs'] == []
    assert first_payload['stops'][0]['location']['name'] == 'Eindhoven'

    second_response = client.post(
        f'{api_prefix}/trips/{trip.id}/itinerary/stops',
        headers=_auth_headers(owner, etag='"1"'),
        json=_stop_payload(
            amsterdam,
            title='Amsterdam',
            after_stop_id=first_stop_id,
            incoming_travel={
                'travel_mode': 'TRAIN',
                'notes': 'Intercity',
                'operator': 'NS',
                'reference': 'IC 3529',
            },
        ),
    )
    assert second_response.status_code == 201
    second_payload = second_response.json()
    second_stop_id = second_payload['stops'][1]['id']
    assert second_response.headers['etag'] == '"2"'
    assert [stop['title'] for stop in second_payload['stops']] == [
        'Start in Eindhoven',
        'Amsterdam',
    ]
    assert [
        (leg['from_stop_id'], leg['to_stop_id']) for leg in second_payload['legs']
    ] == [(first_stop_id, second_stop_id)]
    assert second_payload['legs'][0]['travel_mode'] == 'TRAIN'
    old_leg_id = second_payload['legs'][0]['id']

    middle_response = client.post(
        f'{api_prefix}/trips/{trip.id}/itinerary/stops',
        headers=_auth_headers(owner, etag='"2"'),
        json=_stop_payload(
            utrecht,
            title='Utrecht',
            after_stop_id=first_stop_id,
            incoming_travel={'travel_mode': 'WALK', 'notes': 'Station walk'},
            outgoing_travel={'travel_mode': 'BUS', 'notes': 'Regional bus'},
        ),
    )
    assert middle_response.status_code == 201
    middle_payload = middle_response.json()
    middle_stop_id = middle_payload['stops'][1]['id']
    assert middle_response.headers['etag'] == '"3"'
    assert [stop['title'] for stop in middle_payload['stops']] == [
        'Start in Eindhoven',
        'Utrecht',
        'Amsterdam',
    ]
    assert [stop['same_day_position'] for stop in middle_payload['stops']] == [
        0,
        1,
        2,
    ]
    assert {leg['id'] for leg in middle_payload['legs']} != {old_leg_id}
    assert [
        (leg['from_stop_id'], leg['to_stop_id'], leg['travel_mode'])
        for leg in middle_payload['legs']
    ] == [
        (first_stop_id, middle_stop_id, 'WALK'),
        (middle_stop_id, second_stop_id, 'BUS'),
    ]

    delete_response = client.delete(
        f'{api_prefix}/trips/{trip.id}/itinerary/stops/{middle_stop_id}',
        headers=_auth_headers(owner, etag='"3"'),
    )
    assert delete_response.status_code == 200
    delete_payload = delete_response.json()
    assert delete_response.headers['etag'] == '"4"'
    assert [stop['title'] for stop in delete_payload['stops']] == [
        'Start in Eindhoven',
        'Amsterdam',
    ]
    assert [stop['same_day_position'] for stop in delete_payload['stops']] == [0, 1]
    assert [
        (leg['from_stop_id'], leg['to_stop_id'], leg['travel_mode'])
        for leg in delete_payload['legs']
    ] == [(first_stop_id, second_stop_id, 'UNKNOWN')]


@pytest.mark.integration
def test_itinerary_mutations_require_current_quoted_revision(
    client,
    db_session,
    api_prefix,
) -> None:
    owner = create_user(db_session, password='ItineraryPass123!')
    trip = create_trip(db_session, owner_id=owner.id)
    place = create_place(db_session)
    endpoint = f'{api_prefix}/trips/{trip.id}/itinerary/stops'

    missing_response = client.post(
        endpoint,
        headers=_auth_headers(owner),
        json=_stop_payload(place, title='Kyoto'),
    )
    invalid_response = client.post(
        endpoint,
        headers=_auth_headers(owner, etag='0'),
        json=_stop_payload(place, title='Kyoto'),
    )
    create_response = client.post(
        endpoint,
        headers=_auth_headers(owner, etag='"0"'),
        json=_stop_payload(place, title='Kyoto'),
    )
    stale_response = client.post(
        endpoint,
        headers=_auth_headers(owner, etag='"0"'),
        json=_stop_payload(place, title='Second Kyoto'),
    )

    assert missing_response.status_code == 428
    assert invalid_response.status_code == 422
    assert create_response.status_code == 201
    assert create_response.headers['etag'] == '"1"'
    assert stale_response.status_code == 412

    get_response = client.get(
        f'{api_prefix}/trips/{trip.id}/itinerary',
        headers=_auth_headers(owner),
    )
    assert get_response.status_code == 200
    assert get_response.headers['etag'] == '"1"'
    assert [stop['title'] for stop in get_response.json()['stops']] == ['Kyoto']


@pytest.mark.integration
def test_itinerary_permissions_follow_trip_roles(
    client,
    db_session,
    api_prefix,
) -> None:
    owner = create_user(db_session, password='ItineraryPass123!')
    viewer = create_user(db_session, password='ItineraryPass123!')
    non_member = create_user(db_session, password='ItineraryPass123!')
    trip = create_trip(db_session, owner_id=owner.id)
    add_trip_viewer(
        db_session,
        trip_id=trip.id,
        user_id=viewer.id,
        created_by=owner.id,
    )
    place = create_place(db_session)
    endpoint = f'{api_prefix}/trips/{trip.id}/itinerary/stops'

    viewer_response = client.post(
        endpoint,
        headers=_auth_headers(viewer, etag='"0"'),
        json=_stop_payload(place, title='Viewer stop'),
    )
    non_member_response = client.post(
        endpoint,
        headers=_auth_headers(non_member, etag='"0"'),
        json=_stop_payload(place, title='Non-member stop'),
    )
    read_response = client.get(
        f'{api_prefix}/trips/{trip.id}/itinerary',
        headers=_auth_headers(viewer),
    )

    assert viewer_response.status_code == 403
    assert non_member_response.status_code == 404
    assert read_response.status_code == 200


@pytest.mark.integration
def test_share_link_can_read_private_trip_itinerary(
    client,
    db_session,
    api_prefix,
) -> None:
    owner = create_user(db_session, password='ItineraryPass123!')
    trip = create_trip(db_session, owner_id=owner.id)
    place = create_place(db_session, name='Utrecht')
    owner_headers = _auth_headers(owner)
    create_stop_response = client.post(
        f'{api_prefix}/trips/{trip.id}/itinerary/stops',
        headers=_auth_headers(owner, etag='"0"'),
        json=_stop_payload(place, title='Shared stop'),
    )
    link_response = client.post(
        f'{api_prefix}/trips/{trip.id}/share-links',
        headers=owner_headers,
        json={'label': 'Itinerary'},
    )
    share_headers = {'X-Trip-Share-Token': link_response.json()['token']}

    read_response = client.get(
        f'{api_prefix}/trips/{trip.id}/itinerary',
        headers=share_headers,
    )
    mutate_response = client.post(
        f'{api_prefix}/trips/{trip.id}/itinerary/stops',
        headers={**share_headers, 'If-Match': '"1"'},
        json=_stop_payload(place, title='Blocked stop'),
    )

    assert create_stop_response.status_code == 201
    assert link_response.status_code == 201
    assert read_response.status_code == 200
    assert [stop['title'] for stop in read_response.json()['stops']] == [
        'Shared stop'
    ]
    assert mutate_response.status_code == 401


@pytest.mark.integration
def test_location_replacement_resets_adjacent_travel_and_put_is_noop(
    client,
    db_session,
    api_prefix,
) -> None:
    owner = create_user(db_session, password='ItineraryPass123!')
    trip = create_trip(db_session, owner_id=owner.id)
    first_place = create_place(db_session, name='Eindhoven', country_code='NL')
    second_place = create_place(db_session, name='Utrecht', country_code='NL')
    replacement_place = create_place(db_session, name='Rotterdam', country_code='NL')

    first_response = client.post(
        f'{api_prefix}/trips/{trip.id}/itinerary/stops',
        headers=_auth_headers(owner, etag='"0"'),
        json=_stop_payload(first_place, title='Eindhoven'),
    )
    first_stop_id = first_response.json()['stops'][0]['id']
    second_response = client.post(
        f'{api_prefix}/trips/{trip.id}/itinerary/stops',
        headers=_auth_headers(owner, etag='"1"'),
        json=_stop_payload(
            second_place,
            title='Utrecht',
            after_stop_id=first_stop_id,
            incoming_travel={
                'travel_mode': 'TRAIN',
                'notes': 'Tickets booked',
                'operator': 'NS',
            },
        ),
    )
    leg = second_response.json()['legs'][0]
    second_stop_id = second_response.json()['stops'][1]['id']

    noop_leg_response = client.put(
        f'{api_prefix}/trips/{trip.id}/itinerary/legs/{leg["id"]}',
        headers=_auth_headers(owner, etag='"2"'),
        json={
            'travel_mode': 'TRAIN',
            'notes': 'Tickets booked',
            'operator': 'NS',
            'reference': None,
        },
    )
    assert noop_leg_response.status_code == 200
    assert noop_leg_response.headers['etag'] == '"2"'

    patch_response = client.patch(
        f'{api_prefix}/trips/{trip.id}/itinerary/stops/{second_stop_id}',
        headers=_auth_headers(owner, etag='"2"'),
        json={'location': _place_location(replacement_place)},
    )
    assert patch_response.status_code == 200
    assert patch_response.headers['etag'] == '"3"'
    payload = patch_response.json()
    assert payload['stops'][1]['location']['name'] == 'Rotterdam'
    assert payload['legs'][0]['travel_mode'] == 'UNKNOWN'
    assert payload['legs'][0]['notes'] == ''
    assert payload['legs'][0]['operator'] is None


@pytest.mark.integration
def test_itinerary_returns_not_found_for_missing_ids(client, api_prefix) -> None:
    response = client.get(f'{api_prefix}/trips/{uuid.uuid4()}/itinerary')
    assert response.status_code == 404
