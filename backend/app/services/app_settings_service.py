from __future__ import annotations

import copy
import threading
import time
import uuid
from dataclasses import dataclass
from datetime import datetime
from typing import Any

from sqlalchemy import delete, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from core.app_settings import (
    AppSettingValidationError,
    AppSettingsRegistry,
    SettingDefinition,
    SettingValueType,
    SettingVisibility,
    app_settings_registry,
)
from core.app_settings_encryption import AppSettingsEncryption
from models.database.base import utcnow
from models.database.settings import AppSetting


class AppSettingNotFoundError(LookupError):
    """Raised when a setting is unknown or not exposed to admins."""


class StoredAppSettingError(RuntimeError):
    """Raised when a stored row does not match its registry payload shape."""


@dataclass(frozen=True)
class AdminSettingRecord:
    key: str
    value_type: SettingValueType
    visibility: SettingVisibility
    description: str
    value: Any | None
    default_value: Any | None
    runtime_safe: bool
    validation: dict[str, Any] | None
    is_configured: bool
    updated_at: datetime | None


@dataclass(frozen=True)
class AdminSettingsRecordList:
    settings: list[AdminSettingRecord]
    updated_at: datetime | None


@dataclass(frozen=True)
class PublicSettingsRecord:
    settings: dict[str, Any]
    updated_at: datetime | None


@dataclass(frozen=True)
class _CacheEntry:
    value: Any
    expires_at: float


class AppSettingsCache:
    """Small process-local cache that never retains a database session.

    Each cached setting has a generation counter. ``read`` returns the
    generation that was current when it checked the cache. A caller that has
    to load a missing value from the database can then use
    ``set_if_generation`` to cache it only if the setting was not invalidated
    meanwhile. This prevents an in-flight read of an old database value from
    repopulating the cache after an admin update, reset, or delete.

    Generations protect only this process; they do not coordinate cache state
    between separate backend processes.
    """

    def __init__(self, ttl_seconds: float = 60.0) -> None:
        self.ttl_seconds = ttl_seconds
        self._values: dict[tuple[int, str], _CacheEntry] = {}
        self._generations: dict[tuple[int, str], int] = {}
        self._lock = threading.Lock()

    def read(self, scope: int, key: str) -> tuple[bool, Any, int]:
        """Return ``(cache_hit, value, generation)`` for a setting.

        On a miss, callers should retain the returned generation and pass it
        to ``set_if_generation`` after resolving the value outside the lock.
        """
        cache_key = (scope, key)
        now = time.monotonic()
        with self._lock:
            generation = self._generations.get(cache_key, 0)
            entry = self._values.get(cache_key)
            if entry is None:
                return False, None, generation
            if entry.expires_at <= now:
                self._values.pop(cache_key, None)
                return False, None, generation
            return True, copy.deepcopy(entry.value), generation

    def set_if_generation(
        self,
        scope: int,
        key: str,
        value: Any,
        generation: int,
    ) -> bool:
        """Cache a resolved value unless invalidation occurred after ``read``.

        Database access intentionally happens outside the cache lock. If a
        concurrent settings mutation invalidates this key while that access is
        in progress, its generation changes and this method returns ``False``
        rather than caching the stale result.
        """
        cache_key = (scope, key)
        with self._lock:
            if self._generations.get(cache_key, 0) != generation:
                return False
            self._values[cache_key] = _CacheEntry(
                value=copy.deepcopy(value),
                expires_at=time.monotonic() + self.ttl_seconds,
            )
            return True

    def invalidate(self, scope: int, key: str) -> None:
        """Remove a setting and advance its generation for in-flight readers."""
        cache_key = (scope, key)
        with self._lock:
            self._values.pop(cache_key, None)
            self._generations[cache_key] = self._generations.get(cache_key, 0) + 1

    def clear(self) -> None:
        """Remove all values and invalidate any in-flight cache fills."""
        with self._lock:
            cache_keys = self._values.keys() | self._generations.keys()
            for cache_key in cache_keys:
                self._generations[cache_key] = self._generations.get(cache_key, 0) + 1
            self._values.clear()


