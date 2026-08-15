from __future__ import annotations

from dataclasses import dataclass

from models.database.itinerary import ItineraryTravelLeg
from models.database.travel import TravelMode


@dataclass(frozen=True)
class RouteResponse:
    geometry_geojson: dict
    distance_meters: int | None
    duration_seconds: int | None


class RouteProviderError(Exception):
    """Raised when a route provider cannot produce a route."""


class RouteProviderConfigurationError(RouteProviderError):
    """Raised when a provider is selected but not configured."""


class RouteProviderResponseError(RouteProviderError):
    """Raised when a provider response is missing expected route data."""


class RouteProviderBase:
    name: str
    supported_travel_modes: frozenset[TravelMode] = frozenset()

    def can_route(self, leg: ItineraryTravelLeg) -> bool:
        return self.is_configured() and self.supports_travel_mode(
            TravelMode(leg.travel_mode)
        )

    def supports_travel_mode(self, travel_mode: TravelMode) -> bool:
        return travel_mode in self.supported_travel_modes

    def is_configured(self) -> bool:
        raise NotImplementedError

    def get_route(
        self,
        coordinates_from: tuple[float, float],
        coordinates_to: tuple[float, float],
        travel_mode: TravelMode,
    ) -> RouteResponse:
        raise NotImplementedError
