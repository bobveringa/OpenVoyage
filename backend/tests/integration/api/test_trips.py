from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

import pytest

from core import security
from factories.media import create_media
from factories.users import create_user
from models.database.media import MediaStatus
from models.database.trips import TripRole, TripVisibility


TRIP_START_DATE = '2026-07-01'


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
            'start_date': TRIP_START_DATE,
            'visibility': visibility.value,
        },
    )
    assert response.status_code == 201
    return response.json()['id']


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
            'start_date': TRIP_START_DATE,
            'visibility': 'PUBLIC',
        },
    )

    assert response.status_code == 201
    payload = response.json()
    assert payload['id']
    assert payload['name'] == 'Kyoto Week'
    assert payload['start_date'] == TRIP_START_DATE
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
def test_create_trip_requires_start_date(client, db_session, api_prefix) -> None:
    user = create_user(db_session, password='TripsPass123!')
    media = create_media(
        db_session,
        storage_path='media/missing-start-date-cover.jpg',
        created_by=user.id,
    )

    response = client.post(
        f'{api_prefix}/trips',
        headers=_auth_headers(user),
        json={
            'name': 'No Date',
            'description': '',
            'media_id': str(media.id),
        },
    )

    assert response.status_code == 422


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
            'start_date': TRIP_START_DATE,
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
            'start_date': TRIP_START_DATE,
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
            'start_date': TRIP_START_DATE,
        },
    )
    second_response = client.post(
        f'{api_prefix}/trips',
        headers=headers,
        json={
            'name': 'Second Trip',
            'description': '',
            'media_id': str(media.id),
            'start_date': TRIP_START_DATE,
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
            'start_date': TRIP_START_DATE,
        },
    )
    second_response = client.post(
        f'{api_prefix}/trips',
        headers=headers,
        json={
            'name': 'Current User Second',
            'description': 'Two',
            'media_id': str(second_user_media.id),
            'start_date': TRIP_START_DATE,
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
            'start_date': TRIP_START_DATE,
            'visibility': TripVisibility.PUBLIC.value,
        },
    )
    viewer_response = client.post(
        f'{api_prefix}/trips/{other_response.json()["id"]}/viewers',
        headers=another_headers,
        json={
            'user_id': str(user.id),
        },
    )

    response = client.get(f'{api_prefix}/trips', headers=headers)

    assert first_response.status_code == 201
    assert second_response.status_code == 201
    assert other_response.status_code == 201
    assert viewer_response.status_code == 201
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
def test_list_trips_requires_auth_when_no_user_id(client, api_prefix) -> None:
    response = client.get(f'{api_prefix}/trips')

    assert response.status_code == 401


@pytest.mark.integration
def test_list_trips_for_user_filters_by_role_and_requester_access(
    client, db_session, api_prefix
) -> None:
    profile_user = create_user(db_session, password='TripsPass123!')
    viewer = create_user(db_session, password='TripsPass123!')
    outsider = create_user(db_session, password='TripsPass123!')
    other_owner = create_user(db_session, password='TripsPass123!')

    profile_public_id = _create_trip(
        client,
        db_session,
        api_prefix,
        profile_user,
        name='Profile Public',
        visibility=TripVisibility.PUBLIC,
    )
    profile_private_id = _create_trip(
        client,
        db_session,
        api_prefix,
        profile_user,
        name='Profile Private',
    )
    viewer_only_id = _create_trip(
        client,
        db_session,
        api_prefix,
        other_owner,
        name='Viewer Only Public',
        visibility=TripVisibility.PUBLIC,
    )

    add_viewer_to_private_response = client.post(
        f'{api_prefix}/trips/{profile_private_id}/viewers',
        headers=_auth_headers(profile_user),
        json={
            'user_id': str(viewer.id),
        },
    )
    add_profile_user_as_viewer_response = client.post(
        f'{api_prefix}/trips/{viewer_only_id}/viewers',
        headers=_auth_headers(other_owner),
        json={
            'user_id': str(profile_user.id),
        },
    )

    viewer_response = client.get(
        f'{api_prefix}/trips?user_id={profile_user.id}',
        headers=_auth_headers(viewer),
    )
    outsider_response = client.get(
        f'{api_prefix}/trips?user_id={profile_user.id}',
        headers=_auth_headers(outsider),
    )
    anonymous_response = client.get(f'{api_prefix}/trips?user_id={profile_user.id}')

    assert add_viewer_to_private_response.status_code == 201
    assert add_profile_user_as_viewer_response.status_code == 201
    assert viewer_response.status_code == 200
    assert outsider_response.status_code == 200
    assert anonymous_response.status_code == 200
    assert {trip['id'] for trip in viewer_response.json()['items']} == {
        profile_public_id,
        profile_private_id,
    }
    assert {trip['id'] for trip in outsider_response.json()['items']} == {
        profile_public_id,
    }
    assert {trip['id'] for trip in anonymous_response.json()['items']} == {
        profile_public_id,
    }


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
                'start_date': TRIP_START_DATE,
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
def test_trip_owner_can_update_trip(client, db_session, api_prefix) -> None:
    owner = create_user(db_session, password='TripsPass123!')
    trip_id = _create_trip(client, db_session, api_prefix, owner)
    new_cover_media = create_media(
        db_session,
        storage_path='media/new-cover.jpg',
        created_by=owner.id,
    )

    response = client.patch(
        f'{api_prefix}/trips/{trip_id}',
        headers=_auth_headers(owner),
        json={
            'name': 'Updated Trip',
            'description': 'Updated description',
            'visibility': TripVisibility.PUBLIC.value,
            'media_id': str(new_cover_media.id),
        },
    )
    public_response = client.get(f'{api_prefix}/trips/{trip_id}')

    assert response.status_code == 200
    payload = response.json()
    assert payload['id'] == trip_id
    assert payload['name'] == 'Updated Trip'
    assert payload['description'] == 'Updated description'
    assert payload['cover_media']['id'] == str(new_cover_media.id)
    assert public_response.status_code == 200


