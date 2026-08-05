from __future__ import annotations

import pytest

from core.app_settings import (
    AppSettingRegistryError,
    AppSettingValidationError,
    AppSettingsRegistry,
    SettingDefinition,
    SettingValueType,
    SettingVisibility,
    app_settings_registry,
)
from core.app_settings_encryption import (
    AppSettingsEncryption,
    AppSettingsEncryptionError,
)


def test_registry_contains_validated_defaults() -> None:
    darkmode = app_settings_registry.require('theme.darkmode')
    upload_size = app_settings_registry.require('media.max_upload_size_mb')

    assert darkmode.default_value == 'system'
    assert upload_size.default_value == 512
    assert app_settings_registry.validate_value(darkmode, 'enabled') == 'enabled'


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
