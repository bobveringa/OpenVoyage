from __future__ import annotations

import uuid

from models.database.locations import Location
from sqlalchemy.orm import Session


def create_location(
    db_session: Session,
    *,
    trip_id: uuid.UUID,
    created_by: uuid.UUID,
    name: str = 'Kyoto',
    latitude: float = 35.0116,
    longitude: float = 135.7681,
    country_code: str = 'JP',
    region: str = 'Kyoto',
    full_name: str = 'Kyoto, Kyoto, Japan',
) -> Location:
    location = Location(
        id=uuid.uuid4(),
        trip_id=trip_id,
        name=name,
        latitude=latitude,
        longitude=longitude,
        country_code=country_code,
        region=region,
        full_name=full_name,
        created_by=created_by,
    )
    db_session.add(location)
    db_session.commit()
    db_session.refresh(location)
    return location
