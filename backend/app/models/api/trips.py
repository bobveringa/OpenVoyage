import enum
import uuid
from typing import TYPE_CHECKING, Self

from pydantic import BaseModel, Field
from models.database.trips import Trip, TripVisibility

if TYPE_CHECKING:
    from .media import MediaResponse


class TripSortField(str, enum.Enum):
    CREATED_AT = 'created_at'
    UPDATED_AT = 'updated_at'
    NAME = 'name'


class TripCreateRequest(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    description: str = ''
    media_id: uuid.UUID
    visibility: TripVisibility = TripVisibility.PRIVATE


class TripResponse(BaseModel):
    trip_id: uuid.UUID = Field(alias='id')
    name: str
    description: str
    cover_media: MediaResponse | None

    @classmethod
    def from_model(cls, trip: Trip, media_base_url: str) -> Self:
        from .media import MediaResponse

        return cls(
            id=trip.id,
            name=trip.name,
            description=trip.description,
            cover_media=(
                MediaResponse.from_model(
                    trip.cover_media, media_base_url=media_base_url
                )
                if trip.cover_media
                else None
            ),
        )
