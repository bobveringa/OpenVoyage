from __future__ import annotations

import uuid

import pytest

from core import security
from factories.media import create_media
from factories.places import create_place
from factories.trips import add_trip_member
from factories.users import create_user
from models.database.trips import TripRole, TripVisibility


def _auth_headers(user) -> dict[str, str]:
    tokens = security.create_auth_tokens(subject=user.id, email=user.email)
    return {'Authorization': f'Bearer {tokens["access_token"]}'}


def _create_trip(
    client,
    db_session,
    api_prefix,
    user,
    name: str = 'Trip',
    visibility: TripVisibility = TripVisibility.PRIVATE,
) -> str:
    media = create_media(
        db_session,
        storage_path=f'media/{uuid.uuid4()}-cover.jpg',
        created_by=user.id,
    )
    response = client.post(
        f'{api_prefix}/trips',
        headers=_auth_headers(user),
        json={
            'name': name,
            'description': '',
            'media_id': str(media.id),
            'visibility': visibility.value,
            'start_date': '2026-08-01',
            'end_date': '2026-08-21',
        },
    )
    assert response.status_code == 201
    return response.json()['id']


def _create_step(
    client,
    db_session,
    api_prefix,
    user,
    trip_id: str,
    *,
    place_name: str,
    arrival_date: str,
    departure_date: str,
    after_planned_step_id: str | None = None,
) -> dict:
    place = create_place(
        db_session,
        name=place_name,
        full_name=f'{place_name}, Japan',
    )
    payload = {
        'location': {'place_id': str(place.id)},
        'arrival_date': arrival_date,
        'departure_date': departure_date,
        'notes': place_name,
    }
    if after_planned_step_id is not None:
        payload['after_planned_step_id'] = after_planned_step_id

    response = client.post(
        f'{api_prefix}/trips/{trip_id}/planned-steps',
        headers=_auth_headers(user),
        json=payload,
    )
    assert response.status_code == 201
    return response.json()


@pytest.mark.integration
def test_get_itinerary_returns_steps_and_travel_in_manual_order(
    client,
    db_session,
    api_prefix,
) -> None:
    user = create_user(db_session, password='TripsPass123!')
    trip_id = _create_trip(client, db_session, api_prefix, user)
    first = _create_step(
        client,
        db_session,
        api_prefix,
        user,
        trip_id,
        place_name='First',
        arrival_date='2026-08-10',
        departure_date='2026-08-11',
    )
    third = _create_step(
        client,
        db_session,
        api_prefix,
        user,
        trip_id,
        place_name='Third',
        arrival_date='2026-08-01',
        departure_date='2026-08-02',
        after_planned_step_id=first['id'],
    )
    second = _create_step(
        client,
        db_session,
        api_prefix,
        user,
        trip_id,
        place_name='Second',
        arrival_date='2026-08-05',
        departure_date='2026-08-06',
        after_planned_step_id=first['id'],
    )

    second_travel_response = client.post(
        f'{api_prefix}/trips/{trip_id}/planned-travel',
        headers=_auth_headers(user),
        json={
            'from_planned_step_id': second['id'],
            'to_planned_step_id': third['id'],
            'travel_mode': 'BUS',
            'notes': '',
        },
    )
    first_travel_response = client.post(
        f'{api_prefix}/trips/{trip_id}/planned-travel',
        headers=_auth_headers(user),
        json={
            'from_planned_step_id': first['id'],
            'to_planned_step_id': second['id'],
            'travel_mode': 'TRAIN',
            'notes': '',
        },
    )

    response = client.get(
        f'{api_prefix}/trips/{trip_id}/itinerary',
        headers=_auth_headers(user),
    )

    assert second_travel_response.status_code == 201
    assert first_travel_response.status_code == 201
    assert response.status_code == 200
    payload = response.json()
    assert [step['id'] for step in payload['steps']] == [
        first['id'],
        second['id'],
        third['id'],
    ]
    assert [travel['id'] for travel in payload['travel']] == [
        first_travel_response.json()['id'],
        second_travel_response.json()['id'],
    ]
    assert all('step_number' not in step for step in payload['steps'])
    assert all('position' not in step for step in payload['steps'])


