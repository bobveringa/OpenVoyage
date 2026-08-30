from __future__ import annotations

import pytest

from core import security
from core.app_settings import (
    DEFAULT_MAP_TILE_PROVIDER_URL,
    DEFAULT_THEME_PALETTE,
    MAP_TILE_PROVIDER_KEY,
    MEDIA_MAX_UPLOAD_SIZE_MB_KEY,
    ROUTING_GRAPHHOPPER_API_KEY,
    ROUTING_PROVIDER_KEY,
    THEME_PALETTE_KEY,
)
from core.app_settings_encryption import AppSettingsEncryption
from core.config import settings
from factories.users import create_user
from models.database.settings import AppSetting
from models.database.user import UserRole
from services.app_settings_service import AppSettingsService


def _auth_headers(user) -> dict[str, str]:
    tokens = security.create_auth_tokens(subject=user.id, email=user.email)
    return {'Authorization': f'Bearer {tokens["access_token"]}'}


def _admin(db_session):
    return create_user(
        db_session,
        password='AdminPass123!',
        role=UserRole.ADMIN,
    )


@pytest.mark.integration
def test_public_settings_returns_only_public_defaults(client, db_session, api_prefix):
    db_session.add(AppSetting(key='orphan.setting', value='ignored'))
    db_session.commit()

    response = client.get(f'{api_prefix}/settings/public')

    assert response.status_code == 200
    assert response.json() == {
        'settings': {
            THEME_PALETTE_KEY: DEFAULT_THEME_PALETTE,
            MAP_TILE_PROVIDER_KEY: DEFAULT_MAP_TILE_PROVIDER_URL,
        },
        'updated_at': None,
    }
    assert response.headers['cache-control'] == 'no-store'


@pytest.mark.integration
def test_admin_settings_requires_admin(client, db_session, api_prefix) -> None:
    user = create_user(db_session, password='UserPass123!')

    anonymous = client.get(f'{api_prefix}/admin/settings')
    forbidden = client.get(f'{api_prefix}/admin/settings', headers=_auth_headers(user))

    assert anonymous.status_code == 401
    assert forbidden.status_code == 403


@pytest.mark.integration
def test_admin_list_includes_redacted_secret_metadata(
    client, db_session, api_prefix
) -> None:
    admin = _admin(db_session)
    db_session.add(
        AppSetting(
            key=ROUTING_GRAPHHOPPER_API_KEY,
            secret_value='v1:unreadable-but-not-decrypted',
        )
    )
    db_session.commit()

    response = client.get(f'{api_prefix}/admin/settings', headers=_auth_headers(admin))

    assert response.status_code == 200
    payload = response.json()
    keys = {record['key'] for record in payload['settings']}
    secret = next(
        record
        for record in payload['settings']
        if record['key'] == ROUTING_GRAPHHOPPER_API_KEY
    )
    assert keys == {
        'theme.palette',
        'map.tile_provider',
        'routing.provider',
        'routing.graphhopper_base_url',
        'routing.graphhopper_api_key',
        'media.max_upload_size_mb',
        'places.geonames_dataset',
        'media.orphan_retention_days',
    }
    assert secret['value'] is None
    assert secret['default_value'] is None
    assert secret['is_configured'] is True
    assert 'unreadable' not in str(payload)


