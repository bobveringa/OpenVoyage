import uuid

from fastapi import APIRouter, HTTPException
from sqlalchemy import select
from starlette import status

from api.deps import SessionDep
from core import security
from models.api.admin import (
    FirstUserCreateRequest,
    FirstUserCreateResponse,
)
from models.database.user import User, UserProfile, UserRole

router = APIRouter(prefix='/admin', tags=['admin'])


@router.post(
    '/first-user',
    response_model=FirstUserCreateResponse,
    status_code=status.HTTP_201_CREATED,
)
def create_first_user(
    session: SessionDep, payload: FirstUserCreateRequest
) -> FirstUserCreateResponse:
    existing_user = session.execute(select(User.id).limit(1)).first()
    if existing_user is not None:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail='First user already exists',
        )

    user_id = uuid.uuid4()
    user = User(
        id=user_id,
        email=payload.email.lower(),
        password_hash=security.get_password_hash(payload.password),
        role=UserRole.ADMIN,
    )
    profile = UserProfile(
        user=user,
        username=payload.username,
        first_name=payload.first_name,
        last_name=payload.last_name,
    )

    session.add(user)
    session.add(profile)
    session.commit()
    session.refresh(user)

    return FirstUserCreateResponse(
        id=user.id,
        email=user.email,
    )
