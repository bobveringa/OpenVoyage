from __future__ import annotations

from datetime import datetime, timezone
from unittest.mock import Mock

import pytest
from sqlalchemy.orm import Session

from core.app_settings import (
    AppSettingsRegistry,
    SettingDefinition,
    SettingValueType,
    SettingVisibility,
)
from core.app_settings_encryption import AppSettingsEncryption
from models.database.settings import AppSetting
from services.app_settings_service import (
    AppSettingsCache,
    AppSettingsService,
    StoredAppSettingError,
)


def _service(db: Mock, *, encryption=None, cache=None) -> AppSettingsService:
    db.get_bind.return_value = object()
    return AppSettingsService(
        db=db,
        encryption=encryption or AppSettingsEncryption(None),
        cache=cache or AppSettingsCache(),
    )


def test_non_secret_default_and_missing_secret_do_not_need_encryption_key() -> None:
    db = Mock(spec=Session)
    db.get.return_value = None
    service = _service(db)

    assert service.get_value('theme.darkmode') == 'system'
    assert service.get_value('routing.graphhopper_api_key') is None


def test_admin_secret_metadata_does_not_decrypt_ciphertext() -> None:
    db = Mock(spec=Session)
    db.get.return_value = AppSetting(
        key='routing.graphhopper_api_key',
        value=None,
        secret_value='v1:unreadable',
        updated_at=datetime.now(timezone.utc),
    )
    encryption = Mock(spec=AppSettingsEncryption)
    service = _service(db, encryption=encryption)

    record = service.get_admin_setting('routing.graphhopper_api_key')

    assert record.value is None
    assert record.is_configured is True
    encryption.decrypt.assert_not_called()


def test_secret_reset_does_not_decrypt_old_value() -> None:
    db = Mock(spec=Session)
    encryption = Mock(spec=AppSettingsEncryption)
    service = _service(db, encryption=encryption)

    record = service.reset_setting('routing.graphhopper_api_key')

    db.execute.assert_called_once()
    statement = db.execute.call_args.args[0]
    assert str(statement).startswith('DELETE FROM app_settings')
    db.get.assert_not_called()
    db.commit.assert_called_once_with()
    db.expire_all.assert_called_once_with()
    encryption.decrypt.assert_not_called()
    assert record.is_configured is False


def test_secret_update_overwrites_without_decrypting_old_value() -> None:
    db = Mock(spec=Session)
    db.execute.return_value.scalar_one.return_value = AppSetting(
        key='routing.graphhopper_api_key',
        value=None,
        secret_value='v1:replacement',
        updated_at=datetime.now(timezone.utc),
    )
    encryption = Mock(spec=AppSettingsEncryption)
    encryption.encrypt.return_value = 'v1:replacement'
    cache = Mock(spec=AppSettingsCache)
    service = _service(db, encryption=encryption, cache=cache)

    record = service.update_setting(
        'routing.graphhopper_api_key',
        'replacement',
        updated_by=None,
    )

    encryption.encrypt.assert_called_once_with('replacement')
    encryption.decrypt.assert_not_called()
    db.execute.assert_called_once()
    statement = db.execute.call_args.args[0]
    assert 'ON CONFLICT' in str(statement)
    db.get.assert_not_called()
    db.expire_all.assert_called_once_with()
    assert record.value is None
    assert record.is_configured is True
    cache.invalidate.assert_called_once()


def test_cache_does_not_repopulate_a_value_read_before_invalidation() -> None:
    cache = AppSettingsCache()
    scope = 123
    key = 'theme.darkmode'

    cache_hit, _value, generation = cache.read(scope, key)
    cache.invalidate(scope, key)
    stored = cache.set_if_generation(scope, key, 'stale', generation)
    cache_hit_after, _value_after, _generation_after = cache.read(scope, key)

    assert cache_hit is False
    assert stored is False
    assert cache_hit_after is False


def _definition_for_type(value_type: SettingValueType) -> SettingDefinition:
    defaults = {
        SettingValueType.ENUM: 'default',
        SettingValueType.STRING: 'default',
        SettingValueType.BOOLEAN: False,
        SettingValueType.INTEGER: 1,
        SettingValueType.OBJECT: {},
    }
    validation = (
        {'allowed_values': ['default']} if value_type == SettingValueType.ENUM else None
    )
    return SettingDefinition(
        key=f'test.{value_type.value}',
        value_type=value_type,
        visibility=SettingVisibility.ADMIN,
        sensitive=False,
        runtime_safe=True,
        description='Test setting.',
        default_value=defaults[value_type],
        validation=validation,
    )


@pytest.mark.parametrize(
    ('value_type', 'stored_value'),
    [
        (SettingValueType.ENUM, 'legacy-not-in-allowed-values'),
        (SettingValueType.STRING, 'stored string'),
        (SettingValueType.BOOLEAN, True),
        (SettingValueType.INTEGER, 42),
        (SettingValueType.OBJECT, {'stored': True}),
    ],
)
def test_structurally_valid_stored_values_are_not_revalidated(
    value_type: SettingValueType,
    stored_value,
) -> None:
    definition = _definition_for_type(value_type)
    registry = AppSettingsRegistry((definition,))
    db = Mock(spec=Session)
    db.get_bind.return_value = object()
    db.get.return_value = AppSetting(
        key=definition.key,
        value=stored_value,
        updated_at=datetime.now(timezone.utc),
    )
    service = AppSettingsService(
        db,
        AppSettingsEncryption(None),
        registry=registry,
        cache=AppSettingsCache(),
    )

    assert service.get_value(definition.key) == stored_value


@pytest.mark.parametrize(
    ('value_type', 'stored_value'),
    [
        (SettingValueType.ENUM, 1),
        (SettingValueType.STRING, {'not': 'a string'}),
        (SettingValueType.BOOLEAN, 1),
        (SettingValueType.INTEGER, True),
        (SettingValueType.OBJECT, 'not an object'),
    ],
)
def test_structurally_invalid_stored_values_raise_data_error(
    value_type: SettingValueType,
    stored_value,
) -> None:
    definition = _definition_for_type(value_type)
    registry = AppSettingsRegistry((definition,))
    db = Mock(spec=Session)
    db.get_bind.return_value = object()
    db.get.return_value = AppSetting(
        key=definition.key,
        value=stored_value,
        updated_at=datetime.now(timezone.utc),
    )
    service = AppSettingsService(
        db,
        AppSettingsEncryption(None),
        registry=registry,
        cache=AppSettingsCache(),
    )

    with pytest.raises(StoredAppSettingError):
        service.get_value(definition.key)


def test_secret_payload_must_be_text_before_decryption() -> None:
    db = Mock(spec=Session)
    db.get_bind.return_value = object()
    db.get.return_value = AppSetting(
        key='routing.graphhopper_api_key',
        value=None,
        secret_value=123,  # type: ignore[arg-type]
        updated_at=datetime.now(timezone.utc),
    )
    encryption = Mock(spec=AppSettingsEncryption)
    service = AppSettingsService(
        db,
        encryption,
        cache=AppSettingsCache(),
    )

    with pytest.raises(StoredAppSettingError):
        service.get_value('routing.graphhopper_api_key')
    encryption.decrypt.assert_not_called()
