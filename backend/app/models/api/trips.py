import enum
import uuid
from datetime import date
from typing import Self

from pydantic import BaseModel, Field, model_validator
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
    start_date: date | None = None
    end_date: date | None = None

    @model_validator(mode='after')
    def validate_dates(self) -> Self:
        if (
            self.start_date is not None
            and self.end_date is not None
            and self.end_date < self.start_date
        ):
            raise ValueError('end_date must be on or after start_date')
        return self


class TripUpdateRequest(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=255)
    description: str | None = None
    media_id: uuid.UUID | None = None
    visibility: TripVisibility | None = None
    start_date: date | None = None
    end_date: date | None = None

    @model_validator(mode='after')
    def validate_dates(self) -> Self:
        if (
            self.start_date is not None
            and self.end_date is not None
            and self.end_date < self.start_date
        ):
            raise ValueError('end_date must be on or after start_date')
        return self


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
    visibility: TripVisibility
    start_date: date | None
    end_date: date | None
    cover_media: MediaResponse | None

    @classmethod
    def from_model(cls, trip: Trip, media_base_url: str) -> Self:
        return cls(
            id=trip.id,
            name=trip.name,
            description=trip.description,
            visibility=trip.visibility,
            start_date=trip.start_date,
            end_date=trip.end_date,
            cover_media=(
                MediaResponse.from_model(
                    trip.cover_media, media_base_url=media_base_url
                )
                if trip.cover_media
                else None
            ),
        )
