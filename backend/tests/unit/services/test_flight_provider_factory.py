from unittest.mock import Mock

import pytest

from core.app_settings import (
    FLIGHTS_AERODATABOX_BASE_URL_KEY,
    FLIGHTS_AERODATABOX_RAPIDAPI_HOST_KEY,
    FLIGHTS_PROVIDER_KEY,
    FLIGHTS_RAPIDAPI_API_KEY,
    app_settings_registry,
)
from core.app_settings_encryption import AppSettingsEncryptionError
from services.app_settings_service import StoredAppSettingError
from services.flight_providers import AeroDataBoxFlightProvider, FlightProviderFactory


def settings_reader():
    values = {
        key: app_settings_registry.require(key).default_value
        for key in (
            FLIGHTS_PROVIDER_KEY,
            FLIGHTS_AERODATABOX_BASE_URL_KEY,
            FLIGHTS_AERODATABOX_RAPIDAPI_HOST_KEY,
            FLIGHTS_RAPIDAPI_API_KEY,
        )
    }
    reader = Mock()
    reader.get_value.side_effect = values.__getitem__
    return reader, values


@pytest.mark.parametrize('selection', ['none', 'unknown', '', None, 42])
def test_disabled_or_invalid_selection_does_not_read_credentials(selection):
    reader, values = settings_reader()
    values[FLIGHTS_PROVIDER_KEY] = selection
    assert FlightProviderFactory().create_flight_provider(reader) is None
    reader.get_value.assert_called_once_with(FLIGHTS_PROVIDER_KEY)


def test_default_disables_lookup_even_with_existing_key():
    reader, values = settings_reader()
    values[FLIGHTS_RAPIDAPI_API_KEY] = 'existing-secret'

    assert FlightProviderFactory().create_flight_provider(reader) is None
    reader.get_value.assert_called_once_with(FLIGHTS_PROVIDER_KEY)
    assert values[FLIGHTS_RAPIDAPI_API_KEY] == 'existing-secret'


def test_explicit_selection_uses_existing_key_and_runtime_changes_work():
    reader, values = settings_reader()
    factory = FlightProviderFactory()
    values[FLIGHTS_RAPIDAPI_API_KEY] = 'existing-secret'
    values[FLIGHTS_PROVIDER_KEY] = 'aerodatabox'
    first = factory.create_flight_provider(reader)
    assert isinstance(first, AeroDataBoxFlightProvider)
    assert first.name == 'aerodatabox'
    assert first.is_configured()
    assert first.base_url == 'https://aerodatabox.p.rapidapi.com'

    values[FLIGHTS_PROVIDER_KEY] = ' AeroDataBox '
    values[FLIGHTS_AERODATABOX_BASE_URL_KEY] = 'https://proxy.example.test/api/'
    values[FLIGHTS_AERODATABOX_RAPIDAPI_HOST_KEY] = 'custom.example.test'
    values[FLIGHTS_RAPIDAPI_API_KEY] = None
    second = factory.create_flight_provider(reader)
    assert isinstance(second, AeroDataBoxFlightProvider)
    assert second.base_url == 'https://proxy.example.test/api'
    assert second.rapidapi_host == 'custom.example.test'
    assert not second.is_configured()

    values[FLIGHTS_PROVIDER_KEY] = 'none'
    assert factory.create_flight_provider(reader) is None


@pytest.mark.parametrize('error', [AppSettingsEncryptionError, StoredAppSettingError])
def test_unreadable_settings_disable_lookup_without_exposing_secrets(error, caplog):
    reader, _ = settings_reader()
    reader.get_value.side_effect = error('private-secret')
    assert FlightProviderFactory().create_flight_provider(reader) is None
    assert 'private-secret' not in caplog.text


@pytest.mark.parametrize(
    'key,value',
    [
        (FLIGHTS_AERODATABOX_BASE_URL_KEY, 5),
        (FLIGHTS_AERODATABOX_BASE_URL_KEY, 'ftp://example.test'),
        (FLIGHTS_AERODATABOX_RAPIDAPI_HOST_KEY, None),
        (FLIGHTS_AERODATABOX_RAPIDAPI_HOST_KEY, 'bad\r\nHost: injected'),
        (FLIGHTS_RAPIDAPI_API_KEY, {}),
    ],
)
def test_invalid_stored_settings_disable_lookup(key, value):
    reader, values = settings_reader()
    values[FLIGHTS_PROVIDER_KEY] = 'aerodatabox'
    values[key] = value
    assert FlightProviderFactory().create_flight_provider(reader) is None