@pytest.mark.integration
def test_planned_steps_use_manual_order_not_dates(
    client,
    db_session,
    api_prefix,
) -> None:
    user = create_user(db_session, password='TripsPass123!')
    trip_id = _create_trip(client, db_session, api_prefix, user)

    tokyo = _create_step(
        client,
        db_session,
        api_prefix,
        user,
        trip_id,
        place_name='Tokyo',
        arrival_date='2026-08-10',
        departure_date='2026-08-12',
    )
    osaka = _create_step(
        client,
        db_session,
        api_prefix,
        user,
        trip_id,
        place_name='Osaka',
        arrival_date='2026-08-01',
        departure_date='2026-08-03',
        after_planned_step_id=tokyo['id'],
    )
    _create_step(
        client,
        db_session,
        api_prefix,
        user,
        trip_id,
        place_name='Kyoto',
        arrival_date='2026-08-05',
        departure_date='2026-08-08',
        after_planned_step_id=tokyo['id'],
    )

    response = client.get(
        f'{api_prefix}/trips/{trip_id}/planned-steps',
        headers=_auth_headers(user),
    )

    assert response.status_code == 200
    payload = response.json()
    assert [step['location']['name'] for step in payload] == [
        'Tokyo',
        'Kyoto',
        'Osaka',
    ]
    assert all('step_number' not in step for step in payload)
    assert all('position' not in step for step in payload)
    assert payload[-1]['id'] == osaka['id']


@pytest.mark.integration
def test_move_planned_step_to_start(client, db_session, api_prefix) -> None:
    user = create_user(db_session, password='TripsPass123!')
    trip_id = _create_trip(client, db_session, api_prefix, user)
    first = _create_step(
        client,
        db_session,
        api_prefix,
        user,
        trip_id,
        place_name='First',
        arrival_date='2026-08-01',
        departure_date='2026-08-02',
    )
    second = _create_step(
        client,
        db_session,
        api_prefix,
        user,
        trip_id,
        place_name='Second',
        arrival_date='2026-08-03',
        departure_date='2026-08-04',
        after_planned_step_id=first['id'],
    )

    move_response = client.post(
        f'{api_prefix}/trips/{trip_id}/planned-steps/{second["id"]}/move',
        headers=_auth_headers(user),
        json={'after_planned_step_id': None},
    )
    list_response = client.get(
        f'{api_prefix}/trips/{trip_id}/planned-steps',
        headers=_auth_headers(user),
    )

    assert move_response.status_code == 200
    assert list_response.status_code == 200
    assert [step['id'] for step in list_response.json()] == [second['id'], first['id']]


@pytest.mark.integration
def test_planned_travel_rejects_cross_trip_steps(
    client,
    db_session,
    api_prefix,
) -> None:
    user = create_user(db_session, password='TripsPass123!')
    first_trip_id = _create_trip(client, db_session, api_prefix, user, name='First')
    second_trip_id = _create_trip(client, db_session, api_prefix, user, name='Second')
    first_step = _create_step(
        client,
        db_session,
        api_prefix,
        user,
        first_trip_id,
        place_name='Amsterdam',
        arrival_date='2026-08-01',
        departure_date='2026-08-02',
    )
    second_step = _create_step(
        client,
        db_session,
        api_prefix,
        user,
        second_trip_id,
        place_name='Rotterdam',
        arrival_date='2026-08-03',
        departure_date='2026-08-04',
    )

    response = client.post(
        f'{api_prefix}/trips/{first_trip_id}/planned-travel',
        headers=_auth_headers(user),
        json={
            'from_planned_step_id': first_step['id'],
            'to_planned_step_id': second_step['id'],
            'travel_mode': 'TRAIN',
            'notes': 'Invalid cross-trip connection',
        },
    )

    assert response.status_code == 422


