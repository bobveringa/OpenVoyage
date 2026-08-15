import uuid
from typing import Self

from pydantic import BaseModel, Field

from models.database.gps_privacy_zones import GpsPrivacyZone

MAX_ZONES_PER_USER = 20
MIN_ZONE_RADIUS_METERS = 100
MAX_ZONE_RADIUS_METERS = 10_000


class GpsPrivacyZoneRequest(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    latitude: float = Field(ge=-90, le=90)
    longitude: float = Field(ge=-180, le=180)
    radius_meters: int = Field(
        ge=MIN_ZONE_RADIUS_METERS,
        le=MAX_ZONE_RADIUS_METERS,
    )


class GpsPrivacyZoneResponse(BaseModel):
    id: uuid.UUID
    name: str
    latitude: float
    longitude: float
    radius_meters: int

    @classmethod
    def from_model(cls, zone: GpsPrivacyZone) -> Self:
        return cls(
            id=zone.id,
            name=zone.name,
            latitude=zone.latitude,
            longitude=zone.longitude,
            radius_meters=zone.radius_meters,
        )


class GpsPrivacyZoneEnvelope(BaseModel):
    """Creation and replacement wrap the zone, matching the spec's examples."""

    zone: GpsPrivacyZoneResponse
