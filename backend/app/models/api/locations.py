import uuid
from typing import Self, TypeAlias

from pydantic import BaseModel, ConfigDict, Field

from models.database.locations import Location
from services.timezone_service import resolve_timezone


class LocationPlaceInput(BaseModel):
    model_config = ConfigDict(extra='forbid')

    place_id: uuid.UUID


class LocationCoordinatesInput(BaseModel):
    model_config = ConfigDict(extra='forbid')

    latitude: float = Field(ge=-90, le=90)
    longitude: float = Field(ge=-180, le=180)


LocationInput: TypeAlias = LocationPlaceInput | LocationCoordinatesInput


class LocationResponse(BaseModel):
    id: uuid.UUID
    name: str
    latitude: float
    longitude: float
    country_code: str
    region: str
    full_name: str
    timezone: str = Field(
        description='IANA time zone at the coordinates, worked out per response.',
    )

    @classmethod
    def from_model(cls, location: Location) -> Self:
        return cls(
            id=location.id,
            name=location.name,
            latitude=location.latitude,
            longitude=location.longitude,
            country_code=location.country_code,
            region=location.region,
            full_name=location.full_name,
            timezone=resolve_timezone(location.latitude, location.longitude),
        )
