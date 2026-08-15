from __future__ import annotations

import uuid

import pytest
from sqlalchemy import select

from factories.users import create_user
from models.database.user import User, UserProfile, UserRole


@pytest.mark.integration
def test_setup_status_reflects_whether_users_exist(
    client,
    db_session,
    api_prefix,
) -> None:
    initial_response = client.get(f'{api_prefix}/admin/setup')

    assert initial_response.status_code == 200
    assert initial_response.json() == {'setup_required': True}

    create_user(db_session)

    configured_response = client.get(f'{api_prefix}/admin/setup')

    assert configured_response.status_code == 200
    assert configured_response.json() == {'setup_required': False}


@pytest.mark.integration
def test_setup_creates_admin_and_profile(
    client,
    db_session,
    api_prefix,
) -> None:
    response = client.post(
        f'{api_prefix}/admin/setup',
        json={
            'email': 'FIRST-ADMIN@EXAMPLE.COM',
            'password': 'FirstAdminPass123!',
            'username': 'first-admin',
            'first_name': 'First',
            'last_name': 'Admin',
        },
    )

    assert response.status_code == 201
    payload = response.json()
    assert payload['email'] == 'first-admin@example.com'
    user_id = uuid.UUID(payload['id'])

    user = db_session.scalar(select(User).where(User.id == user_id))
    profile = db_session.scalar(
        select(UserProfile).where(UserProfile.user_id == user_id)
    )
    assert user is not None
    assert user.email == 'first-admin@example.com'
    assert user.role == UserRole.ADMIN
    assert profile is not None
    assert profile.username == 'first-admin'
    assert profile.first_name == 'First'
    assert profile.last_name == 'Admin'


@pytest.mark.integration
def test_setup_rejects_when_any_user_exists(
    client,
    db_session,
    api_prefix,
) -> None:
    create_user(db_session)

    response = client.post(
        f'{api_prefix}/admin/setup',
        json={
            'email': 'second-admin@example.com',
            'password': 'FirstAdminPass123!',
            'username': 'second-admin',
            'first_name': 'Second',
            'last_name': 'Admin',
        },
    )

    assert response.status_code == 403
    assert response.json()['detail'] == 'First user already exists'


@pytest.mark.integration
@pytest.mark.parametrize('username', [' first-admin', 'first admin', 'first@admin'])
def test_setup_rejects_invalid_username(
    client, api_prefix, username
) -> None:
    response = client.post(
        f'{api_prefix}/admin/setup',
        json={
            'email': 'first-admin@example.com',
            'password': 'FirstAdminPass123!',
            'username': username,
            'first_name': 'First',
            'last_name': 'Admin',
        },
    )

    assert response.status_code == 422
