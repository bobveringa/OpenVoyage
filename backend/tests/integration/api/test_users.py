from __future__ import annotations

import pytest

from core import security
from factories.media import create_media
from factories.users import create_user
from models.database.media import MediaType
from models.database.user import UserRole


def _auth_headers(user) -> dict[str, str]:
    tokens = security.create_auth_tokens(subject=user.id, email=user.email)
    return {'Authorization': f'Bearer {tokens["access_token"]}'}


@pytest.mark.integration
def test_search_users_requires_auth(client, api_prefix) -> None:
    response = client.get(f'{api_prefix}/users?query=bo')

    assert response.status_code == 401


@pytest.mark.integration
def test_search_users_matches_email_and_profile_fields(
    client, db_session, api_prefix
) -> None:
    current_user = create_user(
        db_session,
        email='current@example.com',
        password='UsersPass123!',
        username='current',
        first_name='Current',
        last_name='User',
    )
    email_match = create_user(
        db_session,
        email='bob@example.com',
        username='unrelated',
        first_name='Robert',
        last_name='Example',
    )
    avatar = create_media(
        db_session,
        storage_path='media/search-avatar.jpg',
        created_by=email_match.id,
    )
    email_match.profile.profile_picture_media_id = avatar.id
    db_session.commit()
    first_name_match = create_user(
        db_session,
        email='alice@example.com',
        username='alice',
        first_name='Bobby',
        last_name='Example',
    )
    username_match = create_user(
        db_session,
        email='charlie@example.com',
        username='bobcat',
        first_name='Charlie',
        last_name='Example',
    )
    create_user(
        db_session,
        email='dana@example.com',
        username='dana',
        first_name='Dana',
        last_name='Example',
    )
    tokens = security.create_auth_tokens(
        subject=current_user.id,
        email=current_user.email,
    )

    response = client.get(
        f'{api_prefix}/users?query=bob@example.com',
        headers={'Authorization': f'Bearer {tokens["access_token"]}'},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload['total'] == 1
    assert payload['page'] == 1
    assert payload['page_size'] == 20
    assert [user['id'] for user in payload['items']] == [str(email_match.id)]
    assert all('email' not in user for user in payload['items'])
    assert payload['items'][0]['profile_picture']['id'] == str(avatar.id)

    partial_response = client.get(
        f'{api_prefix}/users?query=bob',
        headers={'Authorization': f'Bearer {tokens["access_token"]}'},
    )

    assert partial_response.status_code == 200
    partial_payload = partial_response.json()
    assert partial_payload['total'] == 2
    assert {user['id'] for user in partial_payload['items']} == {
        str(first_name_match.id),
        str(username_match.id),
    }


@pytest.mark.integration
def test_search_users_does_not_match_partial_email(
    client, db_session, api_prefix
) -> None:
    current_user = create_user(
        db_session,
        email='current@example.com',
        password='UsersPass123!',
    )
    create_user(
        db_session,
        email='hidden-address@example.com',
        username='traveler',
        first_name='Alice',
        last_name='Example',
    )

    response = client.get(
        f'{api_prefix}/users?query=hidden-address',
        headers=_auth_headers(current_user),
    )

    assert response.status_code == 200
    assert response.json()['items'] == []


@pytest.mark.integration
def test_search_users_can_exclude_current_user(client, db_session, api_prefix) -> None:
    current_user = create_user(
        db_session,
        email='bob.current@example.com',
        password='UsersPass123!',
        username='current-bob',
        first_name='Bob',
        last_name='Current',
    )
    other_user = create_user(
        db_session,
        email='bob.other@example.com',
        username='other-bob',
        first_name='Bob',
        last_name='Other',
    )
    tokens = security.create_auth_tokens(
        subject=current_user.id,
        email=current_user.email,
    )

    response = client.get(
        f'{api_prefix}/users?query=bob&exclude_current_user=true',
        headers={'Authorization': f'Bearer {tokens["access_token"]}'},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload['total'] == 1
    assert [user['id'] for user in payload['items']] == [str(other_user.id)]


@pytest.mark.integration
def test_search_users_supports_pagination(client, db_session, api_prefix) -> None:
    current_user = create_user(
        db_session,
        email='current@example.com',
        password='UsersPass123!',
    )
    paged_user = None
    for email, first_name in [
        ('alba@example.com', 'Alba'),
        ('albert@example.com', 'Albert'),
        ('alex@example.com', 'Alex'),
    ]:
        created_user = create_user(
            db_session,
            email=email,
            username=email.split('@')[0],
            first_name=first_name,
        )
        if email == 'albert@example.com':
            paged_user = created_user
    tokens = security.create_auth_tokens(
        subject=current_user.id,
        email=current_user.email,
    )

    response = client.get(
        f'{api_prefix}/users?query=al&page=2&page_size=1',
        headers={'Authorization': f'Bearer {tokens["access_token"]}'},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload['total'] == 3
    assert payload['page'] == 2
    assert payload['page_size'] == 1
    assert [user['id'] for user in payload['items']] == [str(paged_user.id)]
    assert all('email' not in user for user in payload['items'])


@pytest.mark.integration
def test_get_user_by_uuid_without_auth(client, db_session, api_prefix) -> None:
    user = create_user(
        db_session,
        email='public-user@example.com',
        username='public-user',
        first_name='Public',
        last_name='Traveler',
    )
    avatar = create_media(
        db_session,
        storage_path='media/public-avatar.jpg',
        created_by=user.id,
    )
    user.profile.profile_picture_media_id = avatar.id
    db_session.commit()

    response = client.get(f'{api_prefix}/users/{user.id}')

    assert response.status_code == 200
    payload = response.json()
    assert payload['id'] == str(user.id)
    assert 'email' not in payload
    assert payload['profile']['username'] == 'public-user'
    assert payload['profile']['first_name'] == 'Public'
    assert payload['profile']['last_name'] == 'Traveler'
    assert payload['profile']['profile_picture']['id'] == str(avatar.id)


@pytest.mark.integration
def test_get_user_by_username_without_auth(client, db_session, api_prefix) -> None:
    user = create_user(
        db_session,
        email='username-user@example.com',
        username='Travel-Bob',
        first_name='Bob',
        last_name='Voyager',
    )

    response = client.get(f'{api_prefix}/users/by-username/travelbob')

    assert response.status_code == 200
    payload = response.json()
    assert payload['id'] == str(user.id)
    assert payload['profile']['username'] == 'Travel-Bob'


@pytest.mark.integration
def test_get_user_by_username_returns_404_when_missing(client, api_prefix) -> None:
    response = client.get(f'{api_prefix}/users/by-username/missing-user')

    assert response.status_code == 404


@pytest.mark.integration
def test_get_user_by_uuid_returns_404_when_missing(client, api_prefix) -> None:
    response = client.get(f'{api_prefix}/users/00000000-0000-0000-0000-000000000000')

    assert response.status_code == 404


@pytest.mark.integration
def test_get_current_user_returns_role(client, db_session, api_prefix) -> None:
    user = create_user(
        db_session,
        email='admin-user@example.com',
        password='UsersPass123!',
        role=UserRole.ADMIN,
        username='admin-user',
        first_name='Admin',
        last_name='User',
    )

    response = client.get(
        f'{api_prefix}/users/me',
        headers=_auth_headers(user),
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload['id'] == str(user.id)
    assert payload['role'] == UserRole.ADMIN.value
    assert payload['profile']['username'] == 'admin-user'
    assert 'email' not in payload


@pytest.mark.integration
def test_check_username_availability_uses_canonical_username(
    client,
    db_session,
    api_prefix,
) -> None:
    existing_user = create_user(
        db_session,
        password='UsersPass123!',
        username='Bob.Veringa',
    )
    other_user = create_user(
        db_session,
        password='UsersPass123!',
        username='another-user',
    )

    taken_response = client.get(
        f'{api_prefix}/users/username-availability',
        params={'username': 'bobveringa'},
    )
    own_response = client.get(
        f'{api_prefix}/users/username-availability',
        headers=_auth_headers(existing_user),
        params={'username': 'BOB_VERINGA'},
    )
    other_response = client.get(
        f'{api_prefix}/users/username-availability',
        headers=_auth_headers(other_user),
        params={'username': 'Bob-Veringa'},
    )

    assert taken_response.status_code == 200
    assert taken_response.json() == {
        'username': 'bobveringa',
        'available': False,
    }
    assert own_response.status_code == 200
    assert own_response.json() == {
        'username': 'BOB_VERINGA',
        'available': True,
    }
    assert other_response.status_code == 200
    assert other_response.json() == {
        'username': 'Bob-Veringa',
        'available': False,
    }


@pytest.mark.integration
@pytest.mark.parametrize(
    'username',
    [' bob', 'bob ', 'bo b', '.bob', 'bob.', 'bo..b', 'bo@b', 'b.o'],
)
def test_check_username_availability_rejects_invalid_username(
    client,
    api_prefix,
    username,
) -> None:
    response = client.get(
        f'{api_prefix}/users/username-availability',
        params={'username': username},
    )

    assert response.status_code == 422


@pytest.mark.integration
def test_update_current_user_profile_and_avatar(client, db_session, api_prefix) -> None:
    user = create_user(
        db_session,
        email='profile@example.com',
        password='UsersPass123!',
    )
    avatar = create_media(
        db_session,
        storage_path='media/profile-avatar.jpg',
        created_by=user.id,
    )

    response = client.patch(
        f'{api_prefix}/users/me',
        headers=_auth_headers(user),
        json={
            'username': 'Travel-Bob',
            'first_name': 'Bob',
            'last_name': 'Voyager',
            'biography': 'Writing notes from the road.',
            'profile_picture_media_id': str(avatar.id),
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload['id'] == str(user.id)
    assert 'email' not in payload
    assert payload['profile']['username'] == 'Travel-Bob'
    assert payload['profile']['first_name'] == 'Bob'
    assert payload['profile']['last_name'] == 'Voyager'
    assert payload['profile']['biography'] == 'Writing notes from the road.'
    assert 'profile_picture_media_id' not in payload['profile']
    assert payload['profile']['profile_picture']['id'] == str(avatar.id)


@pytest.mark.integration
def test_update_current_user_can_remove_avatar(client, db_session, api_prefix) -> None:
    user = create_user(
        db_session,
        password='UsersPass123!',
        username='avatar-user',
        first_name='Avatar',
        last_name='User',
    )
    avatar = create_media(
        db_session,
        storage_path='media/remove-avatar.jpg',
        created_by=user.id,
    )
    user.profile.profile_picture_media_id = avatar.id
    db_session.commit()

    response = client.patch(
        f'{api_prefix}/users/me',
        headers=_auth_headers(user),
        json={'profile_picture_media_id': None},
    )

    assert response.status_code == 200
    payload = response.json()
    assert 'profile_picture_media_id' not in payload['profile']
    assert payload['profile']['profile_picture'] is None


@pytest.mark.integration
def test_update_current_user_can_clear_names(client, db_session, api_prefix) -> None:
    user = create_user(
        db_session,
        password='UsersPass123!',
        username='clear-names',
        first_name='Clear',
        last_name='Names',
    )

    response = client.patch(
        f'{api_prefix}/users/me',
        headers=_auth_headers(user),
        json={
            'first_name': '',
            'last_name': '',
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload['profile']['first_name'] == ''
    assert payload['profile']['last_name'] == ''


@pytest.mark.integration
def test_update_current_user_rejects_duplicate_username(
    client,
    db_session,
    api_prefix,
) -> None:
    user = create_user(
        db_session,
        password='UsersPass123!',
        username='current-user',
    )
    create_user(
        db_session,
        username='Existing.User',
    )

    response = client.patch(
        f'{api_prefix}/users/me',
        headers=_auth_headers(user),
        json={'username': 'existinguser'},
    )

    assert response.status_code == 409


@pytest.mark.integration
@pytest.mark.parametrize(
    'username',
    [' bob', 'bob ', 'bo b', '-bob', 'bob_', 'bo__b', 'bo@b', 'b.o'],
)
def test_update_current_user_rejects_invalid_username(
    client,
    db_session,
    api_prefix,
    username,
) -> None:
    user = create_user(db_session, password='UsersPass123!')

    response = client.patch(
        f'{api_prefix}/users/me',
        headers=_auth_headers(user),
        json={'username': username},
    )

    assert response.status_code == 422


@pytest.mark.integration
def test_update_current_user_profile_requires_auth(client, api_prefix) -> None:
    response = client.patch(
        f'{api_prefix}/users/me',
        json={'username': 'anonymous'},
    )

    assert response.status_code == 401


@pytest.mark.integration
def test_update_current_user_profile_validates_avatar_media(
    client,
    db_session,
    api_prefix,
) -> None:
    user = create_user(db_session, password='UsersPass123!')
    another_user = create_user(db_session, password='UsersPass123!')
    other_user_media = create_media(
        db_session,
        storage_path='media/other-avatar.jpg',
        created_by=another_user.id,
    )
    video_media = create_media(
        db_session,
        storage_path='media/avatar-video.mp4',
        created_by=user.id,
        media_type=MediaType.VIDEO,
        content_type='video/mp4',
        duration=2,
    )
    headers = _auth_headers(user)

    missing_response = client.patch(
        f'{api_prefix}/users/me',
        headers=headers,
        json={'profile_picture_media_id': '00000000-0000-0000-0000-000000000000'},
    )
    ownership_response = client.patch(
        f'{api_prefix}/users/me',
        headers=headers,
        json={'profile_picture_media_id': str(other_user_media.id)},
    )
    video_response = client.patch(
        f'{api_prefix}/users/me',
        headers=headers,
        json={'profile_picture_media_id': str(video_media.id)},
    )

    assert missing_response.status_code == 404
    assert ownership_response.status_code == 403
    assert video_response.status_code == 400
