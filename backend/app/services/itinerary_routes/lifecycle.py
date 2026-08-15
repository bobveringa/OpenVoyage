from __future__ import annotations

import uuid
from collections.abc import Callable
from datetime import datetime, timedelta, timezone
from enum import Enum

from fastapi import BackgroundTasks
from sqlalchemy import select
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session, joinedload

from models.database.itinerary import (
    ItineraryStop,
    ItineraryTravelLeg,
    ItineraryTravelLegRoute,
    ItineraryTravelRouteStatus,
)
from models.database.travel import TravelMode
from services.route_providers import (
    RouteProviderBase,
    RouteProviderConfigurationError,
    RouteProviderError,
    RouteProviderResponseError,
    RouteResponse,
)

RETRY_DELAY = timedelta(minutes=15)
MAX_ROUTE_ATTEMPTS = 3

ROUTE_ERROR_CONFIGURATION = 'CONFIGURATION_ERROR'
ROUTE_ERROR_PROVIDER_RESPONSE = 'PROVIDER_RESPONSE_ERROR'
ROUTE_ERROR_PROVIDER = 'PROVIDER_ERROR'


class RouteGenerationStatus(str, Enum):
    READY = 'READY'
    FAILED = 'FAILED'
    SKIPPED = 'SKIPPED'


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


class ItineraryRouteGenerationScheduler:
    """Schedules pending route generation outside the request transaction."""

    def __init__(
        self,
        *,
        db: Session,
        background_tasks: BackgroundTasks | None,
        route_provider: RouteProviderBase | None,
        generate_current_session_route: Callable[[uuid.UUID], object],
    ) -> None:
        self.db = db
        self.background_tasks = background_tasks
        self.route_provider = route_provider
        self.generate_current_session_route = generate_current_session_route

    def schedule(self, leg_id: uuid.UUID) -> None:
        if self.background_tasks is None:
            return

        bind = self.db.get_bind()
        if isinstance(bind, Engine):
            self.background_tasks.add_task(
                generate_pending_route_task,
                bind,
                leg_id,
                self.route_provider,
            )
            return

        self.background_tasks.add_task(
            self.generate_current_session_route,
            leg_id,
        )


class ItineraryRoutePlanner:
    """Creates pending route rows when provider-backed generation is eligible."""

    def __init__(
        self,
        *,
        db: Session,
        route_provider: RouteProviderBase | None,
        scheduler: ItineraryRouteGenerationScheduler | None,
    ) -> None:
        self.db = db
        self.route_provider = route_provider
        self.scheduler = scheduler

    def reset_and_queue(self, leg: ItineraryTravelLeg) -> bool:
        self._delete_route_row(leg_id=leg.id)

        if self.route_provider is None:
            return False

        if not self._can_start_provider_route(leg):
            return False

        self.db.add(
            ItineraryTravelLegRoute(
                id=leg.id,
                status=ItineraryTravelRouteStatus.PENDING,
                provider=self.route_provider.name,
                attempt_count=0,
            )
        )
        leg.updated_at = datetime.now(timezone.utc)
        self.db.flush()
        return True

    def reset_queue_and_schedule(self, leg: ItineraryTravelLeg) -> bool:
        queued = self.reset_and_queue(leg)
        if queued and self.scheduler is not None:
            self.scheduler.schedule(leg.id)
        return queued

    def can_start_provider_route(self, leg: ItineraryTravelLeg) -> bool:
        if self.route_provider is None:
            return False
        return self._can_start_provider_route(leg)

    def _delete_route_row(self, *, leg_id: uuid.UUID) -> None:
        route = self.db.get(ItineraryTravelLegRoute, leg_id)
        if route is None:
            return
        self.db.delete(route)
        self.db.flush()

    def _can_start_provider_route(self, leg: ItineraryTravelLeg) -> bool:
        if self.route_provider is None or not self.route_provider.can_route(leg):
            return False

        _coordinates_for_stop(leg.from_stop)
        _coordinates_for_stop(leg.to_stop)
        return True


def generate_pending_route_task(
    bind: Engine,
    leg_id: uuid.UUID,
    route_provider: RouteProviderBase | None,
) -> None:
    with Session(bind=bind) as db:
        ItineraryRouteGenerator(
            db=db,
            route_provider=route_provider,
        ).generate_pending_route(leg_id)


def _coordinates_for_stop(stop: ItineraryStop) -> tuple[float, float]:
    return stop.location.longitude, stop.location.latitude
