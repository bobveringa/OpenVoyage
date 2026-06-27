from __future__ import annotations

import pytest

from core import security
from factories.users import create_user


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
        f'{api_prefix}/users?query=bob',
        headers={'Authorization': f'Bearer {tokens["access_token"]}'},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload['total'] == 3
    assert payload['page'] == 1
    assert payload['page_size'] == 20
    assert {user['id'] for user in payload['items']} == {
        str(email_match.id),
        str(first_name_match.id),
        str(username_match.id),
    }
    assert {user['email'] for user in payload['items']} == {
        'bob@example.com',
        'alice@example.com',
        'charlie@example.com',
    }


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
    for email in ['alba@example.com', 'albert@example.com', 'alex@example.com']:
        create_user(db_session, email=email)
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
    assert [user['email'] for user in payload['items']] == ['albert@example.com']
