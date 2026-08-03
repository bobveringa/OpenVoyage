from __future__ import annotations

import uuid
from collections.abc import Callable

from fastapi import BackgroundTasks
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session

from services.itinerary_routes.generator import ItineraryRouteGenerator
from services.route_providers import RouteProviderFactory


class ItineraryRouteGenerationScheduler:
    """Schedules pending route generation outside the request transaction."""

    def __init__(
        self,
        *,
        db: Session,
        background_tasks: BackgroundTasks | None,
        route_provider_factory: RouteProviderFactory,
        generate_current_session_route: Callable[[uuid.UUID], object],
    ) -> None:
        self.db = db
        self.background_tasks = background_tasks
        self.route_provider_factory = route_provider_factory
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
                self.route_provider_factory,
            )
            return

        self.background_tasks.add_task(
            self.generate_current_session_route,
            leg_id,
        )


def generate_pending_route_task(
    bind: Engine,
    leg_id: uuid.UUID,
    route_provider_factory: RouteProviderFactory,
) -> None:
    with Session(bind=bind) as db:
        ItineraryRouteGenerator(
            db=db,
            route_provider=route_provider_factory.create_routing_provider(),
        ).generate_pending_route(leg_id)
