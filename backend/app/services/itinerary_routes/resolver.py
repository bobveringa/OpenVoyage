from __future__ import annotations

import logging

from pydantic import ValidationError
from sqlalchemy.orm import Session

from models.api.itinerary import (
    GeoJsonLineString,
    ItineraryRouteType,
    ItineraryTravelRouteResponse,
)
from models.database.itinerary import (
    ItineraryStop,
    ItineraryTravelLeg,
    ItineraryTravelLegRoute,
    ItineraryTravelRouteStatus,
)

logger = logging.getLogger(__name__)


def _provider_backed_response(
    route: ItineraryTravelLegRoute,
) -> ItineraryTravelRouteResponse | None:
    if ItineraryTravelRouteStatus(route.status) != ItineraryTravelRouteStatus.READY:
        return None
    if route.geometry_geojson is None:
        return None

    try:
        geometry = GeoJsonLineString.model_validate(route.geometry_geojson)
    except ValidationError:
        logger.warning(
            'Invalid provider route geometry for leg %s; using simple route',
            route.id,
            exc_info=True,
        )
        return None

    return ItineraryTravelRouteResponse(
        type=ItineraryRouteType.PROVIDER_BACKED,
        geometry=geometry,
        distance_meters=route.distance_meters,
        duration_seconds=route.duration_seconds,
    )


def _simple_route_response(
    leg: ItineraryTravelLeg,
) -> ItineraryTravelRouteResponse:
    return ItineraryTravelRouteResponse(
        type=ItineraryRouteType.SIMPLE,
        geometry=GeoJsonLineString(
            coordinates=[
                _coordinates_for_stop(leg.from_stop),
                _coordinates_for_stop(leg.to_stop),
            ]
        ),
        distance_meters=None,
        duration_seconds=None,
    )


class ItineraryRouteResolver:
    """Builds API route responses from stored route rows and simple fallback."""

    def __init__(self, db: Session) -> None:
        self.db = db

    def response_for_leg(
        self,
        leg: ItineraryTravelLeg,
    ) -> ItineraryTravelRouteResponse:
        route = self.db.get(ItineraryTravelLegRoute, leg.id)
        if route is not None:
            provider_backed = _provider_backed_response(route)
            if provider_backed is not None:
                return provider_backed

        return _simple_route_response(leg)


def _coordinates_for_stop(stop: ItineraryStop) -> tuple[float, float]:
    return stop.location.longitude, stop.location.latitude
