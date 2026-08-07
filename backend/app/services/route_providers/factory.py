from __future__ import annotations

import logging
import threading
from typing import Protocol

from core.app_settings import (
    ROUTING_GRAPHHOPPER_API_KEY,
    ROUTING_GRAPHHOPPER_BASE_URL_KEY,
    ROUTING_PROVIDER_KEY,
)
from core.app_settings_encryption import AppSettingsEncryptionError
from services.app_settings_service import StoredAppSettingError
from services.route_providers.graphhopper_route_provider import GraphHopperRouteProvider
from services.route_providers.route_provider import RouteProviderBase


logger = logging.getLogger(__name__)


class  AppSettingsReader(Protocol):
    def get_value(self, key: str) -> object: ...


class RouteProviderFactory:
    """Lazily construct and retain one route provider per factory/process."""

    def __init__(self) -> None:
        self._provider: RouteProviderBase | None = None
        self._initialized = False
        self._lock = threading.Lock()

    def create_routing_provider(
        self,
        app_settings: AppSettingsReader,
    ) -> RouteProviderBase | None:
        if self._initialized:
            return self._provider

        with self._lock:
            if self._initialized:
                return self._provider
            self._provider = self._build_provider(app_settings)
            self._initialized = True
            return self._provider

    def reset_cache(self) -> None:
        """Clear process state for test isolation or explicit process teardown."""
        with self._lock:
            self._provider = None
            self._initialized = False

    def _build_provider(
        self,
        app_settings: AppSettingsReader,
    ) -> RouteProviderBase | None:
        try:
            provider_value = app_settings.get_value(ROUTING_PROVIDER_KEY)
        except AppSettingsEncryptionError, StoredAppSettingError:
            logger.error(
                'Routing is unavailable because a stored app setting could not be read'
            )
            return None
        if not isinstance(provider_value, str):
            logger.error('Routing provider setting has an invalid stored type')
            return None

        provider_name = provider_value.strip().lower()
        if provider_name in ('', 'none'):
            return None
        if provider_name != GraphHopperRouteProvider.name:
            logger.error('Routing provider setting contains an unsupported value')
            return None

        try:
            base_url = app_settings.get_value(ROUTING_GRAPHHOPPER_BASE_URL_KEY)
            api_key = app_settings.get_value(ROUTING_GRAPHHOPPER_API_KEY)
        except AppSettingsEncryptionError, StoredAppSettingError:
            logger.error(
                'Routing is unavailable because a stored app setting could not be read'
            )
            return None

        if not isinstance(base_url, str):
            logger.error('GraphHopper base URL has an invalid stored type')
            return None
        if api_key is None:
            return None
        if not isinstance(api_key, str):
            logger.error('GraphHopper API key has an invalid stored type')
            return None

        return GraphHopperRouteProvider(api_key=api_key, base_url=base_url)