app_settings_cache = AppSettingsCache()


class AppSettingsService:
    def __init__(
        self,
        db: Session,
        encryption: AppSettingsEncryption,
        *,
        registry: AppSettingsRegistry = app_settings_registry,
        cache: AppSettingsCache = app_settings_cache,
    ) -> None:
        self.db = db
        self.encryption = encryption
        self.registry = registry
        self.cache = cache
        self._cache_scope = self._resolve_cache_scope()

    def list_admin_settings(self) -> AdminSettingsRecordList:
        definitions = tuple(
            definition
            for definition in self.registry.definitions
            if definition.visibility
            in (SettingVisibility.PUBLIC, SettingVisibility.ADMIN)
        )
        rows = self._rows_for_definitions(definitions)
        records = [
            self._admin_record(definition, rows.get(definition.key))
            for definition in definitions
        ]
        updated_at = max(
            (record.updated_at for record in records if record.updated_at is not None),
            default=None,
        )
        return AdminSettingsRecordList(settings=records, updated_at=updated_at)

    def get_admin_setting(self, key: str) -> AdminSettingRecord:
        definition = self._require_admin_definition(key)
        return self._admin_record(definition, self.db.get(AppSetting, key))

    def update_setting(
        self,
        key: str,
        value: Any,
        updated_by: uuid.UUID | None,
    ) -> AdminSettingRecord:
        definition = self._require_admin_definition(key)
        validated_value = self.registry.validate_value(definition, value)

        if definition.value_type == SettingValueType.SECRET:
            stored_value = None
            stored_secret = self.encryption.encrypt(validated_value)
        else:
            stored_value = validated_value
            stored_secret = None

        now = utcnow()
        insert_statement = insert(AppSetting).values(
            key=key,
            value=stored_value,
            secret_value=stored_secret,
            updated_by=updated_by,
            created_at=now,
            updated_at=now,
        )
        upsert_statement = insert_statement.on_conflict_do_update(
            index_elements=[AppSetting.key],
            set_={
                'value': insert_statement.excluded.value,
                'secret_value': insert_statement.excluded.secret_value,
                'updated_by': insert_statement.excluded.updated_by,
                'updated_at': insert_statement.excluded.updated_at,
            },
        )
        persisted_row = self.db.execute(
            upsert_statement.returning(AppSetting)
        ).scalar_one()
        response = self._admin_record(definition, persisted_row)
        self.db.commit()
        self.db.expire_all()
        self.cache.invalidate(self._cache_scope, key)
        return response

    def reset_setting(self, key: str) -> AdminSettingRecord:
        definition = self._require_admin_definition(key)
        self.db.execute(delete(AppSetting).where(AppSetting.key == key))
        self.db.commit()
        self.db.expire_all()
        self.cache.invalidate(self._cache_scope, key)
        return self._admin_record(definition, None)

    def get_value(self, key: str) -> Any:
        definition = self.registry.get(key)
        if definition is None:
            raise AppSettingNotFoundError('Setting not found')

        cache_hit, cached_value, generation = self.cache.read(
            self._cache_scope,
            key,
        )
        if cache_hit:
            return cached_value

        value = self._resolve_value(definition, self.db.get(AppSetting, key))
        self.cache.set_if_generation(
            self._cache_scope,
            key,
            value,
            generation,
        )
        return copy.deepcopy(value)

    def get_public_settings(self) -> PublicSettingsRecord:
        definitions = tuple(
            definition
            for definition in self.registry.definitions
            if definition.visibility == SettingVisibility.PUBLIC
            and not definition.sensitive
        )
        rows = self._rows_for_definitions(definitions)
        values: dict[str, Any] = {}
        updated_timestamps: list[datetime] = []

        for definition in definitions:
            row = rows.get(definition.key)
            values[definition.key] = self._resolve_value(definition, row)
            if row is not None:
                updated_timestamps.append(row.updated_at)

        return PublicSettingsRecord(
            settings=values,
            updated_at=max(updated_timestamps, default=None),
        )

    def _require_admin_definition(self, key: str) -> SettingDefinition:
        definition = self.registry.get(key)
        if definition is None or definition.visibility == SettingVisibility.INTERNAL:
            raise AppSettingNotFoundError('Setting not found')
        return definition

    def _rows_for_definitions(
        self,
        definitions: tuple[SettingDefinition, ...],
    ) -> dict[str, AppSetting]:
        keys = [definition.key for definition in definitions]
        if not keys:
            return {}
        rows = self.db.execute(
            select(AppSetting).where(AppSetting.key.in_(keys))
        ).scalars()
        return {row.key: row for row in rows}

    def _resolve_value(
        self,
        definition: SettingDefinition,
        row: AppSetting | None,
    ) -> Any:
        if row is None:
            return copy.deepcopy(definition.default_value)
        self._validate_row_shape(definition, row)
        if definition.value_type == SettingValueType.SECRET:
            assert row.secret_value is not None
            return self.encryption.decrypt(row.secret_value)
        return copy.deepcopy(row.value)

    def _admin_record(
        self,
        definition: SettingDefinition,
        row: AppSetting | None,
    ) -> AdminSettingRecord:
        if row is not None:
            self._validate_row_shape(definition, row)

        is_secret = definition.value_type == SettingValueType.SECRET
        value = None
        if not is_secret:
            value = (
                copy.deepcopy(row.value)
                if row is not None
                else copy.deepcopy(definition.default_value)
            )

        return AdminSettingRecord(
            key=definition.key,
            value_type=definition.value_type,
            visibility=definition.visibility,
            description=definition.description,
            value=value,
            default_value=(
                None if is_secret else copy.deepcopy(definition.default_value)
            ),
            runtime_safe=definition.runtime_safe,
            validation=(
                dict(definition.validation)
                if definition.validation is not None
                else None
            ),
            is_configured=row is not None,
            updated_at=row.updated_at if row is not None else None,
        )

    def _validate_row_shape(
        self,
        definition: SettingDefinition,
        row: AppSetting,
    ) -> None:
        has_value = row.value is not None
        has_secret = row.secret_value is not None
        valid_exactly_one = has_value != has_secret
        expects_secret = definition.value_type == SettingValueType.SECRET
        valid_for_registry = has_secret if expects_secret else has_value
        if not valid_exactly_one or not valid_for_registry:
            raise StoredAppSettingError('Stored app setting is invalid')

        if expects_secret:
            if not isinstance(row.secret_value, str):
                raise StoredAppSettingError('Stored app setting is invalid')
            return

        value = row.value
        value_type = definition.value_type
        if value_type in (SettingValueType.STRING, SettingValueType.ENUM):
            structurally_valid = isinstance(value, str)
        elif value_type == SettingValueType.BOOLEAN:
            structurally_valid = isinstance(value, bool)
        elif value_type == SettingValueType.INTEGER:
            structurally_valid = isinstance(value, int) and not isinstance(value, bool)
        elif value_type == SettingValueType.OBJECT:
            structurally_valid = isinstance(value, dict)
        else:
            structurally_valid = False
        if not structurally_valid:
            raise StoredAppSettingError('Stored app setting is invalid')

    def _resolve_cache_scope(self) -> int:
        bind = self.db.get_bind()
        engine = getattr(bind, 'engine', bind)
        return id(engine)


__all__ = [
    'AdminSettingRecord',
    'AdminSettingsRecordList',
    'AppSettingNotFoundError',
    'AppSettingsCache',
    'AppSettingsService',
    'PublicSettingsRecord',
    'StoredAppSettingError',
    'app_settings_cache',
    'AppSettingValidationError',
]
