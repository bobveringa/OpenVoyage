from __future__ import annotations

import uuid
from datetime import date

from models.database.trips import Trip, TripMember, TripRole, TripViewer, TripVisibility
from sqlalchemy.orm import Session


def create_trip(
    db_session: Session,
    *,
    owner_id: uuid.UUID,
    name: str = 'Trip',
    description: str = '',
    visibility: TripVisibility = TripVisibility.PRIVATE,
    start_date: date = date(2026, 1, 1),
    end_date: date | None = None,
) -> Trip:
    trip = Trip(
        id=uuid.uuid4(),
        name=name,
        description=description,
        visibility=visibility,
        start_date=start_date,
        end_date=end_date,
    )
    db_session.add(trip)
    db_session.flush()
    db_session.add(
        TripMember(
            trip_id=trip.id,
            user_id=owner_id,
            role=TripRole.OWNER,
        )
    )
    db_session.commit()
    db_session.refresh(trip)
    return trip


def add_trip_member(
    db_session: Session,
    *,
    trip_id: uuid.UUID,
    user_id: uuid.UUID,
    role: TripRole = TripRole.MEMBER,
) -> TripMember:
    membership = TripMember(
        trip_id=trip_id,
        user_id=user_id,
        role=role,
    )
    db_session.add(membership)
    db_session.commit()
    db_session.refresh(membership)
    return membership


def add_trip_viewer(
    db_session: Session,
    *,
    trip_id: uuid.UUID,
    user_id: uuid.UUID,
    created_by: uuid.UUID,
) -> TripViewer:
    viewer = TripViewer(
        trip_id=trip_id,
        user_id=user_id,
        created_by=created_by,
    )
    db_session.add(viewer)
    db_session.commit()
    db_session.refresh(viewer)
    return viewer
