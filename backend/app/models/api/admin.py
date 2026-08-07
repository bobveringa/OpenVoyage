import uuid

from pydantic import BaseModel, EmailStr, Field, field_validator

from models.api.users import (
    USERNAME_MAX_LENGTH,
    USERNAME_MIN_LENGTH,
    validate_username,
)


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
