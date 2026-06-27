import uuid
from typing import Literal

from pydantic import BaseModel, EmailStr, Field


class FirstUserCreateRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)
    username: str = Field(min_length=3, max_length=255)
    first_name: str = Field(min_length=1, max_length=255)
    last_name: str = Field(min_length=1, max_length=255)


class FirstUserCreateResponse(BaseModel):
    id: uuid.UUID
    email: EmailStr


class PlaceImportRequest(BaseModel):
    dataset: Literal['cities500', 'allCountries']


class PlaceImportResponse(BaseModel):
    dataset: Literal['cities500', 'allCountries']
    processed: int
