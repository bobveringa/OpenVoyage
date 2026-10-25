from unittest.mock import Mock

import pytest

from core.app_settings import (
    FLIGHTS_FLIGHTAWARE_BASE_URL_KEY,
    FLIGHTS_PROVIDER_KEY,
    FLIGHTS_FLIGHTAWARE_API_KEY,
    app_settings_registry,
)
from core.app_settings_encryption import AppSettingsEncryptionError
from services.app_settings_service import StoredAppSettingError
from services.flight_providers import FlightProviderFactory
from services.flight_providers import FlightAwareFlightProvider


def settings_reader():
    values = {
        key: app_settings_registry.require(key).default_value
        for key in (
            FLIGHTS_PROVIDER_KEY,
            FLIGHTS_FLIGHTAWARE_BASE_URL_KEY,
            FLIGHTS_FLIGHTAWARE_API_KEY,
        )
    }
    reader = Mock()
    reader.get_value.side_effect = values.__getitem__
    return reader, values


@pytest.mark.parametrize('selection', ['none', 'aerodatabox', 'unknown', '', None, 42])
def test_disabled_or_invalid_selection_does_not_read_credentials(selection):
    reader, values = settings_reader()
    values[FLIGHTS_PROVIDER_KEY] = selection
    assert FlightProviderFactory().create_flight_provider(reader) is None
    reader.get_value.assert_called_once_with(FLIGHTS_PROVIDER_KEY)


def test_default_disables_lookup_even_with_existing_key():
    reader, values = settings_reader()
    values[FLIGHTS_FLIGHTAWARE_API_KEY] = 'existing-secret'

    assert FlightProviderFactory().create_flight_provider(reader) is None
    reader.get_value.assert_called_once_with(FLIGHTS_PROVIDER_KEY)
    assert values[FLIGHTS_FLIGHTAWARE_API_KEY] == 'existing-secret'


def test_flightaware_selection_reads_only_its_credentials_and_updates_at_runtime():
    reader, values = settings_reader()
    values[FLIGHTS_PROVIDER_KEY] = ' FlightAware '
    values[FLIGHTS_FLIGHTAWARE_API_KEY] = 'private-key'
    factory = FlightProviderFactory()
    provider = factory.create_flight_provider(reader)
    assert isinstance(provider, FlightAwareFlightProvider)
    assert provider.is_configured()
    assert provider.base_url == 'https://aeroapi.flightaware.com/aeroapi'
    values[FLIGHTS_FLIGHTAWARE_API_KEY] = None
    assert not factory.create_flight_provider(reader).is_configured()
    values[FLIGHTS_FLIGHTAWARE_BASE_URL_KEY] = 'ftp://invalid.test'
    assert factory.create_flight_provider(reader) is None


def test_flightaware_factory_passes_local_airport_resolver():
    reader, values = settings_reader()
    values[FLIGHTS_PROVIDER_KEY] = 'flightaware'
    resolver = Mock()
    provider = FlightProviderFactory(airport_resolver=resolver).create_flight_provider(reader)
    assert provider._airport_resolver is resolver


def test_explicit_selection_uses_existing_key_and_runtime_changes_work():
    reader, values = settings_reader()
    factory = FlightProviderFactory()
    values[FLIGHTS_FLIGHTAWARE_API_KEY] = 'existing-secret'
    values[FLIGHTS_PROVIDER_KEY] = 'flightaware'
    first = factory.create_flight_provider(reader)
    assert isinstance(first, FlightAwareFlightProvider)
    assert first.name == 'flightaware'
    assert first.is_configured()
    assert first.base_url == 'https://aeroapi.flightaware.com/aeroapi'

    values[FLIGHTS_PROVIDER_KEY] = ' FlightAware '
    values[FLIGHTS_FLIGHTAWARE_BASE_URL_KEY] = 'https://proxy.example.test/api/'
    values[FLIGHTS_FLIGHTAWARE_API_KEY] = None
    second = factory.create_flight_provider(reader)
    assert isinstance(second, FlightAwareFlightProvider)
    assert second.base_url == 'https://proxy.example.test/api'
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
        (FLIGHTS_FLIGHTAWARE_BASE_URL_KEY, 5),
        (FLIGHTS_FLIGHTAWARE_BASE_URL_KEY, 'ftp://example.test'),
        (FLIGHTS_FLIGHTAWARE_API_KEY, {}),
    ],
)
def test_invalid_stored_settings_disable_lookup(key, value):
    reader, values = settings_reader()
    values[FLIGHTS_PROVIDER_KEY] = 'flightaware'
    values[key] = value
    assert FlightProviderFactory().create_flight_provider(reader) is None
