from __future__ import annotations

import pytest

from core.app_settings import (
    AppSettingRegistryError,
    AppSettingValidationError,
    AppSettingsRegistry,
    DEFAULT_MAP_TILE_PROVIDER_URL,
    DEFAULT_THEME_PALETTE,
    MAP_TILE_PROVIDER_KEY,
    ROUTING_GRAPHHOPPER_BASE_URL_KEY,
    SettingDefinition,
    SettingValueType,
    SettingVisibility,
    THEME_PALETTE_KEY,
    app_settings_registry,
)
from core.app_settings_encryption import (
    AppSettingsEncryption,
    AppSettingsEncryptionError,
)


def test_registry_contains_validated_defaults() -> None:
    darkmode = app_settings_registry.require('theme.darkmode')
    tile_provider = app_settings_registry.require(MAP_TILE_PROVIDER_KEY)
    upload_size = app_settings_registry.require('media.max_upload_size_mb')
    palette = app_settings_registry.require(THEME_PALETTE_KEY)

    assert darkmode.default_value == 'system'
    assert tile_provider.default_value == DEFAULT_MAP_TILE_PROVIDER_URL
    assert upload_size.default_value == 512
    assert palette.default_value == DEFAULT_THEME_PALETTE
    assert app_settings_registry.validate_value(darkmode, 'enabled') == 'enabled'


def test_theme_palette_normalizes_valid_colors() -> None:
    definition = app_settings_registry.require(THEME_PALETTE_KEY)
    value = {
        **DEFAULT_THEME_PALETTE,
        'light': {
            **DEFAULT_THEME_PALETTE['light'],
            'background': '#f7fbf7',
        },
    }

    normalized = app_settings_registry.validate_value(definition, value)

    assert normalized['light']['background'] == '#F7FBF7'


def test_setting_runs_declarative_and_callable_validation() -> None:
    def normalize_prefixed_value(value: object) -> str:
        assert isinstance(value, str)
        if not value.startswith('app-'):
            raise AppSettingValidationError('Value must start with app-')
        return value.upper()

    definition = SettingDefinition(
        key='test.prefixed_value',
        value_type=SettingValueType.STRING,
        visibility=SettingVisibility.ADMIN,
        sensitive=False,
        runtime_safe=True,
        description='Test setting with both forms of validation.',
        default_value='app-default',
        validation={'max_length': 12},
        validator=normalize_prefixed_value,
    )
    registry = AppSettingsRegistry((definition,))

    assert registry.validate_value(definition, 'app-value') == 'APP-VALUE'

    with pytest.raises(AppSettingValidationError, match='at most 12'):
        registry.validate_value(definition, 'app-value-too-long')
    with pytest.raises(AppSettingValidationError, match='must start'):
        registry.validate_value(definition, 'other')


@pytest.mark.parametrize(
    'value',
    [
        {},
        {'schema_version': 2, 'light': {}, 'dark': {}},
        {
            'schema_version': 1,
            'light': DEFAULT_THEME_PALETTE['light'],
            'dark': {**DEFAULT_THEME_PALETTE['dark'], 'primary': 'url(evil)'},
        },
        {
            'schema_version': 1,
            'light': {**DEFAULT_THEME_PALETTE['light'], 'foreground': '#FFFFFF'},
            'dark': DEFAULT_THEME_PALETTE['dark'],
        },
    ],
)
def test_theme_palette_rejects_invalid_or_inaccessible_values(value) -> None:
    definition = app_settings_registry.require(THEME_PALETTE_KEY)

    with pytest.raises(AppSettingValidationError):
        app_settings_registry.validate_value(definition, value)


@pytest.mark.parametrize(
    'value',
    [
        'https://tiles.example.test/{z}/{x}/{y}.png',
        'https://{s}.tiles.example.test/{z}/{x}/{y}.png?key={apiKey}',
    ],
)
def test_tile_provider_setting_accepts_custom_url_template(value: str) -> None:
    definition = app_settings_registry.require(MAP_TILE_PROVIDER_KEY)

    assert app_settings_registry.validate_value(definition, value) == value