@pytest.mark.integration
def test_trip_update_rejects_null_start_date(client, db_session, api_prefix) -> None:
    owner = create_user(db_session, password='TripsPass123!')
    trip_id = _create_trip(client, db_session, api_prefix, owner)

    response = client.patch(
        f'{api_prefix}/trips/{trip_id}',
        headers=_auth_headers(owner),
        json={'start_date': None},
    )

    assert response.status_code == 422


@pytest.mark.integration
def test_trip_update_requires_owner(client, db_session, api_prefix) -> None:
    owner = create_user(db_session, password='TripsPass123!')
    member = create_user(db_session, password='TripsPass123!')
    non_member = create_user(db_session, password='TripsPass123!')
    trip_id = _create_trip(client, db_session, api_prefix, owner)
    owner_headers = _auth_headers(owner)

    add_member_response = client.post(
        f'{api_prefix}/trips/{trip_id}/members',
        headers=owner_headers,
        json={
            'user_id': str(member.id),
            'role': TripRole.MEMBER.value,
        },
    )
    member_response = client.patch(
        f'{api_prefix}/trips/{trip_id}',
        headers=_auth_headers(member),
        json={'name': 'Member Update'},
    )
    non_member_response = client.patch(
        f'{api_prefix}/trips/{trip_id}',
        headers=_auth_headers(non_member),
        json={'name': 'Non Member Update'},
    )

    assert add_member_response.status_code == 201
    assert member_response.status_code == 403
    assert non_member_response.status_code == 404


@pytest.mark.integration
def test_trip_update_validates_cover_media(client, db_session, api_prefix) -> None:
    owner = create_user(db_session, password='TripsPass123!')
    another_owner = create_user(db_session, password='TripsPass123!')
    trip_id = _create_trip(client, db_session, api_prefix, owner)
    other_trip_id = _create_trip(client, db_session, api_prefix, owner)
    other_user_media = create_media(
        db_session,
        storage_path='media/other-user-cover.jpg',
        created_by=another_owner.id,
    )
    owner_media_used_by_another_trip = create_media(
        db_session,
        storage_path='media/already-used-cover.jpg',
        created_by=owner.id,
    )
    owner_headers = _auth_headers(owner)

    missing_response = client.patch(
        f'{api_prefix}/trips/{trip_id}',
        headers=owner_headers,
        json={'media_id': str(uuid.uuid4())},
    )
    ownership_response = client.patch(
        f'{api_prefix}/trips/{trip_id}',
        headers=owner_headers,
        json={'media_id': str(other_user_media.id)},
    )
    other_owner_update_response = client.patch(
        f'{api_prefix}/trips/{other_trip_id}',
        headers=owner_headers,
        json={'media_id': str(owner_media_used_by_another_trip.id)},
    )
    already_used_response = client.patch(
        f'{api_prefix}/trips/{trip_id}',
        headers=owner_headers,
        json={'media_id': str(owner_media_used_by_another_trip.id)},
    )

    assert missing_response.status_code == 404
    assert ownership_response.status_code == 403
    assert other_owner_update_response.status_code == 200
    assert already_used_response.status_code == 409


