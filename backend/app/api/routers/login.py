from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordRequestForm
from jwt import InvalidTokenError
from pydantic import ValidationError
from sqlalchemy import select

from api.deps import SessionDep
from core import security
from models.api.token import RefreshTokenRequest, Token, TokenPayload
from models.api.users import FirstUserCreateRequest, UserResponse
from models.database.user import User, UserProfile

router = APIRouter(prefix='/login', tags=['login'])


def _authenticate_user(
    session: SessionDep,
    email: str,
    password: str,
) -> User | None:
    statement = select(User).where(User.email == email.lower())
    user = session.execute(statement).scalar_one_or_none()
    if not user:
        return None

    is_valid, updated_hash = security.verify_password(password, user.password_hash)
    if not is_valid:
        return None

    # Rehash when pwdlib recommends a stronger/default hash configuration.
    if updated_hash:
        user.password_hash = updated_hash
        session.add(user)
        session.commit()

    return user


@router.post('/access-token')
def login_access_token(
    session: SessionDep, form_data: Annotated[OAuth2PasswordRequestForm, Depends()]
) -> Token:
    """
    OAuth2 compatible token login, get an access token for future requests
    """
    user = _authenticate_user(
        session=session,
        email=form_data.username,
        password=form_data.password,
    )
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail='Incorrect email or password',
            headers={'WWW-Authenticate': 'Bearer'},
        )

    tokens = security.create_auth_tokens(subject=user.id, email=user.email)
    return Token(**tokens)


@router.post('/refresh-token')
def refresh_tokens(session: SessionDep, payload: RefreshTokenRequest) -> Token:
    try:
        decoded = security.decode_token(
            payload.refresh_token,
            expected_type=security.TOKEN_TYPE_REFRESH,
        )
        token_data = TokenPayload(**decoded)
    except InvalidTokenError, ValidationError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail='Invalid refresh token',
            headers={
                'WWW-Authenticate': 'Bearer',
            },
        )

    statement = select(User).where(User.id == token_data.sub)
    user = session.execute(statement).scalar_one_or_none()
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail='Invalid refresh token',
            headers={
                'WWW-Authenticate': 'Bearer',
            },
        )

    tokens = security.create_auth_tokens(subject=user.id, email=user.email)
    return Token(**tokens)


@router.post(
    '/first-user',
    response_model=UserResponse,
    status_code=status.HTTP_201_CREATED,
)
def create_first_user(
    session: SessionDep, payload: FirstUserCreateRequest
) -> UserResponse:
    existing_user = session.execute(select(User.id).limit(1)).first()
    if existing_user is not None:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail='First user already exists',
        )

    user = User(
        email=payload.email.lower(),
        password_hash=security.get_password_hash(payload.password),
        password_version='argon2id',
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

    return UserResponse(id=user.id, email=user.email)
