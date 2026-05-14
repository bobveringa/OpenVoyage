from __future__ import annotations

import pytest

from factories.users import create_user


@pytest.mark.integration
def test_login_access_token_success(client, db_session, api_prefix) -> None:
    password = 'S3curePassword!'
    user = create_user(
        db_session,
        email='login-user@example.com',
        password=password,
    )

    response = client.post(
        f'{api_prefix}/login/access-token',
        data={
            'username': user.email,
            'password': password,
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload['token_type'] == 'bearer'
    assert payload['access_token']
    assert payload['refresh_token']
    assert payload['id_token']


@pytest.mark.integration
def test_login_access_token_invalid_password(client, db_session, api_prefix) -> None:
    create_user(
        db_session,
        email='login-user@example.com',
        password='right-password',
    )

    response = client.post(
        f'{api_prefix}/login/access-token',
        data={
            'username': 'login-user@example.com',
            'password': 'wrong-password',
        },
    )

    assert response.status_code == 401
    assert response.json()['detail'] == 'Incorrect email or password'
