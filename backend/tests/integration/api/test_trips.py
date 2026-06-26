from __future__ import annotations

import uuid

import pytest

from core import security
from factories.media import create_media
from factories.users import create_user
from models.database.media import MediaStatus
from models.database.trips import TripVisibility


@pytest.mark.integration
def test_create_trip_success(client, db_session, api_prefix) -> None:
    user = create_user(db_session, password='TripsPass123!')
    media = create_media(
        db_session,
        storage_path='media/cover.jpg',
        created_by=user.id,
    )
    tokens = security.create_auth_tokens(subject=user.id, email=user.email)

    response = client.post(
        f'{api_prefix}/trips',
        headers={'Authorization': f'Bearer {tokens["access_token"]}'},
        json={
            'name': 'Kyoto Week',
            'description': 'Temple hopping',
            'media_id': str(media.id),
            'visibility': 'PUBLIC',
        },
    )

    assert response.status_code == 201
    payload = response.json()
    assert payload['id']
    assert payload['name'] == 'Kyoto Week'
    assert payload['cover_media']['id'] == str(media.id)
    assert payload['cover_media']['status'] == 'READY'
    assert (
        payload['cover_media']['urls']['content']
        == f'http://testserver/api/v1/media/{media.id}/content'
    )
    assert (
        payload['cover_media']['urls']['thumbnail']
        == f'http://testserver/api/v1/media/{media.id}/content?thumbnail=true'
    )


@pytest.mark.integration
def test_create_trip_rejects_media_not_owned_by_user(
    client, db_session, api_prefix
) -> None:
    user = create_user(db_session, password='TripsPass123!')
    another_user = create_user(db_session, password='TripsPass123!')
    media = create_media(
        db_session,
        storage_path='media/cover.jpg',
        created_by=another_user.id,
    )
    tokens = security.create_auth_tokens(subject=user.id, email=user.email)

    response = client.post(
        f'{api_prefix}/trips',
        headers={'Authorization': f'Bearer {tokens["access_token"]}'},
        json={
            'name': 'Kyoto Week',
            'description': 'Temple hopping',
            'media_id': str(media.id),
        },
    )

    assert response.status_code == 403


@pytest.mark.integration
def test_create_trip_allows_uploaded_cover_media(
    client, db_session, api_prefix
) -> None:
    user = create_user(db_session, password='TripsPass123!')
    media = create_media(
        db_session,
        storage_path='media/uploading-cover.jpg',
        has_thumbnail=False,
        thumbnail_content_type=None,
        status=MediaStatus.UPLOADED,
        created_by=user.id,
    )
    tokens = security.create_auth_tokens(subject=user.id, email=user.email)

    response = client.post(
        f'{api_prefix}/trips',
        headers={'Authorization': f'Bearer {tokens["access_token"]}'},
        json={
            'name': 'Processing Cover',
            'description': 'Still processing',
            'media_id': str(media.id),
        },
    )

    assert response.status_code == 201
    payload = response.json()
    assert payload['cover_media']['id'] == str(media.id)
    assert payload['cover_media']['status'] == 'UPLOADED'
    assert payload['cover_media']['urls']['thumbnail'] is None


@pytest.mark.integration
def test_create_trip_rejects_cover_media_already_used(
    client, db_session, api_prefix
) -> None:
    user = create_user(db_session, password='TripsPass123!')
    media = create_media(
        db_session,
        storage_path='media/shared-cover.jpg',
        created_by=user.id,
    )
    tokens = security.create_auth_tokens(subject=user.id, email=user.email)
    headers = {'Authorization': f'Bearer {tokens["access_token"]}'}

    first_response = client.post(
        f'{api_prefix}/trips',
        headers=headers,
        json={
            'name': 'First Trip',
            'description': '',
            'media_id': str(media.id),
        },
    )
    second_response = client.post(
        f'{api_prefix}/trips',
        headers=headers,
        json={
            'name': 'Second Trip',
            'description': '',
            'media_id': str(media.id),
        },
    )

    assert first_response.status_code == 201
    assert second_response.status_code == 409


@pytest.mark.integration
def test_list_trips_returns_current_user_memberships(
    client, db_session, api_prefix
) -> None:
    user = create_user(db_session, password='TripsPass123!')
    another_user = create_user(db_session, password='TripsPass123!')
    tokens = security.create_auth_tokens(subject=user.id, email=user.email)
    another_tokens = security.create_auth_tokens(
        subject=another_user.id,
        email=another_user.email,
    )
    headers = {'Authorization': f'Bearer {tokens["access_token"]}'}
    another_headers = {'Authorization': f'Bearer {another_tokens["access_token"]}'}

    user_media = create_media(
        db_session,
        storage_path='media/user-trip-cover.jpg',
        created_by=user.id,
    )
    second_user_media = create_media(
        db_session,
        storage_path='media/user-trip-cover-2.jpg',
        created_by=user.id,
    )
    another_user_media = create_media(
        db_session,
        storage_path='media/another-user-trip-cover.jpg',
        created_by=another_user.id,
    )

    first_response = client.post(
        f'{api_prefix}/trips',
        headers=headers,
        json={
            'name': 'Current User First',
            'description': 'One',
            'media_id': str(user_media.id),
        },
    )
    second_response = client.post(
        f'{api_prefix}/trips',
        headers=headers,
        json={
            'name': 'Current User Second',
            'description': 'Two',
            'media_id': str(second_user_media.id),
            'visibility': TripVisibility.PUBLIC.value,
        },
    )
    other_response = client.post(
        f'{api_prefix}/trips',
        headers=another_headers,
        json={
            'name': 'Another User Public',
            'description': 'Should not be listed',
            'media_id': str(another_user_media.id),
            'visibility': TripVisibility.PUBLIC.value,
        },
    )

    response = client.get(f'{api_prefix}/trips', headers=headers)

    assert first_response.status_code == 201
    assert second_response.status_code == 201
    assert other_response.status_code == 201
    assert response.status_code == 200
    payload = response.json()
    assert payload['total'] == 2
    assert payload['page'] == 1
    assert payload['page_size'] == 20
    assert {trip['id'] for trip in payload['items']} == {
        first_response.json()['id'],
        second_response.json()['id'],
    }
    assert {trip['name'] for trip in payload['items']} == {
        'Current User First',
        'Current User Second',
    }
    assert all(trip['cover_media'] for trip in payload['items'])


