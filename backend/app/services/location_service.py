import uuid
from dataclasses import dataclass

from sqlalchemy.orm import Session

from models.api.locations import (
    LocationCoordinatesInput,
    LocationInput,
    LocationPlaceInput,
)
from models.database.locations import Location
from models.database.places import Place
from services.place_service import PlaceService

UNKNOWN_LOCATION_NAME = 'Unknown location'
UNKNOWN_COUNTRY_CODE = 'ZZ'
UNKNOWN_REGION = 'Unknown'


class LocationNotFoundError(Exception):
    """Raised when a trusted place cannot be found."""


@dataclass(frozen=True)
class ResolvedLocation:
    name: str
    latitude: float
    longitude: float
    country_code: str
    region: str
    full_name: str


class LocationService:
    """Creates trip-scoped locations from backend-trusted place data."""

    def __init__(
        self,
        db: Session,
        place_service: PlaceService,
    ) -> None:
        self.db = db
        self.place_service = place_service

    def create_location_for_trip(
        self,
        trip_id: uuid.UUID,
        created_by: uuid.UUID,
        location_input: LocationInput,
    ) -> Location:
        resolved_location = self._resolve_location_input(location_input)
        location = Location(
            trip_id=trip_id,
            name=resolved_location.name,
            latitude=resolved_location.latitude,
            longitude=resolved_location.longitude,
            country_code=resolved_location.country_code,
            region=resolved_location.region,
            full_name=resolved_location.full_name,
            created_by=created_by,
        )
        self.db.add(location)
        self.db.flush()
        return location

    def _resolve_location_input(
        self,
        location_input: LocationInput,
    ) -> ResolvedLocation:
        if isinstance(location_input, LocationPlaceInput):
            place = self.db.get(Place, location_input.place_id)
            if place is None:
                raise LocationNotFoundError(
                    f'Place not found: {location_input.place_id}'
                )
            return ResolvedLocation(
                name=place.name,
                latitude=place.latitude,
                longitude=place.longitude,
                country_code=place.country_code,
                region=place.region,
                full_name=place.full_name,
            )

        if isinstance(location_input, LocationCoordinatesInput):
            results = self.place_service.reverse_geocode(
                latitude=location_input.latitude,
                longitude=location_input.longitude,
                limit=1,
            )
            if not results:
                return ResolvedLocation(
                    name=UNKNOWN_LOCATION_NAME,
                    latitude=location_input.latitude,
                    longitude=location_input.longitude,
                    country_code=UNKNOWN_COUNTRY_CODE,
                    region=UNKNOWN_REGION,
                    full_name=UNKNOWN_LOCATION_NAME,
                )
            place = results[0].place
            return ResolvedLocation(
                name=place.name,
                latitude=location_input.latitude,
                longitude=location_input.longitude,
                country_code=place.country_code,
                region=place.region,
                full_name=place.full_name,
            )

        raise LocationNotFoundError('Unsupported location input')
