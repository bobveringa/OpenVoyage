from typing import Annotated

from fastapi import APIRouter, HTTPException, Query
from starlette import status
from starlette.requests import Request

from api.deps import CurrentUser, PaginationDep, UserServiceDep
from models.api.pagination import PaginatedResponse
from models.api.users import (
    UserProfileUpdateRequest,
    UserResponse,
    UserSummaryResponse,
)
from services.user_service import (
    ProfilePictureMediaTypeError,
    ProfilePictureNotFoundError,
    ProfilePictureOwnershipError,
)

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


@router.get('/me', response_model=UserResponse)
def read_user(request: Request, user: CurrentUser) -> UserResponse:
    media_base_url = str(request.base_url).rstrip('/')
    return UserResponse.from_model(user, media_base_url=media_base_url)


@router.patch('/me', response_model=UserResponse)
def update_user_profile(
    request: Request,
    payload: UserProfileUpdateRequest,
    user: CurrentUser,
    user_service: UserServiceDep,
) -> UserResponse:
    try:
        updated_user = user_service.update_profile(user=user, payload=payload)
    except ProfilePictureNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc))
    except ProfilePictureOwnershipError as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc))
    except ProfilePictureMediaTypeError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))

    media_base_url = str(request.base_url).rstrip('/')
    return UserResponse.from_model(updated_user, media_base_url=media_base_url)
