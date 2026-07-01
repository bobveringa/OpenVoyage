import uuid
from typing import TYPE_CHECKING, Self

from pydantic import BaseModel, Field

from models.api.media import MediaResponse

if TYPE_CHECKING:
    from models.database.user import User


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


class UserResponse(BaseModel):
    id: uuid.UUID
    email: str
    profile: UserProfileResponse | None

    @classmethod
    def from_model(cls, user: 'User', media_base_url: str = '') -> Self:
        profile = user.profile
        return cls(
            id=user.id,
            email=user.email,
            profile=(
                UserProfileResponse(
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
                if profile
                else None
            ),
        )


class UserSummaryResponse(BaseModel):
    id: uuid.UUID
    email: str
    username: str | None
    first_name: str | None
    last_name: str | None

    @classmethod
    def from_model(cls, user: 'User') -> Self:
        profile = user.profile
        return cls(
            id=user.id,
            email=user.email,
            username=profile.username if profile else None,
            first_name=profile.first_name if profile else None,
            last_name=profile.last_name if profile else None,
        )