@pytest.mark.integration
def test_admin_can_update_normal_and_secret_settings(
    client, db_session, api_prefix, monkeypatch
) -> None:
    admin = _admin(db_session)
    encryption_key = settings.SECRET_KEY
    headers = _auth_headers(admin)

    normal_response = client.patch(
        f'{api_prefix}/admin/settings/{ROUTING_PROVIDER_KEY}',
        headers=headers,
        json={'value': 'graphhopper'},
    )
    secret_response = client.patch(
        f'{api_prefix}/admin/settings/{ROUTING_GRAPHHOPPER_API_KEY}',
        headers=headers,
        json={'value': 'raw-api-secret'},
    )

    assert normal_response.status_code == 200
    assert normal_response.json()['value'] == 'graphhopper'
    assert normal_response.json()['is_configured'] is True
    assert secret_response.status_code == 200
    assert secret_response.json()['value'] is None
    assert secret_response.json()['is_configured'] is True
    row = db_session.get(AppSetting, ROUTING_GRAPHHOPPER_API_KEY)
    assert row is not None
    assert row.value is None
    assert row.secret_value is not None
    assert row.secret_value.startswith('v1:')
    assert 'raw-api-secret' not in row.secret_value
    service = AppSettingsService(
        db_session,
        AppSettingsEncryption(encryption_key),
    )
    assert service.get_value(ROUTING_GRAPHHOPPER_API_KEY) == 'raw-api-secret'


@pytest.mark.integration
@pytest.mark.parametrize(
    ('setting_key', 'value'),
    [
        (MAP_TILE_PROVIDER_KEY, 'ftp://tiles.example.test/{z}/{x}/{y}.png'),
        (ROUTING_PROVIDER_KEY, 'unknown'),
        ('routing.graphhopper_base_url', 'ftp://example.test'),
        (MEDIA_MAX_UPLOAD_SIZE_MB_KEY, True),
        (MEDIA_MAX_UPLOAD_SIZE_MB_KEY, 0),
        (MEDIA_MAX_UPLOAD_SIZE_MB_KEY, 5121),
        (ROUTING_GRAPHHOPPER_API_KEY, ''),
        (MAP_TILE_PROVIDER_KEY, None),
    ],
)
def test_admin_update_validates_registry_values(
    client,
    db_session,
    api_prefix,
    setting_key,
    value,
) -> None:
    admin = _admin(db_session)

    response = client.patch(
        f'{api_prefix}/admin/settings/{setting_key}',
        headers=_auth_headers(admin),
        json={'value': value},
    )

    assert response.status_code == 422
    assert response.json()['detail'][0]['loc'] == ['body', 'value']


@pytest.mark.integration
def test_secret_reset_is_idempotent_and_does_not_decrypt(
    client, db_session, api_prefix
) -> None:
    admin = _admin(db_session)
    headers = _auth_headers(admin)
    db_session.add(
        AppSetting(
            key=ROUTING_GRAPHHOPPER_API_KEY,
            secret_value='v1:unreadable',
        )
    )
    db_session.commit()
    url = f'{api_prefix}/admin/settings/{ROUTING_GRAPHHOPPER_API_KEY}/reset'

    first = client.post(url, headers=headers)
    second = client.post(url, headers=headers)

    assert first.status_code == 200
    assert second.status_code == 200
    assert first.json()['is_configured'] is False
    assert second.json()['is_configured'] is False
    assert db_session.get(AppSetting, ROUTING_GRAPHHOPPER_API_KEY) is None


@pytest.mark.integration
def test_reset_restores_non_secret_default(client, db_session, api_prefix) -> None:
    admin = _admin(db_session)
    db_session.add(AppSetting(key=MEDIA_MAX_UPLOAD_SIZE_MB_KEY, value=32))
    db_session.commit()

    response = client.post(
        f'{api_prefix}/admin/settings/{MEDIA_MAX_UPLOAD_SIZE_MB_KEY}/reset',
        headers=_auth_headers(admin),
    )

    assert response.status_code == 200
    assert response.json()['value'] == 512
    assert response.json()['is_configured'] is False
    assert response.json()['updated_at'] is None


