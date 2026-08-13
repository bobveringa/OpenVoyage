import uuid
from typing import Annotated

from fastapi import APIRouter, HTTPException, Path, Query, Response
from starlette import status
from starlette.requests import Request

from api.deps import (
    AuthenticatedUser,
    CurrentUser,
    OptionalCurrentUser,
    PaginationDep,
    UserServiceDep,
)
from core import security
from models.api.pagination import PaginatedResponse
from models.api.users import (
    CurrentUserResponse,
    PasswordChangeRequest,
    USERNAME_MAX_LENGTH,
    USERNAME_MIN_LENGTH,
    UserProfileUpdateRequest,
    UserResponse,
    UserSummaryResponse,
    UsernameAvailabilityResponse,
    validate_username,
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
from models.api.token import Token

router = APIRouter(prefix='/users', tags=['users'])


@router.get('', response_model=PaginatedResponse[UserSummaryResponse])
def search_users(
    user: CurrentUser,
    user_service: UserServiceDep,
    pagination: PaginationDep,
    query: Annotated[str, Query(min_length=2, max_length=320)],
    exclude_current_user: Annotated[bool, Query()] = False,
) -> PaginatedResponse[UserSummaryResponse]:
    results, total = user_service.search_users(
        query=query,
        offset=pagination.offset,
        limit=pagination.page_size,
        exclude_user_id=user.id if exclude_current_user else None,
    )

    return PaginatedResponse[UserSummaryResponse](
        items=[UserSummaryResponse.from_model(result) for result in results],
        total=total,
        page=pagination.page,
        page_size=pagination.page_size,
    )


@router.get('/me', response_model=CurrentUserResponse)
def read_user(request: Request, user: AuthenticatedUser) -> CurrentUserResponse:
    media_base_url = str(request.base_url).rstrip('/')
    return CurrentUserResponse.from_model(user, media_base_url=media_base_url)


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
