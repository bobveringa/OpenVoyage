import enum
import uuid
from datetime import date, datetime
from typing import Self

from pydantic import BaseModel, Field, model_validator
from models.api.media import MediaResponse
from models.api.users import UserSummaryResponse
from models.database.trips import (
    Trip,
    TripMember,
    TripRole,
    TripShareLink,
    TripViewer,
    TripVisibility,
)


class TripSortField(str, enum.Enum):
    START_DATE = 'start_date'
    CREATED_AT = 'created_at'
    UPDATED_AT = 'updated_at'
    NAME = 'name'


class TripStatusFilter(str, enum.Enum):
    ALL = 'all'
    ONGOING = 'ongoing'
    UPCOMING = 'upcoming'
    PAST = 'past'


class TripCreateRequest(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    description: str = ''
    media_id: uuid.UUID
    visibility: TripVisibility = TripVisibility.PRIVATE
    start_date: date
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
        if 'start_date' in self.model_fields_set and self.start_date is None:
            raise ValueError('start_date cannot be null')
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


class TripViewerCreateRequest(BaseModel):
    user_id: uuid.UUID


class TripViewerResponse(BaseModel):
    trip_id: uuid.UUID
    user_id: uuid.UUID
    created_by: uuid.UUID
    created_at: datetime
    user: UserSummaryResponse

    @classmethod
    def from_model(cls, viewer: TripViewer) -> Self:
        return cls(
            trip_id=viewer.trip_id,
            user_id=viewer.user_id,
            created_by=viewer.created_by,
            created_at=viewer.created_at,
            user=UserSummaryResponse.from_model(viewer.user),
        )


class TripShareLinkCreateRequest(BaseModel):
    label: str | None = Field(default=None, max_length=255)
    expires_at: datetime | None = None


class TripShareLinkUpdateRequest(BaseModel):
    label: str | None = Field(default=None, max_length=255)
    expires_at: datetime | None = None
    revoked: bool | None = None


class TripShareLinkResponse(BaseModel):
    id: uuid.UUID
    trip_id: uuid.UUID
    label: str | None
    expires_at: datetime | None
    revoked_at: datetime | None
    created_at: datetime
    last_used_at: datetime | None

    @classmethod
    def from_model(cls, share_link: TripShareLink) -> Self:
        return cls(
            id=share_link.id,
            trip_id=share_link.trip_id,
            label=share_link.label,
            expires_at=share_link.expires_at,
            revoked_at=share_link.revoked_at,
            created_at=share_link.created_at,
            last_used_at=share_link.last_used_at,
        )


class TripShareLinkCreateResponse(TripShareLinkResponse):
    token: str

    @classmethod
    def from_model_with_token(
        cls,
        share_link: TripShareLink,
        token: str,
    ) -> Self:
        return cls(
            **TripShareLinkResponse.from_model(share_link).model_dump(),
            token=token,
        )


class TripResponse(BaseModel):
    trip_id: uuid.UUID = Field(alias='id')
    name: str
    description: str
    visibility: TripVisibility
    start_date: date
    end_date: date | None
    cover_media: MediaResponse | None

    @classmethod
    def from_model(
        cls,
        trip: Trip,
        media_base_url: str,
        *,
        media_token: str | None = None,
    ) -> Self:
        return cls(
            id=trip.id,
            name=trip.name,
            description=trip.description,
            visibility=trip.visibility,
            start_date=trip.start_date,
            end_date=trip.end_date,
            cover_media=(
                MediaResponse.from_model(
                    trip.cover_media,
                    media_base_url=media_base_url,
                    media_token=media_token,
                )
                if trip.cover_media
                else None
            ),
        )
