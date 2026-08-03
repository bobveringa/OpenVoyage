from __future__ import annotations

import uuid
from datetime import datetime, timezone

from sqlalchemy.orm import Session

from models.database.itinerary import (
    ItineraryStop,
    ItineraryTravelLeg,
    ItineraryTravelLegRoute,
    ItineraryTravelRouteStatus,
)
from services.itinerary_routes.scheduler import ItineraryRouteGenerationScheduler
from services.route_providers import RouteProviderBase


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


def _coordinates_for_stop(stop: ItineraryStop) -> tuple[float, float]:
    return (stop.location.longitude, stop.location.latitude)
