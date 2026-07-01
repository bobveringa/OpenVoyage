from __future__ import annotations

import pytest

from core import security
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


@pytest.mark.integration
def test_refresh_token_success(client, db_session, api_prefix) -> None:
    user = create_user(
        db_session,
        email='refresh-user@example.com',
        password='S3curePassword!',
    )
    tokens = security.create_auth_tokens(subject=user.id, email=user.email)

    response = client.post(
        f'{api_prefix}/login/refresh-token',
        json={'refresh_token': tokens['refresh_token']},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload['token_type'] == 'bearer'
    assert payload['access_token']
    assert payload['refresh_token']
    assert payload['id_token']


@pytest.mark.integration
def test_refresh_token_rejects_wrong_token_type(client, db_session, api_prefix) -> None:
    user = create_user(db_session, email='wrong-type@example.com')
    tokens = security.create_auth_tokens(subject=user.id, email=user.email)

    response = client.post(
        f'{api_prefix}/login/refresh-token',
        json={'refresh_token': tokens['access_token']},
    )

    assert response.status_code == 401
    assert response.json()['detail'] == 'Invalid refresh token'


@pytest.mark.integration
def test_refresh_token_rejects_missing_user(client, api_prefix) -> None:
    tokens = security.create_auth_tokens(
        subject='15f2aac8-2ac8-40f0-a5f6-336f17167b59',
        email='deleted@example.com',
    )

    response = client.post(
        f'{api_prefix}/login/refresh-token',
        json={'refresh_token': tokens['refresh_token']},
    )

    assert response.status_code == 401
    assert response.json()['detail'] == 'Invalid refresh token'