@pytest.mark.integration
def test_trip_owner_can_delete_trip(client, db_session, api_prefix) -> None:
    owner = create_user(db_session, password='TripsPass123!')
    trip_id = _create_trip(client, db_session, api_prefix, owner)

    delete_response = client.delete(
        f'{api_prefix}/trips/{trip_id}',
        headers=_auth_headers(owner),
    )
    get_response = client.get(
        f'{api_prefix}/trips/{trip_id}',
        headers=_auth_headers(owner),
    )

    assert delete_response.status_code == 204
    assert get_response.status_code == 404


@pytest.mark.integration
def test_trip_delete_requires_owner(client, db_session, api_prefix) -> None:
    owner = create_user(db_session, password='TripsPass123!')
    member = create_user(db_session, password='TripsPass123!')
    non_member = create_user(db_session, password='TripsPass123!')
    trip_id = _create_trip(client, db_session, api_prefix, owner)
    owner_headers = _auth_headers(owner)

    add_member_response = client.post(
        f'{api_prefix}/trips/{trip_id}/members',
        headers=owner_headers,
        json={
            'user_id': str(member.id),
            'role': TripRole.MEMBER.value,
        },
    )
    member_response = client.delete(
        f'{api_prefix}/trips/{trip_id}',
        headers=_auth_headers(member),
    )
    non_member_response = client.delete(
        f'{api_prefix}/trips/{trip_id}',
        headers=_auth_headers(non_member),
    )

    assert add_member_response.status_code == 201
    assert member_response.status_code == 403
    assert non_member_response.status_code == 404


@pytest.mark.integration
def test_trip_owner_can_manage_members(client, db_session, api_prefix) -> None:
    owner = create_user(
        db_session,
        password='TripsPass123!',
        email='owner@example.com',
        username='owner',
        first_name='Trip',
        last_name='Owner',
    )
    member = create_user(
        db_session,
        email='member@example.com',
        username='member',
        first_name='Trip',
        last_name='Member',
    )
    trip_id = _create_trip(client, db_session, api_prefix, owner)
    owner_headers = _auth_headers(owner)

    add_response = client.post(
        f'{api_prefix}/trips/{trip_id}/members',
        headers=owner_headers,
        json={
            'user_id': str(member.id),
            'role': TripRole.MEMBER.value,
        },
    )
    list_response = client.get(
        f'{api_prefix}/trips/{trip_id}/members',
        headers=owner_headers,
    )
    update_response = client.patch(
        f'{api_prefix}/trips/{trip_id}/members/{member.id}',
        headers=owner_headers,
        json={'role': TripRole.OWNER.value},
    )
    delete_response = client.delete(
        f'{api_prefix}/trips/{trip_id}/members/{member.id}',
        headers=owner_headers,
    )
    final_list_response = client.get(
        f'{api_prefix}/trips/{trip_id}/members',
        headers=owner_headers,
    )

    assert add_response.status_code == 201
    added_member = add_response.json()
    assert added_member['user_id'] == str(member.id)
    assert added_member['role'] == TripRole.MEMBER.value
    assert 'email' not in added_member['user']
    assert added_member['user']['first_name'] == 'Trip'

    assert list_response.status_code == 200
    assert {item['user_id'] for item in list_response.json()} == {
        str(owner.id),
        str(member.id),
    }

    assert update_response.status_code == 200
    assert update_response.json()['role'] == TripRole.OWNER.value

    assert delete_response.status_code == 204
    assert final_list_response.status_code == 200
    assert [item['user_id'] for item in final_list_response.json()] == [str(owner.id)]


