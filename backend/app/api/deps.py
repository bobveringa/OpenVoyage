from collections.abc import Generator
from dataclasses import dataclass
from typing import Annotated, cast
import uuid

from fastapi import (
    BackgroundTasks,
    Depends,
    Header,
    HTTPException,
    Query,
    Request,
    status,
)
from fastapi.security import OAuth2PasswordBearer
from jwt import InvalidTokenError
from pydantic import ValidationError
from sqlalchemy.orm import Session

from core import security
from core.config import settings
from core.db import get_engine
from jobs.runtime import JobRuntime
from models.api.pagination import DEFAULT_PAGE, DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE
from models.api.token import TokenPayload
from models.database.user import User
from services.gps.privacy_zone_service import GpsPrivacyZoneService
from services.gps.tracking_service import GpsTrackingService
from services.job_service import JobService
from services.itinerary_routes import ItineraryRouteService
from services.app_settings_service import AppSettingsService
from services.route_providers import RouteProviderBase, RouteProviderFactory
from services.location_service import LocationService
from services.media_service import MediaService
from services.itinerary_service import ItineraryService
from services.place_service import PlaceService
from services.post_service import PostService
from services.post_timeline_service import PostTimelineService
from services.platform_authorization import PlatformPermission, role_has_permission
from services.trip_service import TripService
from services.user_service import UserService
from services.admin_user_service import AdminUserService
from services.trip_access import SHARE_TOKEN_HEADER

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


def get_job_runtime(request: Request) -> JobRuntime:
    return request.app.state.job_runtime


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
JobRuntimeDep = Annotated[JobRuntime, Depends(get_job_runtime)]
PaginationDep = Annotated[PaginationParams, Depends(get_pagination_params)]
TokenDep = Annotated[str, Depends(reusable_oauth2)]
OptionalTokenDep = Annotated[str | None, Depends(optional_oauth2)]
ShareToken = Annotated[str | None, Header(alias=SHARE_TOKEN_HEADER)]


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
    except (InvalidTokenError, ValidationError):
        raise _credentials_exception()

    try:
        user_id = uuid.UUID(token_data.sub)
    except ValueError:
        raise _credentials_exception()

    user = session.get(User, user_id)
    if not user or token_data.ver != user.auth_version:
        raise _credentials_exception()

    return cast(User, user)


def get_authenticated_user(
    session: SessionDep,
    token: TokenDep,
) -> User:
    return _get_user_from_token(session=session, token=token)


def get_current_user(
    user: Annotated[User, Depends(get_authenticated_user)],
) -> User:
    if user.password_change_required:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail='Password change required',
        )
    return user


def get_optional_current_user(
    session: SessionDep,
    token: OptionalTokenDep,
) -> User | None:
    if token is None:
        return None
    user = _get_user_from_token(session=session, token=token)
    if user.password_change_required:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail='Password change required',
        )
    return user


def get_current_admin_user(
    user: Annotated[User, Depends(get_current_user)],
) -> User:
    if not role_has_permission(user.role, PlatformPermission.ADMINISTER_PLATFORM):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail='The user does not have enough privileges',
        )
    return user


def get_current_trip_creator(
    user: Annotated[User, Depends(get_current_user)],
) -> User:
    if not role_has_permission(user.role, PlatformPermission.CREATE_TRIP):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail='The user does not have permission to create trips',
        )
    return user


def get_app_settings_service(session: SessionDep) -> AppSettingsService:
    return AppSettingsService(db=session)


def get_job_service(
    session: SessionDep,
    runtime: JobRuntimeDep,
) -> JobService:
    return JobService(
        db=session,
        scheduler=runtime.scheduler,
        wake_runner=runtime.runner.wake,
    )


AppSettingsServiceDep = Annotated[
    AppSettingsService,
    Depends(get_app_settings_service),
]


