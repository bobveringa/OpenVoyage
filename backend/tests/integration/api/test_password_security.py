from __future__ import annotations

from datetime import timedelta

import pytest

from core import security
from factories.users import create_user
from models.database.user import UserRole


def _tokens(user):
    return security.create_auth_tokens(
        subject=user.id,
        email=user.email,
        auth_version=user.auth_version,
    )


def _headers(access_token: str) -> dict[str, str]:
    return {'Authorization': f'Bearer {access_token}'}


@pytest.mark.integration
def test_forced_change_user_can_read_self_but_not_use_protected_features(
    client,
    db_session,
    api_prefix,
) -> None:
    user = create_user(
        db_session,
        password='TemporaryPass123!',
        password_change_required=True,
    )
    tokens = _tokens(user)
    headers = _headers(tokens['access_token'])

    me_response = client.get(f'{api_prefix}/users/me', headers=headers)
    protected_response = client.get(
        f'{api_prefix}/users?query=test',
        headers=headers,
    )

    assert me_response.status_code == 200
    assert me_response.json()['password_change_required'] is True
    assert protected_response.status_code == 403
    assert protected_response.json() == {'detail': 'Password change required'}


@pytest.mark.integration
def test_change_password_rotates_version_and_returns_working_tokens(
    client,
    db_session,
    api_prefix,
) -> None:
    user = create_user(
        db_session,
        email='change@example.com',
        password='TemporaryPass123!',
        password_change_required=True,
    )
    old_tokens = _tokens(user)

    response = client.put(
        f'{api_prefix}/users/me/password',
        headers=_headers(old_tokens['access_token']),
        json={
            'current_password': 'TemporaryPass123!',
            'new_password': 'PrivatePassword456!',
        },
    )

    assert response.status_code == 200
    assert response.headers['cache-control'] == 'no-store'
    new_tokens = response.json()

    db_session.expire_all()
    updated_user = db_session.get(type(user), user.id)
    assert updated_user is not None
    assert updated_user.auth_version == 1
    assert updated_user.password_change_required is False
    assert security.verify_password('PrivatePassword456!', updated_user.password_hash)[
        0
    ]

    assert (
        client.get(
            f'{api_prefix}/users/me',
            headers=_headers(old_tokens['access_token']),
        ).status_code
        == 401
    )
    assert (
        client.post(
            f'{api_prefix}/login/refresh-token',
            json={'refresh_token': old_tokens['refresh_token']},
        ).status_code
        == 401
    )
    current_response = client.get(
        f'{api_prefix}/users/me',
        headers=_headers(new_tokens['access_token']),
    )
    assert current_response.status_code == 200
    assert current_response.json()['password_change_required'] is False


@pytest.mark.integration
@pytest.mark.parametrize(
    ('current_password', 'new_password', 'detail'),
    [
        (
            'WrongPassword123!',
            'PrivatePassword456!',
            'Current password is incorrect',
        ),
        (
            'CurrentPassword123!',
            'CurrentPassword123!',
            'New password must be different from current password',
        ),
    ],
)
def test_change_password_rejects_invalid_passwords_without_changing_state(
    client,
    db_session,
    api_prefix,
    current_password,
    new_password,
    detail,
) -> None:
    user = create_user(
        db_session,
        password='CurrentPassword123!',
        password_change_required=True,
    )
    tokens = _tokens(user)

    response = client.put(
        f'{api_prefix}/users/me/password',
        headers=_headers(tokens['access_token']),
        json={
            'current_password': current_password,
            'new_password': new_password,
        },
    )

    assert response.status_code == 400
    assert response.json() == {'detail': detail}
    db_session.expire_all()
    unchanged_user = db_session.get(type(user), user.id)
    assert unchanged_user is not None
    assert unchanged_user.auth_version == 0
    assert unchanged_user.password_change_required is True


@pytest.mark.integration
@pytest.mark.parametrize('require_password_change', [True, False])
def test_admin_can_assign_temporary_or_normal_password(
    client,
    db_session,
    api_prefix,
    require_password_change,
) -> None:
    admin = create_user(
        db_session,
        email='admin@example.com',
        role=UserRole.ADMIN,
    )
    target = create_user(
        db_session,
        email='target@example.com',
        password='OldPassword123!',
    )
    target_tokens = _tokens(target)

    response = client.put(
        f'{api_prefix}/admin/users/{target.id}/password',
        headers=_headers(_tokens(admin)['access_token']),
        json={
            'password': 'AssignedPassword456!',
            'require_password_change': require_password_change,
        },
    )

    assert response.status_code == 204
    db_session.expire_all()
    updated_target = db_session.get(type(target), target.id)
    assert updated_target is not None
    assert updated_target.auth_version == 1
    assert updated_target.password_change_required is require_password_change
    assert security.verify_password(
        'AssignedPassword456!', updated_target.password_hash
    )[0]
    assert (
        client.get(
            f'{api_prefix}/users/me',
            headers=_headers(target_tokens['access_token']),
        ).status_code
        == 401
    )


@pytest.mark.integration
def test_admin_cannot_assign_own_password(client, db_session, api_prefix) -> None:
    admin = create_user(
        db_session,
        email='admin@example.com',
        role=UserRole.ADMIN,
    )

    response = client.put(
        f'{api_prefix}/admin/users/{admin.id}/password',
        headers=_headers(_tokens(admin)['access_token']),
        json={'password': 'AssignedPassword456!'},
    )

    assert response.status_code == 409
    assert response.json() == {
        'detail': 'Use account security to change your own password'
    }


@pytest.mark.integration
def test_sign_out_all_invalidates_access_and_refresh_tokens(
    client,
    db_session,
    api_prefix,
) -> None:
    user = create_user(db_session, password='CurrentPassword123!')
    tokens = _tokens(user)

    response = client.post(
        f'{api_prefix}/users/me/sign-out-all',
        headers=_headers(tokens['access_token']),
    )

    assert response.status_code == 204
    assert (
        client.get(
            f'{api_prefix}/users/me',
            headers=_headers(tokens['access_token']),
        ).status_code
        == 401
    )
    assert (
        client.post(
            f'{api_prefix}/login/refresh-token',
            json={'refresh_token': tokens['refresh_token']},
        ).status_code
        == 401
    )


@pytest.mark.integration
def test_access_token_without_version_is_rejected(
    client,
    db_session,
    api_prefix,
) -> None:
    user = create_user(db_session)
    token = security.create_token(
        subject=user.id,
        token_type=security.TOKEN_TYPE_ACCESS,
        expires_delta=timedelta(minutes=5),
    )

    response = client.get(
        f'{api_prefix}/users/me',
        headers=_headers(token),
    )

    assert response.status_code == 401
