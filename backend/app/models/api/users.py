import re
import uuid
from typing import TYPE_CHECKING, Self

from pydantic import BaseModel, ConfigDict, Field, field_validator

from models.api.media import MediaResponse
from models.database.user import UserRole

if TYPE_CHECKING:
    from models.database.user import User, UserProfile


USERNAME_MIN_LENGTH = 3
USERNAME_MAX_LENGTH = 32
USERNAME_SEPARATORS = '-._'

_USERNAME_ALLOWED_RE = re.compile(r'^[A-Za-z0-9._-]+$')
_USERNAME_CONSECUTIVE_SEPARATOR_RE = re.compile(r'[-._]{2,}')
_USERNAME_CANONICAL_REMOVE_RE = re.compile(r'[-._]')


def canonicalize_username(username: str) -> str:
    return _USERNAME_CANONICAL_REMOVE_RE.sub('', username).casefold()


def validate_username(username: str) -> str:
    if username != username.strip():
        raise ValueError('Username cannot contain leading or trailing whitespace')
    if not USERNAME_MIN_LENGTH <= len(username) <= USERNAME_MAX_LENGTH:
        raise ValueError(
            f'Username must be between {USERNAME_MIN_LENGTH} and '
            f'{USERNAME_MAX_LENGTH} characters'
        )
    if not _USERNAME_ALLOWED_RE.fullmatch(username):
        raise ValueError(
            'Username can only contain letters, numbers, hyphens, '
            'underscores, and periods'
        )
    if username[0] in USERNAME_SEPARATORS or username[-1] in USERNAME_SEPARATORS:
        raise ValueError('Username cannot start or end with a separator')
    if _USERNAME_CONSECUTIVE_SEPARATOR_RE.search(username):
        raise ValueError('Username cannot contain consecutive separators')
    if len(canonicalize_username(username)) < USERNAME_MIN_LENGTH:
        raise ValueError(
            f'Username must contain at least {USERNAME_MIN_LENGTH} letters or numbers'
        )
    return username


class UserProfileUpdateRequest(BaseModel):
    username: str | None = Field(
        default=None,
        min_length=USERNAME_MIN_LENGTH,
        max_length=USERNAME_MAX_LENGTH,
    )
    first_name: str | None = Field(default=None, max_length=255)
    last_name: str | None = Field(default=None, max_length=255)
    biography: str | None = Field(default=None, max_length=2048)
    profile_picture_media_id: uuid.UUID | None = None

    @field_validator('username')
    @classmethod
    def validate_username_field(cls, username: str | None) -> str | None:
        if username is None:
            return None
        return validate_username(username)


class PasswordChangeRequest(BaseModel):
    model_config = ConfigDict(extra='forbid')

    current_password: str = Field(min_length=8, max_length=128)
    new_password: str = Field(min_length=8, max_length=128)


class UsernameAvailabilityResponse(BaseModel):
    username: str
    available: bool


class UserProfileResponse(BaseModel):
    username: str
    first_name: str
    last_name: str
    biography: str
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


class CurrentUserResponse(UserResponse):
    role: UserRole
    password_change_required: bool

    @classmethod
    def from_model(cls, user: 'User', media_base_url: str = '') -> Self:
        user_response = UserResponse.from_model(user, media_base_url=media_base_url)
        return cls(
            **user_response.model_dump(),
            role=user.role,
            password_change_required=user.password_change_required,
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


class UserSearchResultResponse(UserSummaryResponse):
    profile_picture: MediaResponse | None

    @classmethod
    def from_model(
        cls,
        user: 'User',
        media_base_url: str = '',
    ) -> Self:
        profile = user.profile
        return cls(
            **UserSummaryResponse.from_model(user).model_dump(),
            profile_picture=(
                MediaResponse.from_model(
                    profile.profile_picture,
                    media_base_url=media_base_url,
                )
                if profile and profile.profile_picture
                else None
            ),
        )


class TripMemberUserResponse(UserSummaryResponse):
    """Display-safe user data used when showing a trip's travellers."""

    profile_picture: MediaResponse | None

    @classmethod
    def from_model(
        cls,
        user: 'User',
        media_base_url: str = '',
    ) -> Self:
        profile = user.profile
        return cls(
            **UserSummaryResponse.from_model(user).model_dump(),
            profile_picture=(
                MediaResponse.from_model(
                    profile.profile_picture,
                    media_base_url=media_base_url,
                )
                if profile and profile.profile_picture
                else None
            ),
        )
