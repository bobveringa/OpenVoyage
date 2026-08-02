from __future__ import annotations

from types import SimpleNamespace

from services.route_providers import GraphHopperRouteProvider, RouteProviderFactory


def _settings(
    *,
    routing_provider: str,
    graphhopper_api_key: str = 'test-key',
    graphhopper_base_url: str = 'https://example.test/api/1',
) -> SimpleNamespace:
    return SimpleNamespace(
        ROUTING_PROVIDER=routing_provider,
        GRAPHHOPPER_API_KEY=graphhopper_api_key,
        GRAPHHOPPER_BASE_URL=graphhopper_base_url,
    )


def test_create_routing_provider_returns_none_for_disabled_provider() -> None:
    factory = RouteProviderFactory(_settings(routing_provider='none'))

    assert factory.create_routing_provider() is None


def test_create_routing_provider_returns_none_for_unknown_provider() -> None:
    factory = RouteProviderFactory(_settings(routing_provider='unknown'))

    assert factory.create_routing_provider() is None


def test_create_routing_provider_builds_graphhopper_provider() -> None:
    factory = RouteProviderFactory(_settings(routing_provider=' GraphHopper '))

    active_provider = factory.create_routing_provider()

    assert active_provider is not None
    assert active_provider.name == 'graphhopper'
    assert isinstance(active_provider, GraphHopperRouteProvider)
    assert active_provider.api_key == 'test-key'
    assert active_provider.base_url == 'https://example.test/api/1'
