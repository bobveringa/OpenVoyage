"""Uncached flight settings and cross-process configuration serialization."""

import json
from dataclasses import dataclass, field

from sqlalchemy import select, text

from core.app_settings import app_settings_registry
from models.database.settings import AppSetting

# Fixed two-int PostgreSQL namespace: ASCII 'OVFM', then resource number.
# 1 is reserved for monitor ownership; 2 serializes flight settings changes.
FLIGHT_MONITOR_LOCK_KEY = (0x4F56464D, 1)
FLIGHT_SETTINGS_LOCK_KEY = (0x4F56464D, 2)


def lock_flight_settings(db):
    """Hold until transaction completion; always take before trip/flight locks."""
    with db.no_autoflush:
        db.execute(
            text('SELECT pg_advisory_xact_lock(:namespace, :resource)'),
            dict(zip(('namespace', 'resource'), FLIGHT_SETTINGS_LOCK_KEY)),
        )


@dataclass(frozen=True, repr=False)
class FlightSettingsSnapshot:
    # Canonical JSON makes the raw snapshot immutable, including nested values.
    # Absence differs from a row containing the default. Never log this object.
    rows: tuple[tuple[str, str, str | None], ...] = field(repr=False)

    @classmethod
    def load(cls, db):
        keys = [
            d.key
            for d in app_settings_registry.definitions
            if d.key.startswith('flights.')
        ]
        with db.no_autoflush:
            rows = db.execute(
                select(AppSetting.key, AppSetting.value, AppSetting.secret_value)
                .where(AppSetting.key.in_(keys))
                .order_by(AppSetting.key)
            ).all()
        return cls(
            tuple(
                (key, json.dumps(value, sort_keys=True), secret)
                for key, value, secret in rows
            )
        )

    def reader(self, db):
        return FlightSettingsReader(self, db)


class FlightSettingsReader:
    """Resolve only requested keys, using the normal validation/decryption rules."""

    def __init__(self, snapshot, db):
        from services.app_settings_service import AppSettingsService

        self._service = AppSettingsService(db)
        self._rows = {
            key: AppSetting(key=key, value=json.loads(value), secret_value=secret)
            for key, value, secret in snapshot.rows
        }

    def get_value(self, key):
        definition = app_settings_registry.get(key)
        if definition is None or not key.startswith('flights.'):
            raise KeyError(key)
        return self._service._resolve_value(definition, self._rows.get(key))


def configuration_is_current(db, snapshot):
    """Serialize comparison with admin recovery, without decrypting any secrets.

    READ COMMITTED gives the post-lock statement a fresh snapshot. The caller
    keeps this transaction (and its settings lock) through result application.
    """
    lock_flight_settings(db)
    return FlightSettingsSnapshot.load(db) == snapshot
