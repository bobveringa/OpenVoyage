from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload

from models.database.itinerary import (
    ItineraryStop,
    ItineraryTravelLeg,
    ItineraryTravelLegRoute,
    ItineraryTravelRouteStatus,
)
from services.itinerary_routes.lifecycle import (
    ItineraryRouteGenerator,
    ItineraryRoutePlanner,
    MAX_ROUTE_ATTEMPTS,
    RouteGenerationStatus,
)
from services.route_providers import RouteProviderBase


@dataclass(frozen=True)
class ItineraryRouteQueueSummary:
    queued_missing: int = 0
    queued_retries: int = 0
    skipped_max_attempts: int = 0
    skipped_provider_unavailable: bool = False


@dataclass(frozen=True)
class ItineraryRouteGenerationSummary:
    attempted: int = 0
    ready: int = 0
    failed: int = 0
    skipped: int = 0


@dataclass(frozen=True)
class ItineraryRouteMaintenanceSummary:
    queue: ItineraryRouteQueueSummary
    generation: ItineraryRouteGenerationSummary


class ItineraryRouteMaintenance:
    """Bounded batch route maintenance for scheduled jobs."""

    def __init__(
        self,
        *,
        db: Session,
        route_provider: RouteProviderBase | None,
        planner: ItineraryRoutePlanner,
        generator: ItineraryRouteGenerator,
    ) -> None:
        self.db = db
        self.route_provider = route_provider
        self.planner = planner
        self.generator = generator

    def queue_missing_and_due_routes(
        self,
        *,
        limit: int,
        now: datetime | None = None,
    ) -> ItineraryRouteQueueSummary:
        if self.route_provider is None:
            return ItineraryRouteQueueSummary(skipped_provider_unavailable=True)

        queued_missing = self._queue_missing_routes(limit=limit)
        remaining = max(0, limit - queued_missing)
        queued_retries = 0
        skipped_max_attempts = 0
        if remaining:
            queued_retries, skipped_max_attempts = self._queue_due_retries(
                limit=remaining,
                now=now or datetime.now(timezone.utc),
            )

        self.db.commit()
        return ItineraryRouteQueueSummary(
            queued_missing=queued_missing,
            queued_retries=queued_retries,
            skipped_max_attempts=skipped_max_attempts,
        )

    def generate_pending_routes(
        self,
        *,
        limit: int,
    ) -> ItineraryRouteGenerationSummary:
        leg_ids = list(
            self.db.execute(
                select(ItineraryTravelLegRoute.id)
                .where(
                    ItineraryTravelLegRoute.status
                    == ItineraryTravelRouteStatus.PENDING
                )
                .order_by(
                    ItineraryTravelLegRoute.created_at,
                    ItineraryTravelLegRoute.id,
                )
                .limit(limit)
            ).scalars()
        )

        ready = 0
        failed = 0
        skipped = 0
        for leg_id in leg_ids:
            status = self.generator.generate_pending_route(leg_id)
            if status == RouteGenerationStatus.READY:
                ready += 1
            elif status == RouteGenerationStatus.FAILED:
                failed += 1
            else:
                skipped += 1

        return ItineraryRouteGenerationSummary(
            attempted=ready + failed,
            ready=ready,
            failed=failed,
            skipped=skipped,
        )

    def run_route_maintenance(
        self,
        *,
        queue_limit: int,
        generation_limit: int,
    ) -> ItineraryRouteMaintenanceSummary:
        queue = self.queue_missing_and_due_routes(limit=queue_limit)
        generation = self.generate_pending_routes(limit=generation_limit)
        return ItineraryRouteMaintenanceSummary(
            queue=queue,
            generation=generation,
        )

    def _queue_missing_routes(self, *, limit: int) -> int:
        missing_legs = list(
            self.db.execute(
                select(ItineraryTravelLeg)
                .outerjoin(
                    ItineraryTravelLegRoute,
                    ItineraryTravelLegRoute.id == ItineraryTravelLeg.id,
                )
                .options(
                    joinedload(ItineraryTravelLeg.from_stop).joinedload(
                        ItineraryStop.location
                    ),
                    joinedload(ItineraryTravelLeg.to_stop).joinedload(
                        ItineraryStop.location
                    ),
                )
                .where(ItineraryTravelLegRoute.id.is_(None))
                .order_by(ItineraryTravelLeg.created_at, ItineraryTravelLeg.id)
                .limit(limit)
            ).scalars()
        )

        queued = 0
        for leg in missing_legs:
            if self.planner.reset_and_queue(leg):
                queued += 1
        return queued

    def _queue_due_retries(
        self,
        *,
        limit: int,
        now: datetime,
    ) -> tuple[int, int]:
        due_routes = list(
            self.db.execute(
                select(ItineraryTravelLegRoute)
                .join(ItineraryTravelLegRoute.leg)
                .options(
                    joinedload(ItineraryTravelLegRoute.leg)
                    .joinedload(ItineraryTravelLeg.from_stop)
                    .joinedload(ItineraryStop.location),
                    joinedload(ItineraryTravelLegRoute.leg)
                    .joinedload(ItineraryTravelLeg.to_stop)
                    .joinedload(ItineraryStop.location),
                )
                .where(
                    ItineraryTravelLegRoute.status
                    == ItineraryTravelRouteStatus.FAILED,
                    ItineraryTravelLegRoute.next_retry_at <= now,
                )
                .order_by(
                    ItineraryTravelLegRoute.next_retry_at,
                    ItineraryTravelLegRoute.id,
                )
                .limit(limit)
            ).scalars()
        )

        queued = 0
        skipped_max_attempts = 0
        for route in due_routes:
            if route.attempt_count >= MAX_ROUTE_ATTEMPTS:
                skipped_max_attempts += 1
                continue
            if not self.planner.can_start_provider_route(route.leg):
                continue
            self._reset_failed_route(route=route, now=now)
            queued += 1
        return queued, skipped_max_attempts

    def _reset_failed_route(
        self,
        *,
        route: ItineraryTravelLegRoute,
        now: datetime,
    ) -> None:
        route.status = ItineraryTravelRouteStatus.PENDING
        if self.route_provider is not None:
            route.provider = self.route_provider.name
        route.error_code = None
        route.next_retry_at = None
        route.leg.updated_at = now
        self.db.flush()