def get_media_service(
    session: SessionDep,
    background_tasks: BackgroundTasks,
    app_settings_service: AppSettingsServiceDep,
):
    media_service = MediaService(
        db=session,
        background_tasks=background_tasks,
        app_settings_service=app_settings_service,
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


def get_post_service(
    session: SessionDep,
    location_service: Annotated[LocationService, Depends(get_location_service)],
):
    return PostService(
        db=session,
        location_service=location_service,
    )


def get_gps_privacy_zone_service(session: SessionDep):
    return GpsPrivacyZoneService(db=session)


def get_gps_tracking_service(
    session: SessionDep,
    privacy_zones: Annotated[
        GpsPrivacyZoneService, Depends(get_gps_privacy_zone_service)
    ],
):
    return GpsTrackingService(db=session, privacy_zones=privacy_zones)


def get_post_timeline_service(
    session: SessionDep,
    gps_tracking_service: Annotated[
        GpsTrackingService, Depends(get_gps_tracking_service)
    ],
):
    return PostTimelineService(
        db=session,
        gps_tracking_service=gps_tracking_service,
    )


route_provider_factory = RouteProviderFactory()


def get_route_provider_factory() -> RouteProviderFactory:
    return route_provider_factory


def get_route_provider(
    app_settings_service: AppSettingsServiceDep,
    factory: Annotated[RouteProviderFactory, Depends(get_route_provider_factory)],
) -> RouteProviderBase | None:
    return factory.create_routing_provider(app_settings_service)


def get_itinerary_route_service(
    session: SessionDep,
    background_tasks: BackgroundTasks,
    route_provider: Annotated[RouteProviderBase | None, Depends(get_route_provider)],
):
    return ItineraryRouteService(
        db=session,
        route_provider=route_provider,
        background_tasks=background_tasks,
    )


def get_itinerary_service(
    session: SessionDep,
    location_service: Annotated[LocationService, Depends(get_location_service)],
    route_service: Annotated[
        ItineraryRouteService, Depends(get_itinerary_route_service)
    ],
):
    return ItineraryService(
        db=session,
        location_service=location_service,
        route_service=route_service,
    )


def get_user_service(session: SessionDep):
    return UserService(db=session)


def get_admin_user_service(session: SessionDep):
    return AdminUserService(db=session)


CurrentUser = Annotated[User, Depends(get_current_user)]
AuthenticatedUser = Annotated[User, Depends(get_authenticated_user)]
OptionalCurrentUser = Annotated[User | None, Depends(get_optional_current_user)]
CurrentAdmin = Annotated[User, Depends(get_current_admin_user)]
CurrentTripCreator = Annotated[User, Depends(get_current_trip_creator)]
JobServiceDep = Annotated[JobService, Depends(get_job_service)]
MediaServiceDep = Annotated[MediaService, Depends(get_media_service)]
LocationServiceDep = Annotated[LocationService, Depends(get_location_service)]
ItineraryRouteServiceDep = Annotated[
    ItineraryRouteService, Depends(get_itinerary_route_service)
]
ItineraryServiceDep = Annotated[ItineraryService, Depends(get_itinerary_service)]
PlaceServiceDep = Annotated[PlaceService, Depends(get_place_service)]
PostServiceDep = Annotated[PostService, Depends(get_post_service)]
PostTimelineServiceDep = Annotated[
    PostTimelineService,
    Depends(get_post_timeline_service),
]
GpsTrackingServiceDep = Annotated[
    GpsTrackingService,
    Depends(get_gps_tracking_service),
]
GpsPrivacyZoneServiceDep = Annotated[
    GpsPrivacyZoneService,
    Depends(get_gps_privacy_zone_service),
]
TripServiceDep = Annotated[TripService, Depends(get_trip_service)]
UserServiceDep = Annotated[UserService, Depends(get_user_service)]
AdminUserServiceDep = Annotated[AdminUserService, Depends(get_admin_user_service)]
