from __future__ import annotations

import uuid
from unittest.mock import Mock

from fastapi import BackgroundTasks
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session

from services.itinerary_routes.lifecycle import (
    ItineraryRouteGenerationScheduler,
    generate_pending_route_task,
)
from services.route_providers import RouteProviderBase


def test_scheduler_passes_existing_provider_to_background_task() -> None:
    leg_id = uuid.uuid4()
    engine = Mock(spec=Engine)
    db = Mock(spec=Session)
    db.get_bind.return_value = engine
    background_tasks = Mock(spec=BackgroundTasks)
    route_provider = Mock(spec=RouteProviderBase)

    scheduler = ItineraryRouteGenerationScheduler(
        db=db,
        background_tasks=background_tasks,
        route_provider=route_provider,
        generate_current_session_route=Mock(),
    )

    scheduler.schedule(leg_id)

    background_tasks.add_task.assert_called_once_with(
        generate_pending_route_task,
        engine,
        leg_id,
        route_provider,
    )
