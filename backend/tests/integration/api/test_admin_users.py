from __future__ import annotations

import uuid

import pytest
from sqlalchemy import select

from core import security
from factories.users import create_user
from models.database.user import User, UserRole


def _auth_headers(user: User) -> dict[str, str]:
    tokens = security.create_auth_tokens(
        subject=user.id,
        email=user.email,
        auth_version=user.auth_version,
    )
    return {'Authorization': f'Bearer {tokens["access_token"]}'}


def _create_payload(**overrides: object) -> dict[str, object]:
    payload: dict[str, object] = {
        'email': 'maya@example.com',
        'password': 'MayaSecurePass123!',
        'username': 'maya-travels',
        'first_name': 'Maya',
        'last_name': 'Chen',
        'role': 'USER',
    }
    payload.update(overrides)
    return payload


@pytest.mark.integration
def test_admin_can_create_user_with_flat_response(
    client, db_session, api_prefix
) -> None:
    admin = create_user(
        db_session,
        email='admin@example.com',
        role=UserRole.ADMIN,
        username='admin-user',
        first_name='Admin',
        last_name='User',
    )

    response = client.post(
        f'{api_prefix}/admin/users',
        headers=_auth_headers(admin),
        json=_create_payload(email='MAYA@EXAMPLE.COM'),
    )

    assert response.status_code == 201
    payload = response.json()
    assert payload['email'] == 'maya@example.com'
    assert payload['username'] == 'maya-travels'
    assert payload['role'] == 'USER'
    assert payload['password_change_required'] is True
    assert 'profile' not in payload
    assert 'password' not in payload
    created_user = db_session.get(User, uuid.UUID(payload['id']))
    assert created_user is not None
    assert created_user.password_change_required is True
    assert security.verify_password('MayaSecurePass123!', created_user.password_hash)[0]


@pytest.mark.integration
def test_admin_can_create_user_with_normal_password(
    client, db_session, api_prefix
) -> None:
    admin = create_user(
        db_session,
        email='admin@example.com',
        role=UserRole.ADMIN,
    )

    response = client.post(
        f'{api_prefix}/admin/users',
        headers=_auth_headers(admin),
        json=_create_payload(require_password_change=False),
    )

    assert response.status_code == 201
    assert response.json()['password_change_required'] is False
    created_user = db_session.get(User, uuid.UUID(response.json()['id']))
    assert created_user is not None
    assert created_user.password_change_required is False


@pytest.mark.integration
def test_admin_user_routes_require_an_admin(client, db_session, api_prefix) -> None:
    regular_user = create_user(
        db_session,
        email='regular@example.com',
        username='regular-user',
        first_name='Regular',
        last_name='User',
    )

    anonymous_response = client.get(f'{api_prefix}/admin/users')
    user_response = client.get(
        f'{api_prefix}/admin/users', headers=_auth_headers(regular_user)
    )

    assert anonymous_response.status_code == 401
    assert user_response.status_code == 403


@pytest.mark.integration
def test_admin_can_list_filter_and_get_users(client, db_session, api_prefix) -> None:
    admin = create_user(
        db_session,
        email='admin@example.com',
        role=UserRole.ADMIN,
        username='admin-user',
        first_name='Admin',
        last_name='User',
    )
    maya = create_user(
        db_session,
        email='maya@example.com',
        username='maya-travels',
        first_name='Maya',
        last_name='Chen',
    )
    create_user(
        db_session,
        email='another-admin@example.com',
        role=UserRole.ADMIN,
        username='another-admin',
        first_name='Another',
        last_name='Admin',
    )

    list_response = client.get(
        f'{api_prefix}/admin/users',
        headers=_auth_headers(admin),
        params={'query': 'maya', 'role': 'USER', 'page': 1, 'page_size': 1},
    )
    get_response = client.get(
        f'{api_prefix}/admin/users/{maya.id}', headers=_auth_headers(admin)
    )

    assert list_response.status_code == 200
    assert list_response.json()['total'] == 1
    assert list_response.json()['users'][0]['id'] == str(maya.id)
    assert get_response.status_code == 200
    assert get_response.json()['email'] == 'maya@example.com'


