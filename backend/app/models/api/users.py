import uuid
from typing import TYPE_CHECKING, Self

from pydantic import BaseModel, Field

from models.api.media import MediaResponse

if TYPE_CHECKING:
    from models.database.user import User, UserProfile


class UserProfileUpdateRequest(BaseModel):
    username: str | None = Field(default=None, min_length=1, max_length=255)
    first_name: str | None = Field(default=None, min_length=1, max_length=255)
    last_name: str | None = Field(default=None, min_length=1, max_length=255)
    biography: str | None = Field(default=None, max_length=2048)
    profile_picture_media_id: uuid.UUID | None = None


class UserProfileResponse(BaseModel):
    username: str
    first_name: str
    last_name: str
    biography: str
    profile_picture_media_id: uuid.UUID | None
    profile_picture: MediaResponse | None

    @classmethod
    def from_model(
        cls,
        profile: 'UserProfile',
        media_base_url: str = '',
    ) -> Self:
        return cls(
            username=profile.username,
            first_name=profile.first_name,
            last_name=profile.last_name,
            biography=profile.biography,
            profile_picture_media_id=profile.profile_picture_media_id,
            profile_picture=(
                MediaResponse.from_model(
                    profile.profile_picture,
                    media_base_url=media_base_url,
                )
                if profile.profile_picture
                else None
            ),
        )


class UserResponse(BaseModel):
    id: uuid.UUID
    profile: UserProfileResponse | None

    @classmethod
    def from_model(cls, user: 'User', media_base_url: str = '') -> Self:
        profile = user.profile
        return cls(
            id=user.id,
            profile=UserProfileResponse.from_model(
                profile,
                media_base_url=media_base_url,
            )
            if profile
            else None,
        )


class UserSummaryResponse(BaseModel):
    id: uuid.UUID
    username: str | None
    first_name: str | None
    last_name: str | None

    @classmethod
    def from_model(cls, user: 'User') -> Self:
        profile = user.profile
        return cls(
            id=user.id,
            username=profile.username if profile else None,
            first_name=profile.first_name if profile else None,
            last_name=profile.last_name if profile else None,
        )
