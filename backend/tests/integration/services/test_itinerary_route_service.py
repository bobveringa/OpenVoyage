from __future__ import annotations

from datetime import date, datetime, timedelta, timezone

import pytest
from sqlalchemy.orm import Session

from factories.locations import create_location
from factories.trips import create_trip
from factories.users import create_user
from models.database.itinerary import (
    ItineraryStop,
    ItineraryTravelLeg,
    ItineraryTravelLegRoute,
    ItineraryTravelRouteStatus,
)
from models.database.travel import TravelMode
from services.itinerary_routes import ItineraryRouteService
from services.route_providers import RouteProviderBase, RouteResponse

PROVIDER_GEOMETRY = {
    'type': 'LineString',
    'coordinates': [[5.4697, 51.4416], [5.1214, 52.0907]],
}


class FakeRouteProvider(RouteProviderBase):
    name = 'fake'
    supported_travel_modes = frozenset({TravelMode.CAR})

    def is_configured(self) -> bool:
        return True

    def get_route(
        self,
        coordinates_from: tuple[float, float],
        coordinates_to: tuple[float, float],
        travel_mode: TravelMode,
    ) -> RouteResponse:
        return RouteResponse(
            geometry_geojson=PROVIDER_GEOMETRY,
            distance_meters=123,
            duration_seconds=456,
        )


def _create_travel_leg(
    db_session: Session,
    *,
    trip_id,
    user_id,
    index: int = 0,
    travel_mode: TravelMode = TravelMode.CAR,
) -> ItineraryTravelLeg:
    from_location = create_location(
        db_session,
        trip_id=trip_id,
        created_by=user_id,
        name=f'From {index}',
        latitude=51.4416 + index,
        longitude=5.4697 + index,
    )
    to_location = create_location(
        db_session,
        trip_id=trip_id,
        created_by=user_id,
        name=f'To {index}',
        latitude=52.0907 + index,
        longitude=5.1214 + index,
    )
    from_stop = ItineraryStop(
        trip_id=trip_id,
        location_id=from_location.id,
        planned_start_date=date(2026, 1, 1 + index * 2),
        same_day_position=0,
        title=f'From {index}',
        notes='',
        planned_nights=0,
        created_by=user_id,
    )
    to_stop = ItineraryStop(
        trip_id=trip_id,
        location_id=to_location.id,
        planned_start_date=date(2026, 1, 2 + index * 2),
        same_day_position=0,
        title=f'To {index}',
        notes='',
        planned_nights=0,
        created_by=user_id,
    )
    db_session.add_all([from_stop, to_stop])
    db_session.flush()
    leg = ItineraryTravelLeg(
        trip_id=trip_id,
        from_stop_id=from_stop.id,
        to_stop_id=to_stop.id,
        travel_mode=travel_mode,
        notes='',
        operator=None,
        reference=None,
    )
    db_session.add(leg)
    db_session.commit()
    db_session.refresh(leg)
    return leg


def _route_service(
    db_session: Session,
    *,
    provider: RouteProviderBase | None = None,
) -> ItineraryRouteService:
    return ItineraryRouteService(
        db=db_session,
        route_provider=provider,
    )


@pytest.mark.integration
def test_route_maintenance_queues_missing_and_generates_pending_route(
    db_session: Session,
) -> None:
    owner = create_user(db_session, password='ItineraryPass123!')
    trip = create_trip(db_session, owner_id=owner.id)
    leg = _create_travel_leg(
        db_session,
        trip_id=trip.id,
        user_id=owner.id,
    )
    service = _route_service(db_session, provider=FakeRouteProvider())

    summary = service.run_route_maintenance()
    db_session.expire_all()
    route = db_session.get(ItineraryTravelLegRoute, leg.id)

    assert summary.queue.queued_missing == 1
    assert summary.queue.queued_retries == 0
    assert summary.generation.ready == 1
    assert summary.generation.failed == 0
    assert route is not None
    assert route.status == ItineraryTravelRouteStatus.READY
    assert route.provider == 'fake'
    assert route.geometry_geojson == PROVIDER_GEOMETRY
    assert route.attempt_count == 1


@pytest.mark.integration
def test_route_maintenance_requeues_due_failed_route_below_max_attempts(
    db_session: Session,
) -> None:
    owner = create_user(db_session, password='ItineraryPass123!')
    trip = create_trip(db_session, owner_id=owner.id)
    leg = _create_travel_leg(
        db_session,
        trip_id=trip.id,
        user_id=owner.id,
    )
    now = datetime.now(timezone.utc)
    db_session.add(
        ItineraryTravelLegRoute(
            id=leg.id,
            status=ItineraryTravelRouteStatus.FAILED,
            provider='fake',
            error_code='PROVIDER_ERROR',
            attempt_count=2,
            next_retry_at=now - timedelta(minutes=1),
        )
    )
    db_session.commit()
    service = _route_service(db_session, provider=FakeRouteProvider())

    queue_summary = service.queue_missing_and_due_routes(limit=500)
    pending_route = db_session.get(ItineraryTravelLegRoute, leg.id)
    assert pending_route is not None
    assert pending_route.status == ItineraryTravelRouteStatus.PENDING
    assert pending_route.attempt_count == 2

    generation_summary = service.generate_pending_routes(limit=500)
    db_session.expire_all()
    ready_route = db_session.get(ItineraryTravelLegRoute, leg.id)

    assert queue_summary.queued_missing == 0
    assert queue_summary.queued_retries == 1
    assert queue_summary.skipped_max_attempts == 0
    assert generation_summary.ready == 1
    assert ready_route is not None
    assert ready_route.status == ItineraryTravelRouteStatus.READY
    assert ready_route.attempt_count == 3


@pytest.mark.integration
def test_route_maintenance_leaves_due_failed_route_at_max_attempts(
    db_session: Session,
) -> None:
    owner = create_user(db_session, password='ItineraryPass123!')
    trip = create_trip(db_session, owner_id=owner.id)
    leg = _create_travel_leg(
        db_session,
        trip_id=trip.id,
        user_id=owner.id,
    )
    now = datetime.now(timezone.utc)
    db_session.add(
        ItineraryTravelLegRoute(
            id=leg.id,
            status=ItineraryTravelRouteStatus.FAILED,
            provider='fake',
            error_code='PROVIDER_ERROR',
            attempt_count=3,
            next_retry_at=now - timedelta(minutes=1),
        )
    )
    db_session.commit()
    service = _route_service(db_session, provider=FakeRouteProvider())

    queue_summary = service.queue_missing_and_due_routes(limit=500)
    db_session.expire_all()
    route = db_session.get(ItineraryTravelLegRoute, leg.id)

    assert queue_summary.queued_missing == 0
    assert queue_summary.queued_retries == 0
    assert queue_summary.skipped_max_attempts == 1
    assert route is not None
    assert route.status == ItineraryTravelRouteStatus.FAILED
    assert route.attempt_count == 3


@pytest.mark.integration
def test_route_maintenance_skips_when_provider_is_unavailable(
    db_session: Session,
) -> None:
    owner = create_user(db_session, password='ItineraryPass123!')
    trip = create_trip(db_session, owner_id=owner.id)
    leg = _create_travel_leg(
        db_session,
        trip_id=trip.id,
        user_id=owner.id,
    )
    service = _route_service(db_session, provider=None)

    summary = service.queue_missing_and_due_routes(limit=500)

    assert summary.skipped_provider_unavailable is True
    assert db_session.get(ItineraryTravelLegRoute, leg.id) is None
