from collections.abc import Generator
from typing import Annotated, cast
import uuid

from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from jwt import InvalidTokenError
from pydantic import ValidationError
from sqlalchemy.orm import Session

from core import security
from core.config import settings
from core.db import engine
from models.api.token import TokenPayload
from models.database.user import User

reusable_oauth2 = OAuth2PasswordBearer(
    tokenUrl=f'{settings.API_V1_STR}/login/access-token'
)


def get_db() -> Generator[Session, None, None]:
    with Session(engine) as session:
        yield session


SessionDep = Annotated[Session, Depends(get_db)]
TokenDep = Annotated[str, Depends(reusable_oauth2)]


def get_current_user(
    session: Session = Depends(get_db),
    token: str = Depends(reusable_oauth2),
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


CurrentUser = Annotated[User, Depends(get_current_user)]
