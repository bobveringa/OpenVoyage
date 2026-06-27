import enum
import uuid
from typing import Self

from pydantic import BaseModel, Field
from models.api.media import MediaResponse
from models.api.users import UserSummaryResponse
from models.database.trips import Trip, TripMember, TripRole, TripVisibility


class TripSortField(str, enum.Enum):
    CREATED_AT = 'created_at'
    UPDATED_AT = 'updated_at'
    NAME = 'name'


class TripCreateRequest(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    description: str = ''
    media_id: uuid.UUID
    visibility: TripVisibility = TripVisibility.PRIVATE


class TripUpdateRequest(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=255)
    description: str | None = None
    media_id: uuid.UUID | None = None
    visibility: TripVisibility | None = None


class TripMemberCreateRequest(BaseModel):
    user_id: uuid.UUID
    role: TripRole = TripRole.MEMBER


class TripMemberUpdateRequest(BaseModel):
    role: TripRole


class TripMemberResponse(BaseModel):
    trip_id: uuid.UUID
    user_id: uuid.UUID
    role: TripRole
    user: UserSummaryResponse

    @classmethod
    def from_model(cls, membership: TripMember) -> Self:
        return cls(
            trip_id=membership.trip_id,
            user_id=membership.user_id,
            role=membership.role,
            user=UserSummaryResponse.from_model(membership.user),
        )


class TripResponse(BaseModel):
    trip_id: uuid.UUID = Field(alias='id')
    name: str
    description: str
    cover_media: MediaResponse | None

    @classmethod
    def from_model(cls, trip: Trip, media_base_url: str) -> Self:
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
