import uuid

from pydantic import BaseModel, EmailStr, Field


class UserResponse(BaseModel):
    id: uuid.UUID
    email: str


class FirstUserCreateRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)
    username: str = Field(min_length=3, max_length=255)
    first_name: str = Field(min_length=1, max_length=255)
    last_name: str = Field(min_length=1, max_length=255)