@pytest.mark.integration
def test_planned_travel_is_ordered_by_from_step(
    client,
    db_session,
    api_prefix,
) -> None:
    user = create_user(db_session, password='TripsPass123!')
    trip_id = _create_trip(client, db_session, api_prefix, user)
    first = _create_step(
        client,
        db_session,
        api_prefix,
        user,
        trip_id,
        place_name='First',
        arrival_date='2026-08-01',
        departure_date='2026-08-02',
    )
    second = _create_step(
        client,
        db_session,
        api_prefix,
        user,
        trip_id,
        place_name='Second',
        arrival_date='2026-08-03',
        departure_date='2026-08-04',
        after_planned_step_id=first['id'],
    )
    third = _create_step(
        client,
        db_session,
        api_prefix,
        user,
        trip_id,
        place_name='Third',
        arrival_date='2026-08-05',
        departure_date='2026-08-06',
        after_planned_step_id=second['id'],
    )

    second_travel_response = client.post(
        f'{api_prefix}/trips/{trip_id}/planned-travel',
        headers=_auth_headers(user),
        json={
            'from_planned_step_id': second['id'],
            'to_planned_step_id': third['id'],
            'travel_mode': 'BUS',
            'notes': '',
        },
    )
    first_travel_response = client.post(
        f'{api_prefix}/trips/{trip_id}/planned-travel',
        headers=_auth_headers(user),
        json={
            'from_planned_step_id': first['id'],
            'to_planned_step_id': second['id'],
            'travel_mode': 'TRAIN',
            'notes': '',
        },
    )
    list_response = client.get(
        f'{api_prefix}/trips/{trip_id}/planned-travel',
        headers=_auth_headers(user),
    )

    assert second_travel_response.status_code == 201
    assert first_travel_response.status_code == 201
    assert list_response.status_code == 200
    assert [travel['id'] for travel in list_response.json()] == [
        first_travel_response.json()['id'],
        second_travel_response.json()['id'],
    ]


@pytest.mark.integration
def test_viewer_can_read_but_not_manage_itinerary(
    client,
    db_session,
    api_prefix,
) -> None:
    owner = create_user(db_session, password='TripsPass123!')
    viewer = create_user(db_session, password='TripsPass123!')
    trip_id = _create_trip(client, db_session, api_prefix, owner)
    add_trip_member(
        db_session,
        trip_id=uuid.UUID(trip_id),
        user_id=viewer.id,
        role=TripRole.VIEWER,
    )

    list_response = client.get(
        f'{api_prefix}/trips/{trip_id}/planned-steps',
        headers=_auth_headers(viewer),
    )
    place = create_place(db_session, name='Viewer Place')
    create_response = client.post(
        f'{api_prefix}/trips/{trip_id}/planned-steps',
        headers=_auth_headers(viewer),
        json={
            'location': {'place_id': str(place.id)},
            'arrival_date': '2026-08-01',
            'departure_date': '2026-08-02',
            'notes': '',
        },
    )

    assert list_response.status_code == 200
    assert create_response.status_code == 403


@pytest.mark.integration
def test_public_itinerary_can_be_read_without_auth(
    client,
    db_session,
    api_prefix,
) -> None:
    owner = create_user(db_session, password='TripsPass123!')
    trip_id = _create_trip(
        client,
        db_session,
        api_prefix,
        owner,
        visibility=TripVisibility.PUBLIC,
    )
    planned_step = _create_step(
        client,
        db_session,
        api_prefix,
        owner,
        trip_id,
        place_name='Public Stop',
        arrival_date='2026-08-01',
        departure_date='2026-08-02',
    )

    response = client.get(f'{api_prefix}/trips/{trip_id}/itinerary')

    assert response.status_code == 200
    payload = response.json()
    assert [step['id'] for step in payload['steps']] == [planned_step['id']]
    assert payload['travel'] == []


@pytest.mark.integration
def test_private_itinerary_returns_404_without_auth(
    client,
    db_session,
    api_prefix,
) -> None:
    owner = create_user(db_session, password='TripsPass123!')
    trip_id = _create_trip(client, db_session, api_prefix, owner)

    response = client.get(f'{api_prefix}/trips/{trip_id}/itinerary')

    assert response.status_code == 404


@pytest.mark.integration
def test_private_itinerary_returns_404_for_non_member(
    client,
    db_session,
    api_prefix,
) -> None:
    owner = create_user(db_session, password='TripsPass123!')
    non_member = create_user(db_session, password='TripsPass123!')
    trip_id = _create_trip(client, db_session, api_prefix, owner)

    response = client.get(
        f'{api_prefix}/trips/{trip_id}/itinerary',
        headers=_auth_headers(non_member),
    )

    assert response.status_code == 404
