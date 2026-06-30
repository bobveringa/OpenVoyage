from __future__ import annotations

import uuid
from unittest.mock import Mock

import pytest

from models.api.locations import LocationCoordinatesInput, LocationPlaceInput
from models.database.locations import Location
from models.database.places import Place, PlaceFeatureClass
from services.location_service import (
    UNKNOWN_COUNTRY_CODE,
    UNKNOWN_LOCATION_NAME,
    UNKNOWN_REGION,
    LocationNotFoundError,
    LocationService,
)
from services.place_service import ReverseGeocodeResult


def _place(
    *,
    latitude: float = 35.0116,
    longitude: float = 135.7681,
) -> Place:
    return Place(
        id=uuid.uuid4(),
        external_source='test',
        external_id='kyoto',
        name='Kyoto',
        latitude=latitude,
        longitude=longitude,
        country_code='JP',
        region='Kyoto',
        full_name='Kyoto, Kyoto, Japan',
        feature_class=PlaceFeatureClass.POPULATED_PLACE,
    )


@pytest.mark.unit
def test_create_location_for_trip_from_place_id(fake_db: Mock) -> None:
    trip_id = uuid.uuid4()
    user_id = uuid.uuid4()
    place = _place()
    fake_db.get.return_value = place

    service = LocationService(db=fake_db, place_service=Mock())
    location = service.create_location_for_trip(
        trip_id=trip_id,
        created_by=user_id,
        location_input=LocationPlaceInput(place_id=place.id),
    )

    assert isinstance(location, Location)
    assert location.trip_id == trip_id
    assert location.created_by == user_id
    assert location.name == place.name
    assert location.latitude == place.latitude
    assert location.longitude == place.longitude
    fake_db.add.assert_called_once_with(location)
    fake_db.flush.assert_called_once()


@pytest.mark.unit
def test_create_location_for_trip_from_coordinates_preserves_coordinates(
    fake_db: Mock,
) -> None:
    trip_id = uuid.uuid4()
    user_id = uuid.uuid4()
    place = _place(latitude=51.44164, longitude=5.46972)
    place_service = Mock()
    place_service.reverse_geocode.return_value = [
        ReverseGeocodeResult(place=place, distance_km=0.2)
    ]

    service = LocationService(db=fake_db, place_service=place_service)
    location = service.create_location_for_trip(
        trip_id=trip_id,
        created_by=user_id,
        location_input=LocationCoordinatesInput(latitude=51.44, longitude=5.47),
    )

    assert location.name == place.name
    assert location.latitude == 51.44
    assert location.longitude == 5.47
    assert location.country_code == place.country_code
    place_service.reverse_geocode.assert_called_once_with(
        latitude=51.44,
        longitude=5.47,
        limit=1,
    )


@pytest.mark.unit
def test_create_location_for_trip_from_coordinates_uses_unknown_fallback(
    fake_db: Mock,
) -> None:
    place_service = Mock()
    place_service.reverse_geocode.return_value = []

    service = LocationService(db=fake_db, place_service=place_service)
    location = service.create_location_for_trip(
        trip_id=uuid.uuid4(),
        created_by=uuid.uuid4(),
        location_input=LocationCoordinatesInput(latitude=1.23, longitude=4.56),
    )

    assert location.name == UNKNOWN_LOCATION_NAME
    assert location.latitude == 1.23
    assert location.longitude == 4.56
    assert location.country_code == UNKNOWN_COUNTRY_CODE
    assert location.region == UNKNOWN_REGION
    assert location.full_name == UNKNOWN_LOCATION_NAME
    fake_db.add.assert_called_once_with(location)
    fake_db.flush.assert_called_once()


@pytest.mark.unit
def test_create_location_for_trip_raises_when_place_missing(fake_db: Mock) -> None:
    fake_db.get.return_value = None
    service = LocationService(db=fake_db, place_service=Mock())

    with pytest.raises(LocationNotFoundError):
        service.create_location_for_trip(
            trip_id=uuid.uuid4(),
            created_by=uuid.uuid4(),
            location_input=LocationPlaceInput(place_id=uuid.uuid4()),
        )

    fake_db.add.assert_not_called()
