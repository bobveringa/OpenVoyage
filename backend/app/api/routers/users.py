from typing import Annotated

from fastapi import APIRouter, Query

from api.deps import CurrentUser, PaginationDep, UserServiceDep
from models.api.pagination import PaginatedResponse
from models.api.users import UserResponse, UserSummaryResponse

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
        items=[
            UserSummaryResponse.from_model(result) for result in results
        ],
        total=total,
        page=pagination.page,
        page_size=pagination.page_size,
    )


@router.get('/me')
def read_user(user: CurrentUser) -> UserResponse:
    return UserResponse(
        id=user.id,
        email=user.email,
    )
