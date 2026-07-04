from collections.abc import Generator
from dataclasses import dataclass
from typing import Annotated, cast
import uuid

from fastapi import BackgroundTasks, Depends, HTTPException, Query, status
from fastapi.security import OAuth2PasswordBearer
from jwt import InvalidTokenError
from pydantic import ValidationError
from sqlalchemy.orm import Session

from core import security
from core.config import settings
from core.db import get_engine
from models.api.pagination import DEFAULT_PAGE, DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE
from models.api.token import TokenPayload
from models.database.user import User
from services.itinerary_service import ItineraryService
from services.location_service import LocationService
from services.media_service import MediaService
from services.place_service import PlaceService
from services.post_service import PostService
from services.trip_service import TripService
from services.user_service import UserService

reusable_oauth2 = OAuth2PasswordBearer(
    tokenUrl=f'{settings.API_V1_STR}/login/access-token'
)
optional_oauth2 = OAuth2PasswordBearer(
    tokenUrl=f'{settings.API_V1_STR}/login/access-token',
    auto_error=False,
)


def get_db() -> Generator[Session, None, None]:
    with Session(get_engine()) as session:
        yield session


@dataclass(frozen=True)
class PaginationParams:
    page: int
    page_size: int

    @property
    def offset(self) -> int:
        return (self.page - 1) * self.page_size


def get_pagination_params(
    page: Annotated[int, Query(ge=1)] = DEFAULT_PAGE,
    page_size: Annotated[int, Query(ge=1, le=MAX_PAGE_SIZE)] = DEFAULT_PAGE_SIZE,
) -> PaginationParams:
    return PaginationParams(page=page, page_size=page_size)


SessionDep = Annotated[Session, Depends(get_db)]
PaginationDep = Annotated[PaginationParams, Depends(get_pagination_params)]
TokenDep = Annotated[str, Depends(reusable_oauth2)]
OptionalTokenDep = Annotated[str | None, Depends(optional_oauth2)]


def _credentials_exception() -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail='Could not validate credentials',
        headers={'WWW-Authenticate': 'Bearer'},
    )


def _get_user_from_token(session: Session, token: str) -> User:
    try:
        payload = security.decode_token(token, expected_type=security.TOKEN_TYPE_ACCESS)
        token_data = TokenPayload(**payload)
    except InvalidTokenError, ValidationError:
        raise _credentials_exception()

    try:
        user_id = uuid.UUID(token_data.sub)
    except ValueError:
        raise _credentials_exception()

    user = session.get(User, user_id)
    if not user:
        raise _credentials_exception()

    return cast(User, user)


def get_current_user(
    session: SessionDep,
    token: TokenDep,
) -> User:
    return _get_user_from_token(session=session, token=token)


def get_optional_current_user(
    session: SessionDep,
    token: OptionalTokenDep,
) -> User | None:
    if token is None:
        return None
    return _get_user_from_token(session=session, token=token)


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


def get_trip_service(session: SessionDep):
    return TripService(db=session)


def get_place_service(session: SessionDep):
    return PlaceService(db=session)


def get_location_service(session: SessionDep):
    return LocationService(
        db=session,
        place_service=PlaceService(db=session),
    )


def get_itinerary_service(
    session: SessionDep,
    location_service: Annotated[LocationService, Depends(get_location_service)],
):
    return ItineraryService(
        db=session,
        location_service=location_service,
    )


def get_post_service(
    session: SessionDep,
    location_service: Annotated[LocationService, Depends(get_location_service)],
):
    return PostService(
        db=session,
        location_service=location_service,
    )


def get_user_service(session: SessionDep):
    return UserService(db=session)


CurrentUser = Annotated[User, Depends(get_current_user)]
OptionalCurrentUser = Annotated[User | None, Depends(get_optional_current_user)]
CurrentAdmin = Annotated[User, Depends(get_current_admin_user)]
MediaServiceDep = Annotated[MediaService, Depends(get_media_service)]
LocationServiceDep = Annotated[LocationService, Depends(get_location_service)]
ItineraryServiceDep = Annotated[ItineraryService, Depends(get_itinerary_service)]
PlaceServiceDep = Annotated[PlaceService, Depends(get_place_service)]
PostServiceDep = Annotated[PostService, Depends(get_post_service)]
TripServiceDep = Annotated[TripService, Depends(get_trip_service)]
UserServiceDep = Annotated[UserService, Depends(get_user_service)]
