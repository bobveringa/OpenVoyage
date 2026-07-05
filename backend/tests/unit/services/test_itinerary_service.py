from __future__ import annotations

import uuid
from datetime import date
from unittest.mock import Mock

import pytest
from models.api.itinerary import PlannedStepCreateRequest
from models.api.locations import LocationCoordinatesInput
from models.database.locations import Location
from models.database.media import Media
from models.database.planned_steps import PlannedStep
from models.database.planned_travel import PlannedTravel, PlannedTravelMode
from models.database.trips import Trip, TripMember, TripRole
from models.database.user import User
from services.itinerary_service import ItineraryService
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool


def _session() -> Session:
    engine = create_engine(
        'sqlite://',
        connect_args={'check_same_thread': False},
        poolclass=StaticPool,
    )
    for table in (
        User.__table__,
        Media.__table__,
        Trip.__table__,
        TripMember.__table__,
        Location.__table__,
        PlannedStep.__table__,
        PlannedTravel.__table__,
    ):
        table.create(engine)

    return sessionmaker(bind=engine)()


def _location(
    *,
    trip_id: uuid.UUID,
    created_by: uuid.UUID,
    name: str,
) -> Location:
    return Location(
        id=uuid.uuid4(),
        trip_id=trip_id,
        name=name,
        latitude=51.4416,
        longitude=5.4697,
        country_code='NL',
        region='North Brabant',
        full_name=f'{name}, Netherlands',
        created_by=created_by,
    )


@pytest.mark.unit
def test_insert_planned_step_replaces_split_planned_travel() -> None:
    db = _session()
    user_id = uuid.uuid4()
    trip_id = uuid.uuid4()
    first_location = _location(
        trip_id=trip_id,
        created_by=user_id,
        name='Amsterdam',
    )
    middle_location = _location(
        trip_id=trip_id,
        created_by=user_id,
        name='Utrecht',
    )
    last_location = _location(
        trip_id=trip_id,
        created_by=user_id,
        name='Eindhoven',
    )
    first_step = PlannedStep(
        id=uuid.uuid4(),
        trip_id=trip_id,
        position=1000,
        location_id=first_location.id,
        arrival_date=date(2026, 8, 1),
        departure_date=date(2026, 8, 2),
        notes='',
    )
    last_step = PlannedStep(
        id=uuid.uuid4(),
        trip_id=trip_id,
        position=2000,
        location_id=last_location.id,
        arrival_date=date(2026, 8, 5),
        departure_date=date(2026, 8, 6),
        notes='',
    )
    old_travel = PlannedTravel(
        id=uuid.uuid4(),
        trip_id=trip_id,
        from_planned_step_id=first_step.id,
        to_planned_step_id=last_step.id,
        travel_mode=PlannedTravelMode.TRAIN,
        notes='Original direct train',
    )
    db.add_all(
        [
            User(
                id=user_id,
                email='owner@example.com',
                password_hash='hashed',
            ),
            Trip(id=trip_id, name='Netherlands'),
            TripMember(
                trip_id=trip_id,
                user_id=user_id,
                role=TripRole.OWNER,
            ),
            first_location,
            middle_location,
            last_location,
            first_step,
            last_step,
            old_travel,
        ]
    )
    db.commit()

    location_service = Mock()
    location_service.create_location_for_trip.return_value = middle_location
    service = ItineraryService(db=db, location_service=location_service)

    middle_step = service.create_planned_step(
        trip_id=trip_id,
        payload=PlannedStepCreateRequest(
            location=LocationCoordinatesInput(latitude=52.0907, longitude=5.1214),
            arrival_date=date(2026, 8, 3),
            departure_date=date(2026, 8, 4),
            after_planned_step_id=first_step.id,
        ),
        current_user_id=user_id,
    )

    planned_travel = list(
        db.execute(
            select(PlannedTravel).where(PlannedTravel.trip_id == trip_id)
        ).scalars()
    )

    assert old_travel.id not in {travel.id for travel in planned_travel}
    assert {
        (travel.from_planned_step_id, travel.to_planned_step_id)
        for travel in planned_travel
    } == {
        (first_step.id, middle_step.id),
        (middle_step.id, last_step.id),
    }
    assert all(travel.travel_mode == PlannedTravelMode.OTHER for travel in planned_travel)
    assert all(travel.notes == '' for travel in planned_travel)
