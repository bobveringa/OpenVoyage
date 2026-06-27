import uuid
from typing import TYPE_CHECKING, Self

from pydantic import BaseModel

if TYPE_CHECKING:
    from models.database.user import User


class UserResponse(BaseModel):
    id: uuid.UUID
    email: str


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