@pytest.mark.integration
def test_admin_can_update_user_without_changing_password(
    client, db_session, api_prefix
) -> None:
    admin = create_user(
        db_session,
        email='admin@example.com',
        role=UserRole.ADMIN,
        username='admin-user',
        first_name='Admin',
        last_name='User',
    )
    target = create_user(
        db_session,
        email='maya@example.com',
        username='maya-travels',
        first_name='Maya',
        last_name='Chen',
    )

    response = client.patch(
        f'{api_prefix}/admin/users/{target.id}',
        headers=_auth_headers(admin),
        json={
            'email': 'maya.chen@example.com',
            'first_name': 'May',
            'role': 'ADMIN',
        },
    )

    assert response.status_code == 200
    assert response.json()['email'] == 'maya.chen@example.com'
    assert response.json()['first_name'] == 'May'
    assert response.json()['role'] == 'ADMIN'
    db_session.expire_all()
    updated_user = db_session.get(User, target.id)
    assert updated_user is not None
    assert security.verify_password('password123', updated_user.password_hash)[0]


@pytest.mark.integration
def test_admin_update_rejects_password_field(client, db_session, api_prefix) -> None:
    admin = create_user(
        db_session,
        email='admin@example.com',
        role=UserRole.ADMIN,
    )
    target = create_user(db_session, email='target@example.com')

    response = client.patch(
        f'{api_prefix}/admin/users/{target.id}',
        headers=_auth_headers(admin),
        json={'password': 'NewMayaPass123!'},
    )

    assert response.status_code == 422


@pytest.mark.integration
def test_admin_user_updates_reject_conflicts_and_empty_payload(
    client, db_session, api_prefix
) -> None:
    admin = create_user(
        db_session,
        email='admin@example.com',
        role=UserRole.ADMIN,
        username='admin-user',
        first_name='Admin',
        last_name='User',
    )
    target = create_user(
        db_session,
        email='target@example.com',
        username='target-user',
        first_name='Target',
        last_name='User',
    )
    create_user(
        db_session,
        email='taken@example.com',
        username='taken-user',
        first_name='Taken',
        last_name='User',
    )

    duplicate_response = client.patch(
        f'{api_prefix}/admin/users/{target.id}',
        headers=_auth_headers(admin),
        json={'username': 'taken.user'},
    )
    empty_response = client.patch(
        f'{api_prefix}/admin/users/{target.id}',
        headers=_auth_headers(admin),
        json={},
    )

    assert duplicate_response.status_code == 409
    assert empty_response.status_code == 422


@pytest.mark.integration
def test_admin_cannot_change_own_role_or_remove_last_admin(
    client, db_session, api_prefix
) -> None:
    admin = create_user(
        db_session,
        email='admin@example.com',
        role=UserRole.ADMIN,
        username='admin-user',
        first_name='Admin',
        last_name='User',
    )

    role_response = client.patch(
        f'{api_prefix}/admin/users/{admin.id}',
        headers=_auth_headers(admin),
        json={'role': 'USER'},
    )
    delete_response = client.delete(
        f'{api_prefix}/admin/users/{admin.id}', headers=_auth_headers(admin)
    )

    assert role_response.status_code == 409
    assert delete_response.status_code == 409


@pytest.mark.integration
def test_admin_can_delete_another_user(client, db_session, api_prefix) -> None:
    admin = create_user(
        db_session,
        email='admin@example.com',
        role=UserRole.ADMIN,
        username='admin-user',
        first_name='Admin',
        last_name='User',
    )
    target = create_user(
        db_session,
        email='target@example.com',
        username='target-user',
        first_name='Target',
        last_name='User',
    )

    response = client.delete(
        f'{api_prefix}/admin/users/{target.id}', headers=_auth_headers(admin)
    )

    assert response.status_code == 200
    assert response.json() == {'id': str(target.id), 'deleted': True}
    assert db_session.scalar(select(User).where(User.id == target.id)) is None
