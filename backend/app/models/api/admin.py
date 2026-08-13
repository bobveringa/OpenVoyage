import uuid
from datetime import datetime
from typing import TYPE_CHECKING, Self

from pydantic import (
    BaseModel,
    ConfigDict,
    EmailStr,
    Field,
    field_validator,
    model_validator,
)

from models.api.users import (
    USERNAME_MAX_LENGTH,
    USERNAME_MIN_LENGTH,
    validate_username,
)
from models.database.user import UserRole

if TYPE_CHECKING:
    from models.database.user import User


class FirstUserCreateRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)
    username: str = Field(
        min_length=USERNAME_MIN_LENGTH, max_length=USERNAME_MAX_LENGTH
    )
    first_name: str = Field(min_length=1, max_length=255)
    last_name: str = Field(min_length=1, max_length=255)

    @field_validator('username')
    @classmethod
    def validate_username_field(cls, username: str) -> str:
        return validate_username(username)


class FirstUserCreateResponse(BaseModel):
    id: uuid.UUID
    email: EmailStr


class AdminUserResponse(BaseModel):
    id: uuid.UUID
    email: EmailStr
    username: str
    first_name: str
    last_name: str
    role: UserRole
    password_change_required: bool
    created_at: datetime
    updated_at: datetime

    @classmethod
    def from_model(cls, user: 'User') -> Self:
        profile = user.profile
        if profile is None:
            raise ValueError(f'User profile is missing: {user.id}')
        return cls(
            id=user.id,
            email=user.email,
            username=profile.username,
            first_name=profile.first_name,
            last_name=profile.last_name,
            role=user.role,
            password_change_required=user.password_change_required,
            created_at=user.created_at,
            updated_at=user.updated_at,
        )


class AdminUserCreateRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)
    require_password_change: bool = True
    username: str = Field(
        min_length=USERNAME_MIN_LENGTH, max_length=USERNAME_MAX_LENGTH
    )
    first_name: str = Field(min_length=1, max_length=255)
    last_name: str = Field(min_length=1, max_length=255)
    role: UserRole = UserRole.USER

    @field_validator('username')
    @classmethod
    def validate_username_field(cls, username: str) -> str:
        return validate_username(username)


class AdminUserUpdateRequest(BaseModel):
    model_config = ConfigDict(extra='forbid')

    email: EmailStr | None = None
    username: str | None = Field(
        default=None,
        min_length=USERNAME_MIN_LENGTH,
        max_length=USERNAME_MAX_LENGTH,
    )
    first_name: str | None = Field(default=None, max_length=255)
    last_name: str | None = Field(default=None, max_length=255)
    role: UserRole | None = None

    @field_validator('username')
    @classmethod
    def validate_username_field(cls, username: str | None) -> str | None:
        if username is None:
            return None
        return validate_username(username)

    @model_validator(mode='after')
    def require_at_least_one_field(self) -> Self:
        if not self.model_fields_set:
            raise ValueError('At least one field must be provided')
        for field_name in self.model_fields_set:
            if getattr(self, field_name) is None:
                raise ValueError(f'{field_name} cannot be null')
        return self


class AdminUserPasswordSetRequest(BaseModel):
    model_config = ConfigDict(extra='forbid')

    password: str = Field(min_length=8, max_length=128)
    require_password_change: bool = True


class AdminUsersListResponse(BaseModel):
    users: list[AdminUserResponse]
    total: int = Field(ge=0)
    page: int = Field(ge=1)
    page_size: int = Field(ge=1)


class AdminUserDeleteResponse(BaseModel):
    id: uuid.UUID
    deleted: bool = True
