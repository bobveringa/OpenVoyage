import uuid
import logging
from typing import Annotated, NoReturn

from fastapi import APIRouter, HTTPException, Path, Query, Response
from starlette import status
from starlette.requests import Request

from api.deps import (
    AuthenticatedUser,
    CurrentUser,
    GpsPrivacyZoneServiceDep,
    OptionalCurrentUser,
    PaginationDep,
    UserPreferencesServiceDep,
    UserServiceDep,
)
from core import security
from models.api.pagination import PaginatedResponse
from models.api.gps_privacy_zones import (
    GpsPrivacyZoneEnvelope,
    GpsPrivacyZoneRequest,
    GpsPrivacyZoneResponse,
)
from models.api.users import (
    CurrentUserResponse,
    PasswordChangeRequest,
    USERNAME_MAX_LENGTH,
    USERNAME_MIN_LENGTH,
    UserProfileUpdateRequest,
    UserResponse,
    UserSearchResultResponse,
    UsernameAvailabilityResponse,
    validate_username,
)
from models.api.user_preferences import (
    UserPreferencesPatch,
    UserPreferencesResponse,
)
from services.user_service import (
    ProfilePictureMediaTypeError,
    ProfilePictureNotFoundError,
    ProfilePictureOwnershipError,
    UsernameAlreadyExistsError,
    UserNotFoundError,
    CurrentPasswordIncorrectError,
    NewPasswordMatchesCurrentError,
)
from services.user_preferences_service import (
    StoredUserPreferencesError,
    UserPreferencesRecord,
)
from models.api.token import Token
from services.gps.privacy_zone_service import (
    PrivacyZoneLimitError,
    PrivacyZoneNotFoundError,
)

router = APIRouter(prefix='/users', tags=['users'])
logger = logging.getLogger(__name__)


@router.get('', response_model=PaginatedResponse[UserSearchResultResponse])
def search_users(
    request: Request,
    user: CurrentUser,
    user_service: UserServiceDep,
    pagination: PaginationDep,
    query: Annotated[str, Query(min_length=1, max_length=320)],
    exclude_current_user: Annotated[bool, Query()] = False,
) -> PaginatedResponse[UserSearchResultResponse]:
    results, total = user_service.search_users(
        query=query,
        offset=pagination.offset,
        limit=pagination.page_size,
        exclude_user_id=user.id if exclude_current_user else None,
    )

    media_base_url = str(request.base_url).rstrip('/')
    return PaginatedResponse[UserSearchResultResponse](
        items=[
            UserSearchResultResponse.from_model(
                result,
                media_base_url=media_base_url,
            )
            for result in results
        ],
        total=total,
        page=pagination.page,
        page_size=pagination.page_size,
    )


@router.get('/me', response_model=CurrentUserResponse)
def read_user(request: Request, user: AuthenticatedUser) -> CurrentUserResponse:
    media_base_url = str(request.base_url).rstrip('/')
    return CurrentUserResponse.from_model(user, media_base_url=media_base_url)


@router.get('/me/preferences', response_model=UserPreferencesResponse)
def get_user_preferences(
    response: Response,
    user: CurrentUser,
    preferences_service: UserPreferencesServiceDep,
) -> UserPreferencesResponse:
    response.headers['Cache-Control'] = 'no-store'
    try:
        record = preferences_service.get_preferences(user.id)
    except StoredUserPreferencesError as exc:
        _raise_invalid_stored_preferences(user.id, exc)
    return _preferences_response(record)


@router.patch('/me/preferences', response_model=UserPreferencesResponse)
def patch_user_preferences(
    response: Response,
    payload: UserPreferencesPatch,
    user: CurrentUser,
    preferences_service: UserPreferencesServiceDep,
) -> UserPreferencesResponse:
    response.headers['Cache-Control'] = 'no-store'
    try:
        record = preferences_service.update_preferences(user.id, payload)
    except StoredUserPreferencesError as exc:
        _raise_invalid_stored_preferences(user.id, exc)
    return _preferences_response(record)


def _preferences_response(record: UserPreferencesRecord) -> UserPreferencesResponse:
    return UserPreferencesResponse(
        time_format=record.time_format,
        theme_palette=record.theme_palette,
        updated_at=record.updated_at,
    )


def _raise_invalid_stored_preferences(
    user_id: uuid.UUID,
    error: StoredUserPreferencesError,
) -> NoReturn:
    logger.exception('Stored user preferences are invalid for user %s', user_id)
    raise HTTPException(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        detail='Stored user preferences are invalid',
    ) from error


@router.put('/me/password', response_model=Token)
def change_password(
    response: Response,
    payload: PasswordChangeRequest,
    user: AuthenticatedUser,
    user_service: UserServiceDep,
) -> Token:
    try:
        updated_user = user_service.change_password(
            user_id=user.id,
            payload=payload,
        )
    except (CurrentPasswordIncorrectError, NewPasswordMatchesCurrentError) as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(exc),
        ) from exc

    tokens = security.create_auth_tokens(
        subject=updated_user.id,
        email=updated_user.email,
        auth_version=updated_user.auth_version,
    )
    response.headers['Cache-Control'] = 'no-store'
    return Token(**tokens)


