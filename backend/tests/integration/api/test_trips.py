from __future__ import annotations

import uuid

import pytest

from core import security
from factories.media import create_media
from factories.users import create_user


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
        },
    )

    assert response.status_code == 201
    payload = response.json()
    assert payload['id']
    assert payload['name'] == 'Kyoto Week'
    assert payload['cover_media']['id'] == str(media.id)
    assert payload['cover_media']['urls']['content'] == f'http://testserver/{media.id}'
    assert (
        payload['cover_media']['urls']['thumbnail']
        == f'http://testserver/{media.id}?thumbnail=true'
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
def test_get_trip_by_id_returns_trip(client, db_session, api_prefix) -> None:
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
        },
    )
    trip_id = create_response.json()['id']

    response = client.get(f'{api_prefix}/trips/{trip_id}')

    assert response.status_code == 200
    payload = response.json()
    assert payload['id'] == trip_id
    assert payload['cover_media']['id'] == str(media.id)


@pytest.mark.integration
def test_get_trip_returns_404_when_missing(client, api_prefix) -> None:
    response = client.get(f'{api_prefix}/trips/{uuid.uuid4()}')
    assert response.status_code == 404
