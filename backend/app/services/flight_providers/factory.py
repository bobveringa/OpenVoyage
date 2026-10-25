"""Build flight adapters from server-side admin settings."""

import logging
from collections.abc import Callable
from typing import Protocol
from models.api.planning import Endpoint

from core.app_settings import (
    FLIGHTS_FLIGHTAWARE_BASE_URL_KEY,
    FLIGHTS_FLIGHTAWARE_API_KEY,
    FLIGHTS_PROVIDER_KEY,
)
from core.app_settings_encryption import AppSettingsEncryptionError
from core.setting_validators.flights import (
    validate_flight_base_url,
)
from services.app_settings_service import StoredAppSettingError
from services.flight_providers.flight_provider import FlightProviderBase
from services.flight_providers.flightaware_flight_provider import (
    FlightAwareFlightProvider,
)

logger = logging.getLogger(__name__)


class AppSettingsReader(Protocol):
    def get_value(self, key: str) -> object: ...


class FlightProviderFactory:
    """Read settings per request so existing runtime key updates keep working.

    Add another adapter here and register its settings in core.app_settings.
    Itinerary services only depend on FlightProviderBase and FlightLookup.
    """

    def __init__(
        self, *, airport_resolver: Callable[[str], Endpoint | None] | None = None
    ):
        self.airport_resolver = airport_resolver

    def create_flight_provider(
        self, app_settings: AppSettingsReader
    ) -> FlightProviderBase | None:
        try:
            selected = app_settings.get_value(FLIGHTS_PROVIDER_KEY)
            if not isinstance(selected, str):
                return None
            name = selected.strip().lower()
            if name in ('', 'none'):
                return None
            if name == FlightAwareFlightProvider.name:
                base_url = app_settings.get_value(FLIGHTS_FLIGHTAWARE_BASE_URL_KEY)
                api_key = app_settings.get_value(FLIGHTS_FLIGHTAWARE_API_KEY)
                if not isinstance(base_url, str) or (
                    api_key is not None and not isinstance(api_key, str)
                ):
                    return None
                try:
                    validate_flight_base_url(base_url)
                except ValueError:
                    logger.error(
                        'Flight lookup unavailable: invalid provider endpoint settings'
                    )
                    return None
                return FlightAwareFlightProvider(
                    api_key=api_key,
                    base_url=base_url,
                    airport_resolver=self.airport_resolver,
                )
            logger.error('Flight provider setting contains an unsupported value')
            return None
        except AppSettingsEncryptionError, StoredAppSettingError:
            logger.error('Flight lookup unavailable: stored settings could not be read')
            return None
