from __future__ import annotations

import uuid

from fastapi import BackgroundTasks
from sqlalchemy.orm import Session

from models.api.itinerary import ItineraryTravelRouteResponse
from models.database.itinerary import ItineraryTravelLeg
from services.itinerary_routes.lifecycle import (
    ItineraryRouteGenerationScheduler,
    ItineraryRouteGenerator,
    ItineraryRoutePlanner,
)
from services.itinerary_routes.maintenance import (
    ItineraryRouteGenerationSummary,
    ItineraryRouteMaintenance,
    ItineraryRouteMaintenanceSummary,
    ItineraryRouteQueueSummary,
)
from services.itinerary_routes.resolver import ItineraryRouteResolver
from services.route_providers import RouteProviderFactory


class ItineraryRouteService:
    """Facade for itinerary route resolution, queueing, and generation."""

    def __init__(
        self,
        *,
        db: Session,
        route_provider_factory: RouteProviderFactory,
        background_tasks: BackgroundTasks | None = None,
    ) -> None:
        route_provider = route_provider_factory.create_routing_provider()
        self._resolver = ItineraryRouteResolver(db)
        self._generator = ItineraryRouteGenerator(
            db=db,
            route_provider=route_provider,
        )
        scheduler = ItineraryRouteGenerationScheduler(
            db=db,
            background_tasks=background_tasks,
            route_provider_factory=route_provider_factory,
            generate_current_session_route=self._generator.generate_pending_route,
        )
        self._planner = ItineraryRoutePlanner(
            db=db,
            route_provider=route_provider,
            scheduler=scheduler,
        )
        self._maintenance = ItineraryRouteMaintenance(
            db=db,
            route_provider=route_provider,
            planner=self._planner,
            generator=self._generator,
        )

    def resolve_route_response(
        self,
        leg: ItineraryTravelLeg,
    ) -> ItineraryTravelRouteResponse:
        return self._resolver.response_for_leg(leg)

    def reset_queue_and_schedule_leg_route(self, leg: ItineraryTravelLeg) -> bool:
        return self._planner.reset_queue_and_schedule(leg)

    def generate_pending_route(self, leg_id: uuid.UUID) -> None:
        self._generator.generate_pending_route(leg_id)

    def queue_missing_and_due_routes(
        self,
        *,
        limit: int = 500,
    ) -> ItineraryRouteQueueSummary:
        return self._maintenance.queue_missing_and_due_routes(limit=limit)

    def generate_pending_routes(
        self,
        *,
        limit: int = 500,
    ) -> ItineraryRouteGenerationSummary:
        return self._maintenance.generate_pending_routes(limit=limit)

    def run_route_maintenance(
        self,
        *,
        queue_limit: int = 500,
        generation_limit: int = 500,
    ) -> ItineraryRouteMaintenanceSummary:
        return self._maintenance.run_route_maintenance(
            queue_limit=queue_limit,
            generation_limit=generation_limit,
        )