@router.post('/me/sign-out-all', status_code=status.HTTP_204_NO_CONTENT)
def sign_out_all(
    user: CurrentUser,
    user_service: UserServiceDep,
) -> None:
    user_service.sign_out_all(user_id=user.id)


@router.patch('/me', response_model=CurrentUserResponse)
def update_user_profile(
    request: Request,
    payload: UserProfileUpdateRequest,
    user: CurrentUser,
    user_service: UserServiceDep,
) -> CurrentUserResponse:
    try:
        updated_user = user_service.update_profile(user=user, payload=payload)
    except ProfilePictureNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc))
    except ProfilePictureOwnershipError as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc))
    except ProfilePictureMediaTypeError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))
    except UsernameAlreadyExistsError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc))

    media_base_url = str(request.base_url).rstrip('/')
    return CurrentUserResponse.from_model(updated_user, media_base_url=media_base_url)


# ---------------------------------------------------------------------------
# GPS privacy zones
#
# Declared as static ``/me/...`` routes so they are matched before ``/{user_id}``.
# A zone's configuration never leaves its owner's account, so every route here
# is scoped to the authenticated user and none of them accept a user id.
# ---------------------------------------------------------------------------
@router.get(
    '/me/gps-privacy-zones',
    response_model=list[GpsPrivacyZoneResponse],
)
def list_gps_privacy_zones(
    user: CurrentUser,
    privacy_zone_service: GpsPrivacyZoneServiceDep,
    response: Response,
) -> list[GpsPrivacyZoneResponse]:
    response.headers['Cache-Control'] = 'no-store'
    return [
        GpsPrivacyZoneResponse.from_model(zone)
        for zone in privacy_zone_service.list_zones(user_id=user.id)
    ]


@router.post(
    '/me/gps-privacy-zones',
    response_model=GpsPrivacyZoneEnvelope,
    status_code=status.HTTP_201_CREATED,
)
def create_gps_privacy_zone(
    payload: GpsPrivacyZoneRequest,
    user: CurrentUser,
    privacy_zone_service: GpsPrivacyZoneServiceDep,
) -> GpsPrivacyZoneEnvelope:
    try:
        zone = privacy_zone_service.create_zone(user_id=user.id, payload=payload)
    except PrivacyZoneLimitError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=str(exc),
        )

    return GpsPrivacyZoneEnvelope(zone=GpsPrivacyZoneResponse.from_model(zone))


@router.put(
    '/me/gps-privacy-zones/{zone_id}',
    response_model=GpsPrivacyZoneEnvelope,
)
def replace_gps_privacy_zone(
    zone_id: uuid.UUID,
    payload: GpsPrivacyZoneRequest,
    user: CurrentUser,
    privacy_zone_service: GpsPrivacyZoneServiceDep,
) -> GpsPrivacyZoneEnvelope:
    """Replace a zone. This never creates one; an unknown id is a 404.

    Existing retained coordinates are untouched: a zone only ever filters
    uploads processed after it was stored.
    """
    try:
        zone = privacy_zone_service.replace_zone(
            user_id=user.id,
            zone_id=zone_id,
            payload=payload,
        )
    except PrivacyZoneNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc))

    return GpsPrivacyZoneEnvelope(zone=GpsPrivacyZoneResponse.from_model(zone))


@router.delete(
    '/me/gps-privacy-zones/{zone_id}',
    status_code=status.HTTP_204_NO_CONTENT,
)
def delete_gps_privacy_zone(
    zone_id: uuid.UUID,
    user: CurrentUser,
    privacy_zone_service: GpsPrivacyZoneServiceDep,
) -> Response:
    try:
        privacy_zone_service.delete_zone(user_id=user.id, zone_id=zone_id)
    except PrivacyZoneNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc))

    return Response(
        status_code=status.HTTP_204_NO_CONTENT,
    )


@router.get(
    '/username-availability',
    response_model=UsernameAvailabilityResponse,
)
def check_username_availability(
    user_service: UserServiceDep,
    user: OptionalCurrentUser,
    username: Annotated[
        str,
        Query(min_length=USERNAME_MIN_LENGTH, max_length=USERNAME_MAX_LENGTH),
    ],
) -> UsernameAvailabilityResponse:
    try:
        validate_username(username)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=str(exc),
        ) from exc

    return UsernameAvailabilityResponse(
        username=username,
        available=user_service.is_username_available(
            username=username,
            exclude_user_id=user.id if user else None,
        ),
    )


@router.get('/by-username/{username}', response_model=UserResponse)
def get_user_by_username(
    request: Request,
    user_service: UserServiceDep,
    username: Annotated[str, Path(min_length=1, max_length=255)],
) -> UserResponse:
    try:
        user = user_service.get_user_by_username(username)
    except UserNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc))

    media_base_url = str(request.base_url).rstrip('/')
    return UserResponse.from_model(user, media_base_url=media_base_url)


@router.get('/{user_id}', response_model=UserResponse)
def get_user_by_id(
    request: Request,
    user_service: UserServiceDep,
    user_id: uuid.UUID,
) -> UserResponse:
    try:
        user = user_service.get_user_by_id(user_id)
    except UserNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc))

    media_base_url = str(request.base_url).rstrip('/')
    return UserResponse.from_model(user, media_base_url=media_base_url)
