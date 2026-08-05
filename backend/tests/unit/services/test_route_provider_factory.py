from __future__ import annotations

from unittest.mock import Mock

from core.app_settings import (
    ROUTING_GRAPHHOPPER_API_KEY,
    ROUTING_GRAPHHOPPER_BASE_URL_KEY,
    ROUTING_PROVIDER_KEY,
)
from core.app_settings_encryption import AppSettingsEncryptionError
from services.route_providers import GraphHopperRouteProvider, RouteProviderFactory


def _settings_reader(
    *,
    routing_provider: str,
    graphhopper_api_key: str | None = 'test-key',
    graphhopper_base_url: str = 'https://example.test/api/1',
):
    values = {
        ROUTING_PROVIDER_KEY: routing_provider,
        ROUTING_GRAPHHOPPER_API_KEY: graphhopper_api_key,
        ROUTING_GRAPHHOPPER_BASE_URL_KEY: graphhopper_base_url,
    }
    reader = Mock()
    reader.get_value.side_effect = values.__getitem__
    return reader


def test_create_routing_provider_returns_none_for_disabled_provider() -> None:
    factory = RouteProviderFactory()
    settings_reader = _settings_reader(routing_provider='none')

    assert factory.create_routing_provider(settings_reader) is None
    settings_reader.get_value.assert_called_once_with(ROUTING_PROVIDER_KEY)


def test_create_routing_provider_returns_none_for_unknown_provider() -> None:
    factory = RouteProviderFactory()

    assert (
        factory.create_routing_provider(_settings_reader(routing_provider='unknown'))
        is None
    )


def test_create_routing_provider_builds_graphhopper_provider() -> None:
    factory = RouteProviderFactory()

    active_provider = factory.create_routing_provider(
        _settings_reader(routing_provider=' GraphHopper ')
    )

    assert active_provider is not None
    assert active_provider.name == 'graphhopper'
    assert isinstance(active_provider, GraphHopperRouteProvider)
    assert active_provider.api_key == 'test-key'
    assert active_provider.base_url == 'https://example.test/api/1'


def test_create_routing_provider_caches_unavailable_state() -> None:
    factory = RouteProviderFactory()
    first_reader = _settings_reader(
        routing_provider='graphhopper',
        graphhopper_api_key=None,
    )

    assert factory.create_routing_provider(first_reader) is None
    assert (
        factory.create_routing_provider(_settings_reader(routing_provider='none'))
        is None
    )
    assert first_reader.get_value.call_count == 3


def test_create_routing_provider_caches_provider_instance() -> None:
    factory = RouteProviderFactory()
    first = factory.create_routing_provider(
        _settings_reader(routing_provider='graphhopper')
    )
    second = factory.create_routing_provider(
        _settings_reader(
            routing_provider='graphhopper',
            graphhopper_api_key='replacement',
        )
    )

    assert first is second
    assert isinstance(second, GraphHopperRouteProvider)
    assert second.api_key == 'test-key'


def test_decryption_error_disables_routing() -> None:
    factory = RouteProviderFactory()
    reader = _settings_reader(routing_provider='graphhopper')

    def get_value(key: str):
        if key == ROUTING_GRAPHHOPPER_API_KEY:
            raise AppSettingsEncryptionError(
                'App settings encryption is not configured'
            )
        return {
            ROUTING_PROVIDER_KEY: 'graphhopper',
            ROUTING_GRAPHHOPPER_BASE_URL_KEY: 'https://example.test/api/1',
        }[key]

    reader.get_value.side_effect = get_value

    assert factory.create_routing_provider(reader) is None
