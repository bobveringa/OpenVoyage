from __future__ import annotations

from typing import Protocol

from services.route_providers.graphhopper_route_provider import GraphHopperRouteProvider
from services.route_providers.route_provider import RouteProviderBase


class RouteProviderSettings(Protocol):
    ROUTING_PROVIDER: str
    GRAPHHOPPER_API_KEY: str
    GRAPHHOPPER_BASE_URL: str


class RouteProviderFactory:
    def __init__(self, app_settings: RouteProviderSettings) -> None:
        self._settings = app_settings

    def create_routing_provider(self) -> RouteProviderBase | None:
        provider_name = self._settings.ROUTING_PROVIDER.strip().lower()
        if provider_name in ('', 'none'):
            return None

        if provider_name == GraphHopperRouteProvider.name:
            return GraphHopperRouteProvider(
                api_key=self._settings.GRAPHHOPPER_API_KEY,
                base_url=self._settings.GRAPHHOPPER_BASE_URL,
            )
        return None
