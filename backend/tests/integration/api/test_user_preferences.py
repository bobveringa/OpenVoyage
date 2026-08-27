from __future__ import annotations

import copy

import pytest

from core import security
from core.setting_validators.theme_palette import DEFAULT_THEME_PALETTE
from factories.users import create_user
from models.database.user_preferences import UserPreferences


def _auth_headers(user) -> dict[str, str]:
    tokens = security.create_auth_tokens(subject=user.id, email=user.email)
    return {'Authorization': f'Bearer {tokens["access_token"]}'}


@pytest.mark.integration
def test_user_preferences_require_auth(client, api_prefix) -> None:
    get_response = client.get(f'{api_prefix}/users/me/preferences')
    patch_response = client.patch(
        f'{api_prefix}/users/me/preferences',
        json={'time_format': '12-hour'},
    )

    assert get_response.status_code == 401
    assert patch_response.status_code == 401


@pytest.mark.integration
def test_get_user_preferences_returns_defaults_without_creating_row(
    client, db_session, api_prefix
) -> None:
    user = create_user(db_session)

    response = client.get(
        f'{api_prefix}/users/me/preferences', headers=_auth_headers(user)
    )

    assert response.status_code == 200
    assert response.headers['Cache-Control'] == 'no-store'
    assert response.json() == {
        'time_format': '24-hour',
        'theme_palette': None,
        'updated_at': None,
    }
    assert db_session.get(UserPreferences, user.id) is None


@pytest.mark.integration
def test_user_preferences_patch_preserves_omitted_fields_and_normalizes_palette(
    client, db_session, api_prefix
) -> None:
    user = create_user(db_session)
    headers = _auth_headers(user)
    palette = copy.deepcopy(DEFAULT_THEME_PALETTE)
    palette['light']['primary'] = '#246b49'

    time_response = client.patch(
        f'{api_prefix}/users/me/preferences',
        headers=headers,
        json={'time_format': '12-hour'},
    )
    palette_response = client.patch(
        f'{api_prefix}/users/me/preferences',
        headers=headers,
        json={'theme_palette': palette},
    )

    assert time_response.status_code == 200
    assert time_response.json()['time_format'] == '12-hour'
    assert time_response.json()['theme_palette'] is None
    assert time_response.json()['updated_at'] is not None
    assert palette_response.status_code == 200
    payload = palette_response.json()
    assert payload['time_format'] == '12-hour'
    assert payload['theme_palette']['light']['primary'] == '#246B49'
    assert payload['updated_at'] is not None


@pytest.mark.integration
def test_user_preferences_can_switch_back_to_instance_theme(
    client, db_session, api_prefix
) -> None:
    user = create_user(db_session)
    headers = _auth_headers(user)

    client.patch(
        f'{api_prefix}/users/me/preferences',
        headers=headers,
        json={'theme_palette': DEFAULT_THEME_PALETTE},
    )
    response = client.patch(
        f'{api_prefix}/users/me/preferences',
        headers=headers,
        json={'theme_palette': None},
    )

    assert response.status_code == 200
    assert response.json()['theme_palette'] is None
    assert db_session.get(UserPreferences, user.id).theme_palette is None


@pytest.mark.integration
@pytest.mark.parametrize(
    'payload',
    [
        {},
        {'time_format': None},
        {'theme_mode': 'dark'},
        {'time_format': 'invalid'},
        {'theme_palette': {'schema_version': 1}},
    ],
)
def test_user_preferences_reject_invalid_patches(
    client, db_session, api_prefix, payload
) -> None:
    user = create_user(db_session)

    response = client.patch(
        f'{api_prefix}/users/me/preferences',
        headers=_auth_headers(user),
        json=payload,
    )

    assert response.status_code == 422
    assert db_session.get(UserPreferences, user.id) is None


@pytest.mark.integration
def test_user_preferences_are_private_and_cascade_with_user(
    client, db_session, api_prefix
) -> None:
    owner = create_user(db_session)
    other_user = create_user(db_session)
    client.patch(
        f'{api_prefix}/users/me/preferences',
        headers=_auth_headers(owner),
        json={'time_format': '12-hour'},
    )

    other_response = client.get(
        f'{api_prefix}/users/me/preferences', headers=_auth_headers(other_user)
    )
    db_session.delete(owner)
    db_session.commit()

    assert other_response.status_code == 200
    assert other_response.json()['time_format'] == '24-hour'
    assert db_session.get(UserPreferences, owner.id) is None