@pytest.mark.integration
def test_admin_can_update_and_reset_public_tile_provider(
    client, db_session, api_prefix
) -> None:
    admin = _admin(db_session)
    headers = _auth_headers(admin)
    setting_url = f'{api_prefix}/admin/settings/{MAP_TILE_PROVIDER_KEY}'
    custom_tile_url = 'https://tiles.example.test/{z}/{x}/{y}.png'

    update_response = client.patch(
        setting_url,
        headers=headers,
        json={'value': custom_tile_url},
    )

    assert update_response.status_code == 200
    assert update_response.json()['value'] == custom_tile_url
    assert update_response.json()['is_configured'] is True
    row = db_session.get(AppSetting, MAP_TILE_PROVIDER_KEY)
    assert row is not None
    assert row.value == custom_tile_url
    assert row.secret_value is None

    public_response = client.get(f'{api_prefix}/settings/public')
    assert public_response.status_code == 200
    assert public_response.json()['settings'][MAP_TILE_PROVIDER_KEY] == custom_tile_url

    reset_response = client.post(f'{setting_url}/reset', headers=headers)

    assert reset_response.status_code == 200
    assert reset_response.json()['value'] == DEFAULT_MAP_TILE_PROVIDER_URL
    assert reset_response.json()['is_configured'] is False
    assert db_session.get(AppSetting, MAP_TILE_PROVIDER_KEY) is None
    reset_public_response = client.get(f'{api_prefix}/settings/public')
    assert reset_public_response.status_code == 200
    assert (
        reset_public_response.json()['settings'][MAP_TILE_PROVIDER_KEY]
        == DEFAULT_MAP_TILE_PROVIDER_URL
    )


@pytest.mark.integration
def test_admin_can_update_and_reset_theme_palette(
    client, db_session, api_prefix
) -> None:
    admin = _admin(db_session)
    headers = _auth_headers(admin)
    setting_url = f'{api_prefix}/admin/settings/{THEME_PALETTE_KEY}'
    palette = {
        **DEFAULT_THEME_PALETTE,
        'light': {
            **DEFAULT_THEME_PALETTE['light'],
            'primary': '#1D5E43',
        },
    }

    update_response = client.patch(
        setting_url, headers=headers, json={'value': palette}
    )

    assert update_response.status_code == 200
    assert update_response.json()['value']['light']['primary'] == '#1D5E43'
    public_response = client.get(f'{api_prefix}/settings/public')
    assert (
        public_response.json()['settings'][THEME_PALETTE_KEY]['light']['primary']
        == '#1D5E43'
    )

    reset_response = client.post(f'{setting_url}/reset', headers=headers)

    assert reset_response.status_code == 200
    assert reset_response.json()['value'] == DEFAULT_THEME_PALETTE
    assert db_session.get(AppSetting, THEME_PALETTE_KEY) is None


@pytest.mark.integration
def test_unknown_setting_returns_not_found(client, db_session, api_prefix) -> None:
    admin = _admin(db_session)
    headers = _auth_headers(admin)

    detail = client.get(f'{api_prefix}/admin/settings/orphan.setting', headers=headers)
    update = client.patch(
        f'{api_prefix}/admin/settings/orphan.setting',
        headers=headers,
        json={'value': 'x'},
    )
    reset = client.post(
        f'{api_prefix}/admin/settings/orphan.setting/reset', headers=headers
    )

    assert detail.status_code == 404
    assert update.status_code == 404
    assert reset.status_code == 404


@pytest.mark.integration
@pytest.mark.parametrize(
    ('setting_key', 'value', 'secret_value'),
    [
        (ROUTING_PROVIDER_KEY, None, 'v1:wrong-payload-column'),
        (MEDIA_MAX_UPLOAD_SIZE_MB_KEY, True, None),
        ('routing.graphhopper_base_url', {'not': 'a string'}, None),
        (ROUTING_PROVIDER_KEY, 1, None),
    ],
)
def test_malformed_stored_row_returns_safe_server_error(
    client,
    db_session,
    api_prefix,
    setting_key,
    value,
    secret_value,
) -> None:
    admin = _admin(db_session)
    db_session.add(
        AppSetting(
            key=setting_key,
            value=value,
            secret_value=secret_value,
        )
    )
    db_session.commit()

    response = client.get(
        f'{api_prefix}/admin/settings/{setting_key}',
        headers=_auth_headers(admin),
    )

    assert response.status_code == 500
    assert response.json() == {'detail': 'Stored app setting is invalid'}