@pytest.mark.integration
def test_trip_owner_can_manage_direct_viewers(
    client, db_session, api_prefix
) -> None:
    owner = create_user(db_session, password='TripsPass123!')
    viewer = create_user(db_session, password='TripsPass123!')
    member = create_user(db_session, password='TripsPass123!')
    trip_id = _create_trip(client, db_session, api_prefix, owner)
    owner_headers = _auth_headers(owner)
    viewer_headers = _auth_headers(viewer)

    add_member_response = client.post(
        f'{api_prefix}/trips/{trip_id}/members',
        headers=owner_headers,
        json={
            'user_id': str(member.id),
            'role': TripRole.MEMBER.value,
        },
    )
    add_viewer_response = client.post(
        f'{api_prefix}/trips/{trip_id}/viewers',
        headers=owner_headers,
        json={'user_id': str(viewer.id)},
    )
    list_viewers_response = client.get(
        f'{api_prefix}/trips/{trip_id}/viewers',
        headers=owner_headers,
    )
    read_trip_response = client.get(
        f'{api_prefix}/trips/{trip_id}',
        headers=viewer_headers,
    )
    list_members_response = client.get(
        f'{api_prefix}/trips/{trip_id}/members',
        headers=viewer_headers,
    )
    own_list_response = client.get(f'{api_prefix}/trips', headers=viewer_headers)
    member_add_viewer_response = client.post(
        f'{api_prefix}/trips/{trip_id}/viewers',
        headers=_auth_headers(member),
        json={'user_id': str(uuid.uuid4())},
    )
    remove_viewer_response = client.delete(
        f'{api_prefix}/trips/{trip_id}/viewers/{viewer.id}',
        headers=owner_headers,
    )
    read_after_remove_response = client.get(
        f'{api_prefix}/trips/{trip_id}',
        headers=viewer_headers,
    )

    assert add_member_response.status_code == 201
    assert add_viewer_response.status_code == 201
    assert add_viewer_response.json()['user_id'] == str(viewer.id)
    assert list_viewers_response.status_code == 200
    assert [item['user_id'] for item in list_viewers_response.json()] == [
        str(viewer.id)
    ]
    assert read_trip_response.status_code == 200
    assert list_members_response.status_code == 200
    assert {item['user_id'] for item in list_members_response.json()} == {
        str(owner.id),
        str(member.id),
    }
    assert own_list_response.status_code == 200
    assert own_list_response.json()['items'] == []
    assert member_add_viewer_response.status_code == 403
    assert remove_viewer_response.status_code == 204
    assert read_after_remove_response.status_code == 404


@pytest.mark.integration
def test_trip_member_can_list_but_not_add_members(
    client, db_session, api_prefix
) -> None:
    owner = create_user(db_session, password='TripsPass123!')
    member = create_user(db_session, password='TripsPass123!')
    another_user = create_user(db_session)
    trip_id = _create_trip(client, db_session, api_prefix, owner)
    owner_headers = _auth_headers(owner)
    member_headers = _auth_headers(member)

    add_member_response = client.post(
        f'{api_prefix}/trips/{trip_id}/members',
        headers=owner_headers,
        json={
            'user_id': str(member.id),
            'role': TripRole.MEMBER.value,
        },
    )

    list_response = client.get(
        f'{api_prefix}/trips/{trip_id}/members',
        headers=member_headers,
    )
    add_response = client.post(
        f'{api_prefix}/trips/{trip_id}/members',
        headers=member_headers,
        json={
            'user_id': str(another_user.id),
            'role': TripRole.MEMBER.value,
        },
    )

    assert add_member_response.status_code == 201
    assert list_response.status_code == 200
    assert {item['user_id'] for item in list_response.json()} == {
        str(owner.id),
        str(member.id),
    }
    assert add_response.status_code == 403


@pytest.mark.integration
def test_trip_non_member_cannot_list_members(client, db_session, api_prefix) -> None:
    owner = create_user(db_session, password='TripsPass123!')
    non_member = create_user(db_session, password='TripsPass123!')
    trip_id = _create_trip(client, db_session, api_prefix, owner)

    response = client.get(
        f'{api_prefix}/trips/{trip_id}/members',
        headers=_auth_headers(non_member),
    )

    assert response.status_code == 404


@pytest.mark.integration
def test_add_trip_member_rejects_duplicate_and_missing_user(
    client, db_session, api_prefix
) -> None:
    owner = create_user(db_session, password='TripsPass123!')
    member = create_user(db_session)
    trip_id = _create_trip(client, db_session, api_prefix, owner)
    owner_headers = _auth_headers(owner)

    first_response = client.post(
        f'{api_prefix}/trips/{trip_id}/members',
        headers=owner_headers,
        json={
            'user_id': str(member.id),
            'role': TripRole.MEMBER.value,
        },
    )
    duplicate_response = client.post(
        f'{api_prefix}/trips/{trip_id}/members',
        headers=owner_headers,
        json={
            'user_id': str(member.id),
            'role': TripRole.MEMBER.value,
        },
    )
    missing_user_response = client.post(
        f'{api_prefix}/trips/{trip_id}/members',
        headers=owner_headers,
        json={
            'user_id': str(uuid.uuid4()),
            'role': TripRole.MEMBER.value,
        },
    )

    assert first_response.status_code == 201
    assert duplicate_response.status_code == 409
    assert missing_user_response.status_code == 404


