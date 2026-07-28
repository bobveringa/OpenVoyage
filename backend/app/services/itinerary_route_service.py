from __future__ import annotations

import uuid
from datetime import timedelta

from fastapi import BackgroundTasks
from pydantic import ValidationError
from sqlalchemy import select
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session, joinedload

from models.api.itinerary import (
    GeoJsonLineString,
    ItineraryRouteType,
    ItineraryTravelRouteResponse,
)
from models.database.base import utcnow
from models.database.itinerary import (
    ItineraryStop,
    ItineraryTravelLeg,
    ItineraryTravelLegRoute,
    ItineraryTravelRouteStatus,
    TravelMode,
)
from services.route_providers import (
    GraphHopperRouteProvider,
    RouteProviderBase,
    RouteProviderConfigurationError,
    RouteProviderError,
    RouteProviderResponseError,
    RouteResponse,
)

_RETRY_DELAY = timedelta(minutes=15)


class ItineraryRouteService:
    """Owns itinerary travel leg route rows and route response construction."""

    def __init__(
        self,
        *,
        db: Session,
        background_tasks: BackgroundTasks | None = None,
        provider_name: str | None = None,
        route_provider: RouteProviderBase | None = None,
    ) -> None:
        self.db = db
        self.background_tasks = background_tasks
        self.provider_name = provider_name
        self.route_provider = route_provider

    def get_route_response(
        self,
        leg: ItineraryTravelLeg,
    ) -> ItineraryTravelRouteResponse:
        route = self.db.get(ItineraryTravelLegRoute, leg.id)
        if route is not None:
            provider_backed = self._provider_backed_response(route)
            if provider_backed is not None:
                return provider_backed

        return self._simple_route_response(leg)

    def refresh_leg_route(self, leg: ItineraryTravelLeg) -> None:
        self.sync_leg_route_after_change(leg)

    def sync_leg_route_after_change(self, leg: ItineraryTravelLeg) -> None:
        self._delete_route_row(leg_id=leg.id)
        if not self._can_start_provider_route(leg):
            return

        self.db.add(
            ItineraryTravelLegRoute(
                id=leg.id,
                status=ItineraryTravelRouteStatus.PENDING,
                provider=self.provider_name or '',
                attempt_count=0,
            )
        )
        leg.updated_at = utcnow()
        self.db.flush()
        self._schedule_generation(leg.id)

    def generate_pending_route(self, leg_id: uuid.UUID) -> None:
        leg = self._load_leg_for_generation(leg_id)
        if leg is None:
            return

        route = self.db.get(ItineraryTravelLegRoute, leg_id)
        if route is None or ItineraryTravelRouteStatus(route.status) != (
            ItineraryTravelRouteStatus.PENDING
        ):
            return

        if self.route_provider is None or self.provider_name is None:
            self._mark_failed(
                route=route,
                leg=leg,
                error_code='CONFIGURATION_ERROR',
            )
            self.db.commit()
            return

        try:
            provider_response = self.route_provider.get_route(
                coordinates_from=self._coordinates_for_stop(leg.from_stop),
                coordinates_to=self._coordinates_for_stop(leg.to_stop),
                travel_mode=TravelMode(leg.travel_mode),
            )
        except RouteProviderConfigurationError:
            self._mark_failed(
                route=route,
                leg=leg,
                error_code='CONFIGURATION_ERROR',
            )
        except RouteProviderResponseError:
            self._mark_failed(
                route=route,
                leg=leg,
                error_code='PROVIDER_RESPONSE_ERROR',
            )
        except RouteProviderError:
            self._mark_failed(
                route=route,
                leg=leg,
                error_code='PROVIDER_ERROR',
            )
        else:
            self._mark_ready(
                route=route,
                leg=leg,
                provider_response=provider_response,
            )

        self.db.commit()

    def _delete_route_row(self, *, leg_id: uuid.UUID) -> None:
        route = self.db.get(ItineraryTravelLegRoute, leg_id)
        if route is None:
            return
        self.db.delete(route)
        self.db.flush()

    def _can_start_provider_route(self, leg: ItineraryTravelLeg) -> bool:
        if (
            self.provider_name is None
            or self.route_provider is None
            or not self.route_provider.can_route(leg)
        ):
            return False

        self._coordinates_for_stop(leg.from_stop)
        self._coordinates_for_stop(leg.to_stop)
        return True

    def _schedule_generation(self, leg_id: uuid.UUID) -> None:
        if self.route_provider is None or self.provider_name is None:
            return

        if self.background_tasks is None:
            return

        bind = self.db.get_bind()
        if not isinstance(bind, Engine):
            self.background_tasks.add_task(self.generate_pending_route, leg_id)
            return

        self.background_tasks.add_task(
            _generate_pending_route,
            bind,
            leg_id,
            self.provider_name,
            self.route_provider,
        )

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

    def _provider_backed_response(
        self,
        route: ItineraryTravelLegRoute,
    ) -> ItineraryTravelRouteResponse | None:
        if ItineraryTravelRouteStatus(route.status) != ItineraryTravelRouteStatus.READY:
            return None
        if route.geometry_geojson is None:
            return None

        try:
            geometry = GeoJsonLineString.model_validate(route.geometry_geojson)
        except ValidationError:
            return None

        return ItineraryTravelRouteResponse(
            type=ItineraryRouteType.PROVIDER_BACKED,
            geometry=geometry,
            distance_meters=route.distance_meters,
            duration_seconds=route.duration_seconds,
        )

    def _simple_route_response(
        self,
        leg: ItineraryTravelLeg,
    ) -> ItineraryTravelRouteResponse:
        return ItineraryTravelRouteResponse(
            type=ItineraryRouteType.SIMPLE,
            geometry=GeoJsonLineString(
                coordinates=[
                    self._coordinates_for_stop(leg.from_stop),
                    self._coordinates_for_stop(leg.to_stop),
                ]
            ),
            distance_meters=None,
            duration_seconds=None,
        )

    def _mark_ready(
        self,
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
        leg.updated_at = utcnow()

    def _mark_failed(
        self,
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
        route.next_retry_at = utcnow() + _RETRY_DELAY
        route.attempt_count += 1
        leg.updated_at = utcnow()

    def _coordinates_for_stop(self, stop: ItineraryStop) -> tuple[float, float]:
        return (stop.location.longitude, stop.location.latitude)


def build_configured_route_provider(
    provider_name: str,
) -> tuple[str | None, RouteProviderBase | None]:
    provider_name = provider_name.strip().lower()
    if provider_name in ('', 'none'):
        return None, None
    if provider_name == 'graphhopper':
        return 'graphhopper', GraphHopperRouteProvider()
    return None, None


def _generate_pending_route(
    bind: Engine,
    leg_id: uuid.UUID,
    provider_name: str,
    route_provider: RouteProviderBase,
) -> None:
    with Session(bind=bind) as db:
        ItineraryRouteService(
            db=db,
            provider_name=provider_name,
            route_provider=route_provider,
        ).generate_pending_route(leg_id)
