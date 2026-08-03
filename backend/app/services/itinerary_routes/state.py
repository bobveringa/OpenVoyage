from __future__ import annotations

from datetime import datetime, timedelta, timezone

from models.database.itinerary import (
    ItineraryTravelLeg,
    ItineraryTravelLegRoute,
    ItineraryTravelRouteStatus,
)
from services.route_providers import RouteResponse

RETRY_DELAY = timedelta(minutes=15)
MAX_ROUTE_ATTEMPTS = 3

ROUTE_ERROR_CONFIGURATION = 'CONFIGURATION_ERROR'
ROUTE_ERROR_PROVIDER_RESPONSE = 'PROVIDER_RESPONSE_ERROR'
ROUTE_ERROR_PROVIDER = 'PROVIDER_ERROR'


def mark_route_ready(
    *,
    route: ItineraryTravelLegRoute,
    leg: ItineraryTravelLeg,
    provider_response: RouteResponse,
) -> None:
    route.status = ItineraryTravelRouteStatus.READY
    route.geometry_geojson = provider_response.geometry_geojson
    route.distance_meters = provider_response.distance_meters
    route.duration_seconds = provider_response.duration_seconds
    route.error_code = None
    route.next_retry_at = None
    route.attempt_count += 1
    leg.updated_at = datetime.now(timezone.utc)


def mark_route_failed(
    *,
    route: ItineraryTravelLegRoute,
    leg: ItineraryTravelLeg,
    error_code: str,
) -> None:
    route.status = ItineraryTravelRouteStatus.FAILED
    route.geometry_geojson = None
    route.distance_meters = None
    route.duration_seconds = None
    route.error_code = error_code
    route.next_retry_at = datetime.now(timezone.utc) + RETRY_DELAY
    route.attempt_count += 1
    leg.updated_at = datetime.now(timezone.utc)
