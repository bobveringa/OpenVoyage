import uuid
from typing import Self

from pydantic import BaseModel

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
    population: int

    @classmethod
    def from_model(cls, place: Place) -> Self:
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
        )


class ReverseGeocodeResponse(BaseModel):
    distance_km: float
    place: PlaceResponse