@pytest.mark.parametrize(
    'value',
    [
        '',
        'unknown',
        'ftp://tiles.example.test/{z}/{x}/{y}.png',
        'https://tiles.example.test/{z}/{x}/{y}.png bad',
        None,
        True,
    ],
)
def test_tile_provider_setting_rejects_invalid_url_template(value) -> None:
    definition = app_settings_registry.require(MAP_TILE_PROVIDER_KEY)

    with pytest.raises(AppSettingValidationError):
        app_settings_registry.validate_value(definition, value)


@pytest.mark.parametrize(
    'value',
    [
        'http://routing.example.test/api',
        'https://routing.example.test/api',
    ],
)
def test_graphhopper_base_url_setting_accepts_http_urls(value: str) -> None:
    definition = app_settings_registry.require(ROUTING_GRAPHHOPPER_BASE_URL_KEY)

    assert app_settings_registry.validate_value(definition, value) == value


@pytest.mark.parametrize('value', ['ftp://routing.example.test/api', 'not-a-url'])
def test_graphhopper_base_url_setting_rejects_non_http_urls(value: str) -> None:
    definition = app_settings_registry.require(ROUTING_GRAPHHOPPER_BASE_URL_KEY)

    with pytest.raises(AppSettingValidationError):
        app_settings_registry.validate_value(definition, value)


@pytest.mark.parametrize('value', [None, True, 0, 5121])
def test_integer_setting_validation_rejects_invalid_values(value) -> None:
    definition = app_settings_registry.require('media.max_upload_size_mb')

    with pytest.raises(AppSettingValidationError):
        app_settings_registry.validate_value(definition, value)


def test_registry_rejects_public_sensitive_setting() -> None:
    definition = SettingDefinition(
        key='bad.public_secret',
        value_type=SettingValueType.SECRET,
        visibility=SettingVisibility.PUBLIC,
        sensitive=True,
        runtime_safe=True,
        description='Invalid public secret.',
    )

    with pytest.raises(AppSettingRegistryError):
        AppSettingsRegistry((definition,))


def test_registry_rejects_secret_default() -> None:
    definition = SettingDefinition(
        key='bad.secret_default',
        value_type=SettingValueType.SECRET,
        visibility=SettingVisibility.ADMIN,
        sensitive=True,
        default_value='must-not-exist',
        runtime_safe=False,
        description='Invalid secret default.',
    )

    with pytest.raises(AppSettingRegistryError):
        AppSettingsRegistry((definition,))


@pytest.mark.parametrize(
    'key',
    [
        'a-very-secret-key-change-this-in-production',
        'caf\u00e9 \U0001f5fa\ufe0f',
        ' ',
    ],
)
def test_text_key_encryption_round_trip_uses_versioned_envelope(key: str) -> None:
    encryption = AppSettingsEncryption(key)

    ciphertext = encryption.encrypt('top-secret')

    assert ciphertext.startswith('v1:')
    assert 'top-secret' not in ciphertext
    assert encryption.decrypt(ciphertext) == 'top-secret'
    assert AppSettingsEncryption(key).decrypt(ciphertext) == 'top-secret'


@pytest.mark.parametrize(
    'ciphertext',
    [
        'v2:not-supported',
        'missing-envelope',
        'v1:',
        'v1:not-a-fernet-token',
    ],
)
def test_text_key_encryption_rejects_malformed_ciphertext(ciphertext: str) -> None:
    encryption = AppSettingsEncryption('app-settings-passphrase')

    with pytest.raises(AppSettingsEncryptionError):
        encryption.decrypt(ciphertext)


def test_text_key_encryption_rejects_tampering_and_wrong_key() -> None:
    encryption = AppSettingsEncryption('first app-settings passphrase')
    other_encryption = AppSettingsEncryption('second app-settings passphrase')
    ciphertext = encryption.encrypt('top-secret')
    tampered = ciphertext[:-1] + ('A' if ciphertext[-1] != 'A' else 'B')

    with pytest.raises(AppSettingsEncryptionError):
        encryption.decrypt(tampered)
    with pytest.raises(AppSettingsEncryptionError):
        other_encryption.decrypt(ciphertext)


@pytest.mark.parametrize('key', [None, ''])
def test_missing_key_fails_only_crypto_operations(key: str | None) -> None:
    encryption = AppSettingsEncryption(key)

    with pytest.raises(AppSettingsEncryptionError):
        encryption.encrypt('top-secret')
    with pytest.raises(AppSettingsEncryptionError):
        encryption.decrypt('v1:not-a-fernet-token')
