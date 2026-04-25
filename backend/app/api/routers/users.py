from fastapi import APIRouter

from api.deps import CurrentUser
from models.api.users import UserResponse

router = APIRouter(prefix='/users', tags=['users'])


@router.get('/me')
def read_user(user: CurrentUser) -> UserResponse:
    return UserResponse(
        id=user.id,
        email=user.email,
    )
