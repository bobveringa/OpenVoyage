from __future__ import annotations

import uuid
from enum import Enum

from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload

from models.database.itinerary import (
    ItineraryStop,
    ItineraryTravelLeg,
    ItineraryTravelLegRoute,
    ItineraryTravelRouteStatus,
    TravelMode,
)
from services.itinerary_routes.state import (
    ROUTE_ERROR_CONFIGURATION,
    ROUTE_ERROR_PROVIDER,
    ROUTE_ERROR_PROVIDER_RESPONSE,
    mark_route_failed,
    mark_route_ready,
)
from services.route_providers import (
    RouteProviderBase,
    RouteProviderConfigurationError,
    RouteProviderError,
    RouteProviderResponseError,
)


class RouteGenerationStatus(str, Enum):
    READY = 'READY'
    FAILED = 'FAILED'
    SKIPPED = 'SKIPPED'


class ItineraryRouteGenerator:
    """Processes pending provider route rows."""

    def __init__(
        self,
        *,
        db: Session,
        route_provider: RouteProviderBase | None,
    ) -> None:
        self.db = db
        self.route_provider = route_provider

    def generate_pending_route(self, leg_id: uuid.UUID) -> RouteGenerationStatus:
        leg = self._load_leg_for_generation(leg_id)
        if leg is None:
            return RouteGenerationStatus.SKIPPED

        route = self.db.get(ItineraryTravelLegRoute, leg_id)
        if route is None or ItineraryTravelRouteStatus(route.status) != (
            ItineraryTravelRouteStatus.PENDING
        ):
            return RouteGenerationStatus.SKIPPED

        if self.route_provider is None:
            mark_route_failed(
                route=route,
                leg=leg,
                error_code=ROUTE_ERROR_CONFIGURATION,
            )
            self.db.commit()
            return RouteGenerationStatus.FAILED

        try:
            provider_response = self.route_provider.get_route(
                coordinates_from=_coordinates_for_stop(leg.from_stop),
                coordinates_to=_coordinates_for_stop(leg.to_stop),
                travel_mode=TravelMode(leg.travel_mode),
            )
        except RouteProviderConfigurationError:
            mark_route_failed(
                route=route,
                leg=leg,
                error_code=ROUTE_ERROR_CONFIGURATION,
            )
        except RouteProviderResponseError:
            mark_route_failed(
                route=route,
                leg=leg,
                error_code=ROUTE_ERROR_PROVIDER_RESPONSE,
            )
        except RouteProviderError:
            mark_route_failed(
                route=route,
                leg=leg,
                error_code=ROUTE_ERROR_PROVIDER,
            )
        else:
            mark_route_ready(
                route=route,
                leg=leg,
                provider_response=provider_response,
            )
            self.db.commit()
            return RouteGenerationStatus.READY

        self.db.commit()
        return RouteGenerationStatus.FAILED

    def _load_leg_for_generation(
        self,
        leg_id: uuid.UUID,
    ) -> ItineraryTravelLeg | None:
        return self.db.execute(
            select(ItineraryTravelLeg)
            .options(
                joinedload(ItineraryTravelLeg.from_stop).joinedload(
                    ItineraryStop.location
                ),
                joinedload(ItineraryTravelLeg.to_stop).joinedload(
                    ItineraryStop.location
                ),
            )
            .where(ItineraryTravelLeg.id == leg_id)
        ).scalar_one_or_none()


def _coordinates_for_stop(stop: ItineraryStop) -> tuple[float, float]:
    return (stop.location.longitude, stop.location.latitude)
