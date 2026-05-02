from collections.abc import Generator
from typing import Annotated, cast
import uuid

from fastapi import Depends, HTTPException, status, BackgroundTasks
from fastapi.security import OAuth2PasswordBearer
from jwt import InvalidTokenError
from pydantic import ValidationError
from sqlalchemy.orm import Session

from core import security
from core.config import settings
from core.db import engine
from models.api.token import TokenPayload
from models.database.user import User
from services.media_service import MediaService

reusable_oauth2 = OAuth2PasswordBearer(
    tokenUrl=f'{settings.API_V1_STR}/login/access-token'
)


def get_db() -> Generator[Session, None, None]:
    with Session(engine) as session:
        yield session


SessionDep = Annotated[Session, Depends(get_db)]
TokenDep = Annotated[str, Depends(reusable_oauth2)]


def get_current_user(
    session: SessionDep,
    token: TokenDep,
) -> User:
    try:
        payload = security.decode_token(token, expected_type=security.TOKEN_TYPE_ACCESS)
        token_data = TokenPayload(**payload)
    except InvalidTokenError, ValidationError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail='Could not validate credentials',
            headers={'WWW-Authenticate': 'Bearer'},
        )

    try:
        user_id = uuid.UUID(token_data.sub)
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail='Could not validate credentials',
            headers={'WWW-Authenticate': 'Bearer'},
        )

    user = session.get(User, user_id)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail='Could not validate credentials',
            headers={'WWW-Authenticate': 'Bearer'},
        )

    return cast(User, user)


def get_current_admin_user(
    session: SessionDep,
    token: TokenDep,
) -> User:
    user = get_current_user(session=session, token=token)
    if user.role != 'ADMIN':
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail='The user does not have enough privileges',
        )
    return user


def get_media_service(
    session: SessionDep,
    background_tasks: BackgroundTasks,
):
    media_service = MediaService(
        db=session,
        background_tasks=background_tasks,
    )
    return media_service


CurrentUser = Annotated[User, Depends(get_current_user)]
CurrentAdmin = Annotated[User, Depends(get_current_admin_user)]
MediaServiceDep = Annotated[MediaService, Depends(get_media_service)]
