import uuid
from typing import Self

from pydantic import BaseModel, Field

from models.database.places import Place, PlaceFeatureClass


class PlaceResponse(BaseModel):
    id: uuid.UUID
    name: str
    full_name: str
    latitude: float
    longitude: float
    country_code: str
    region: str
    feature_class: str
    feature_code: str | None = None
    iata_code: str | None = None
    icao_code: str | None = None
    timezone: str | None = None
    population: int
    part_of: str | None = Field(
        default=None,
        description='The city a neighbourhood or city district belongs to, otherwise null.',
    )

    @classmethod
    def from_model(cls, place: Place, part_of: str | None = None) -> Self:
        feature_class = PlaceFeatureClass(place.feature_class)
        return cls(
            id=place.id,
            name=place.name,
            full_name=place.full_name,
            latitude=place.latitude,
            longitude=place.longitude,
            country_code=place.country_code,
            region=place.region,
            feature_class=feature_class.name,
            population=place.population,
            feature_code=place.feature_code, iata_code=place.iata_code,
            icao_code=place.icao_code, timezone=place.timezone,
            part_of=part_of,
        )


class ReverseGeocodeResponse(BaseModel):
    distance_km: float
    place: PlaceResponse


class TimezoneResponse(BaseModel):
    timezone: str = Field(description='IANA time zone name, e.g. "Asia/Tokyo".')


class StopPhotoResponse(BaseModel):
    """A stop card's header photo: our stored copy and its Wikimedia credit."""

    url: str = Field(description='The stored photo, with a 24-hour token in the link.')
    credit: str | None = Field(description='The photographer, as plain text.')
    license: str | None = Field(description='For example "CC BY-SA 3.0".')
    source_url: str = Field(description="The photo's page on Wikimedia Commons.")


class AddressResponse(BaseModel):
    """An address search result for a stay."""

    name: str
    address: str | None
    latitude: float
    longitude: float