@pytest.mark.integration
def test_trip_owner_cannot_remove_or_demote_last_owner(
    client, db_session, api_prefix
) -> None:
    owner = create_user(db_session, password='TripsPass123!')
    trip_id = _create_trip(client, db_session, api_prefix, owner)
    owner_headers = _auth_headers(owner)

    demote_response = client.patch(
        f'{api_prefix}/trips/{trip_id}/members/{owner.id}',
        headers=owner_headers,
        json={'role': TripRole.MEMBER.value},
    )
    delete_response = client.delete(
        f'{api_prefix}/trips/{trip_id}/members/{owner.id}',
        headers=owner_headers,
    )

    assert demote_response.status_code == 409
    assert delete_response.status_code == 409


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
            'start_date': TRIP_START_DATE,
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
            'start_date': TRIP_START_DATE,
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
def test_share_link_allows_private_trip_read_and_member_list(
    client, db_session, api_prefix
) -> None:
    owner = create_user(db_session, password='TripsPass123!')
    media = create_media(
        db_session,
        storage_path='media/share-link-cover.jpg',
        created_by=owner.id,
    )
    owner_headers = _auth_headers(owner)

    create_trip_response = client.post(
        f'{api_prefix}/trips',
        headers=owner_headers,
        json={
            'name': 'Shared Private',
            'description': 'Invite only',
            'media_id': str(media.id),
            'start_date': TRIP_START_DATE,
        },
    )
    trip_id = create_trip_response.json()['id']

    create_link_response = client.post(
        f'{api_prefix}/trips/{trip_id}/share-links',
        headers=owner_headers,
        json={'label': 'Family'},
    )
    token = create_link_response.json()['token']
    share_headers = {'X-Trip-Share-Token': token}

    list_links_response = client.get(
        f'{api_prefix}/trips/{trip_id}/share-links',
        headers=owner_headers,
    )
    read_trip_response = client.get(
        f'{api_prefix}/trips/{trip_id}',
        headers=share_headers,
    )
    list_members_response = client.get(
        f'{api_prefix}/trips/{trip_id}/members',
        headers=share_headers,
    )
    revoke_response = client.delete(
        f'{api_prefix}/trips/{trip_id}/share-links/{create_link_response.json()["id"]}',
        headers=owner_headers,
    )
    read_after_revoke_response = client.get(
        f'{api_prefix}/trips/{trip_id}',
        headers=share_headers,
    )

    assert create_trip_response.status_code == 201
    assert create_link_response.status_code == 201
    assert create_link_response.json()['label'] == 'Family'
    assert token
    assert list_links_response.status_code == 200
    assert 'token' not in list_links_response.json()[0]
    assert read_trip_response.status_code == 200
    assert read_trip_response.json()['id'] == trip_id
    assert list_members_response.status_code == 200
    assert [item['user_id'] for item in list_members_response.json()] == [
        str(owner.id)
    ]
    assert revoke_response.status_code == 204
    assert read_after_revoke_response.status_code == 404


@pytest.mark.integration
def test_expired_share_link_does_not_allow_trip_read(
    client, db_session, api_prefix
) -> None:
    owner = create_user(db_session, password='TripsPass123!')
    trip_id = _create_trip(client, db_session, api_prefix, owner)
    expired_at = datetime.now(timezone.utc) - timedelta(days=1)

    create_link_response = client.post(
        f'{api_prefix}/trips/{trip_id}/share-links',
        headers=_auth_headers(owner),
        json={'expires_at': expired_at.isoformat()},
    )
    token = create_link_response.json()['token']

    response = client.get(
        f'{api_prefix}/trips/{trip_id}',
        headers={'X-Trip-Share-Token': token},
    )

    assert create_link_response.status_code == 201
    assert response.status_code == 404


@pytest.mark.integration
def test_platform_public_trip_requires_authenticated_reader(
    client, db_session, api_prefix
) -> None:
    owner = create_user(db_session, password='TripsPass123!')
    reader = create_user(db_session, password='TripsPass123!')
    trip_id = _create_trip(
        client,
        db_session,
        api_prefix,
        owner,
        name='Platform Public',
        visibility=TripVisibility.PLATFORM_PUBLIC,
    )

    anonymous_response = client.get(f'{api_prefix}/trips/{trip_id}')
    reader_response = client.get(
        f'{api_prefix}/trips/{trip_id}',
        headers=_auth_headers(reader),
    )

    assert anonymous_response.status_code == 404
    assert reader_response.status_code == 200
    assert reader_response.json()['id'] == trip_id


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
            'start_date': TRIP_START_DATE,
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
            'start_date': TRIP_START_DATE,
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
