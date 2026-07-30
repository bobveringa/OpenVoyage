from __future__ import annotations

import uuid

from models.database.places import Place, PlaceFeatureClass
from sqlalchemy.orm import Session


def create_place(
    db_session: Session,
    *,
    external_id: str | None = None,
    name: str = 'Kyoto',
    latitude: float = 35.0116,
    longitude: float = 135.7681,
    country_code: str = 'JP',
    region: str = 'Kyoto',
    full_name: str = 'Kyoto, Kyoto, Japan',
    feature_class: PlaceFeatureClass = PlaceFeatureClass.POPULATED_PLACE,
    population: int = 1_463_723,
) -> Place:
    place = Place(
        id=uuid.uuid4(),
        external_source='test',
        external_id=external_id or f'place-{uuid.uuid4().hex[:8]}',
        name=name,
        latitude=latitude,
        longitude=longitude,
        country_code=country_code,
        region=region,
        full_name=full_name,
        feature_class=feature_class.value,
        population=population,
    )
    db_session.add(place)
    db_session.commit()
    db_session.refresh(place)
    return place