@pytest.mark.integration
def test_list_trips_supports_pagination_and_sorting(
    client, db_session, api_prefix
) -> None:
    user = create_user(db_session, password='TripsPass123!')
    tokens = security.create_auth_tokens(subject=user.id, email=user.email)
    headers = {'Authorization': f'Bearer {tokens["access_token"]}'}

    trip_names = ['Zagreb', 'Amsterdam', 'Berlin']
    for index, name in enumerate(trip_names):
        media = create_media(
            db_session,
            storage_path=f'media/{name.lower()}-cover.jpg',
            created_by=user.id,
        )
        response = client.post(
            f'{api_prefix}/trips',
            headers=headers,
            json={
                'name': name,
                'description': f'Trip {index}',
                'media_id': str(media.id),
            },
        )
        assert response.status_code == 201

    response = client.get(
        f'{api_prefix}/trips?page=2&page_size=1&sort_by=name&sort_order=asc',
        headers=headers,
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload['total'] == 3
    assert payload['page'] == 2
    assert payload['page_size'] == 1
    assert [trip['name'] for trip in payload['items']] == ['Berlin']


@pytest.mark.integration
def test_get_public_trip_by_id_returns_trip_without_auth(
    client, db_session, api_prefix
) -> None:
    user = create_user(db_session, password='TripsPass123!')
    media = create_media(
        db_session,
        storage_path='media/cover.jpg',
        created_by=user.id,
    )
    tokens = security.create_auth_tokens(subject=user.id, email=user.email)

    create_response = client.post(
        f'{api_prefix}/trips',
        headers={'Authorization': f'Bearer {tokens["access_token"]}'},
        json={
            'name': 'Nordic Escape',
            'description': 'Fjords and coffee',
            'media_id': str(media.id),
            'visibility': TripVisibility.PUBLIC.value,
        },
    )
    trip_id = create_response.json()['id']

    response = client.get(f'{api_prefix}/trips/{trip_id}')

    assert response.status_code == 200
    payload = response.json()
    assert payload['id'] == trip_id
    assert payload['cover_media']['id'] == str(media.id)


@pytest.mark.integration
def test_get_private_trip_by_id_returns_trip_for_member(
    client, db_session, api_prefix
) -> None:
    user = create_user(db_session, password='TripsPass123!')
    media = create_media(
        db_session,
        storage_path='media/private-cover.jpg',
        created_by=user.id,
    )
    tokens = security.create_auth_tokens(subject=user.id, email=user.email)

    create_response = client.post(
        f'{api_prefix}/trips',
        headers={'Authorization': f'Bearer {tokens["access_token"]}'},
        json={
            'name': 'Private Escape',
            'description': 'Members only',
            'media_id': str(media.id),
        },
    )
    trip_id = create_response.json()['id']

    response = client.get(
        f'{api_prefix}/trips/{trip_id}',
        headers={'Authorization': f'Bearer {tokens["access_token"]}'},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload['id'] == trip_id
    assert payload['cover_media']['id'] == str(media.id)


@pytest.mark.integration
def test_get_private_trip_by_id_returns_404_without_auth(
    client, db_session, api_prefix
) -> None:
    user = create_user(db_session, password='TripsPass123!')
    media = create_media(
        db_session,
        storage_path='media/anonymous-private-cover.jpg',
        created_by=user.id,
    )
    tokens = security.create_auth_tokens(subject=user.id, email=user.email)

    create_response = client.post(
        f'{api_prefix}/trips',
        headers={'Authorization': f'Bearer {tokens["access_token"]}'},
        json={
            'name': 'Anonymous Hidden',
            'description': 'Members only',
            'media_id': str(media.id),
        },
    )
    trip_id = create_response.json()['id']

    response = client.get(f'{api_prefix}/trips/{trip_id}')

    assert response.status_code == 404


@pytest.mark.integration
def test_get_private_trip_by_id_returns_404_for_non_member(
    client, db_session, api_prefix
) -> None:
    user = create_user(db_session, password='TripsPass123!')
    another_user = create_user(db_session, password='TripsPass123!')
    media = create_media(
        db_session,
        storage_path='media/non-member-private-cover.jpg',
        created_by=user.id,
    )
    tokens = security.create_auth_tokens(subject=user.id, email=user.email)
    another_tokens = security.create_auth_tokens(
        subject=another_user.id,
        email=another_user.email,
    )

    create_response = client.post(
        f'{api_prefix}/trips',
        headers={'Authorization': f'Bearer {tokens["access_token"]}'},
        json={
            'name': 'Non Member Hidden',
            'description': 'Members only',
            'media_id': str(media.id),
        },
    )
    trip_id = create_response.json()['id']

    response = client.get(
        f'{api_prefix}/trips/{trip_id}',
        headers={'Authorization': f'Bearer {another_tokens["access_token"]}'},
    )

    assert response.status_code == 404


@pytest.mark.integration
def test_get_trip_returns_404_when_missing(client, api_prefix) -> None:
    response = client.get(f'{api_prefix}/trips/{uuid.uuid4()}')
    assert response.status_code == 404
