import uuid
from typing import Annotated

from fastapi import APIRouter, HTTPException, Query
from starlette import status
from starlette.requests import Request

from api.deps import CurrentUser, OptionalCurrentUser, PaginationDep, PostServiceDep
from models.api.pagination import PaginatedResponse, SortDirection
from models.api.posts import (
    PostCreateRequest,
    PostResponse,
    PostSortField,
    PostStatusFilter,
    PostUpdateRequest,
)
from services.post_service import (
    DuplicatePostMediaError,
    LocationNotFoundError,
    MediaNotFoundError,
    PostMediaOwnershipError,
    PostNotFoundError,
    PostPermissionError,
    TripNotFoundError,
)

router = APIRouter(prefix='/trips/{trip_id}/posts', tags=['posts'])


@router.post(
    '',
    status_code=status.HTTP_201_CREATED,
    response_model=PostResponse,
)
def create_post(
    request: Request,
    trip_id: uuid.UUID,
    payload: PostCreateRequest,
    post_service: PostServiceDep,
    user: CurrentUser,
) -> PostResponse:
    try:
        post = post_service.create_post(
            trip_id=trip_id,
            payload=payload,
            current_user_id=user.id,
        )
    except (TripNotFoundError, LocationNotFoundError, MediaNotFoundError) as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc))
    except (PostPermissionError, PostMediaOwnershipError) as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc))
    except DuplicatePostMediaError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))

    media_base_url = str(request.base_url).rstrip('/')
    return PostResponse.from_model(post, media_base_url=media_base_url)


@router.get(
    '',
    response_model=PaginatedResponse[PostResponse],
)
def list_posts(
    request: Request,
    trip_id: uuid.UUID,
    post_service: PostServiceDep,
    user: OptionalCurrentUser,
    pagination: PaginationDep,
    sort_by: Annotated[PostSortField, Query()] = PostSortField.OCCURRED_AT,
    sort_order: Annotated[SortDirection, Query()] = SortDirection.DESC,
    status_filter: Annotated[
        PostStatusFilter,
        Query(alias='status'),
    ] = PostStatusFilter.PUBLISHED,
) -> PaginatedResponse[PostResponse]:
    try:
        posts, total = post_service.list_posts(
            trip_id=trip_id,
            current_user_id=user.id if user else None,
            offset=pagination.offset,
            limit=pagination.page_size,
            sort_by=sort_by,
            sort_order=sort_order,
            status_filter=status_filter,
        )
    except TripNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc))
    except PostPermissionError as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc))

    media_base_url = str(request.base_url).rstrip('/')
    return PaginatedResponse[PostResponse](
        items=[
            PostResponse.from_model(post, media_base_url=media_base_url)
            for post in posts
        ],
        total=total,
        page=pagination.page,
        page_size=pagination.page_size,
    )


@router.get(
    '/{post_id}',
    response_model=PostResponse,
)
def get_post(
    request: Request,
    trip_id: uuid.UUID,
    post_id: uuid.UUID,
    post_service: PostServiceDep,
    user: OptionalCurrentUser,
) -> PostResponse:
    try:
        post = post_service.get_post(
            trip_id=trip_id,
            post_id=post_id,
            current_user_id=user.id if user else None,
        )
    except (TripNotFoundError, PostNotFoundError) as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc))
    except PostPermissionError as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc))

    media_base_url = str(request.base_url).rstrip('/')
    return PostResponse.from_model(post, media_base_url=media_base_url)


@router.patch(
    '/{post_id}',
    response_model=PostResponse,
)
def update_post(
    request: Request,
    trip_id: uuid.UUID,
    post_id: uuid.UUID,
    payload: PostUpdateRequest,
    post_service: PostServiceDep,
    user: CurrentUser,
) -> PostResponse:
    try:
        post = post_service.update_post(
            trip_id=trip_id,
            post_id=post_id,
            payload=payload,
            current_user_id=user.id,
        )
    except (TripNotFoundError, PostNotFoundError, LocationNotFoundError) as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc))
    except (PostPermissionError, PostMediaOwnershipError) as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc))
    except MediaNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc))
    except DuplicatePostMediaError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))

    media_base_url = str(request.base_url).rstrip('/')
    return PostResponse.from_model(post, media_base_url=media_base_url)


@router.post(
    '/{post_id}/publish',
    response_model=PostResponse,
)
def publish_post(
    request: Request,
    trip_id: uuid.UUID,
    post_id: uuid.UUID,
    post_service: PostServiceDep,
    user: CurrentUser,
) -> PostResponse:
    try:
        post = post_service.publish_post(
            trip_id=trip_id,
            post_id=post_id,
            current_user_id=user.id,
        )
    except (TripNotFoundError, PostNotFoundError) as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc))
    except PostPermissionError as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc))

    media_base_url = str(request.base_url).rstrip('/')
    return PostResponse.from_model(post, media_base_url=media_base_url)


@router.post(
    '/{post_id}/unpublish',
    response_model=PostResponse,
)
def unpublish_post(
    request: Request,
    trip_id: uuid.UUID,
    post_id: uuid.UUID,
    post_service: PostServiceDep,
    user: CurrentUser,
) -> PostResponse:
    try:
        post = post_service.unpublish_post(
            trip_id=trip_id,
            post_id=post_id,
            current_user_id=user.id,
        )
    except (TripNotFoundError, PostNotFoundError) as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc))
    except PostPermissionError as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc))

    media_base_url = str(request.base_url).rstrip('/')
    return PostResponse.from_model(post, media_base_url=media_base_url)


@router.delete(
    '/{post_id}',
    status_code=status.HTTP_204_NO_CONTENT,
)
def delete_post(
    trip_id: uuid.UUID,
    post_id: uuid.UUID,
    post_service: PostServiceDep,
    user: CurrentUser,
) -> None:
    try:
        post_service.delete_post(
            trip_id=trip_id,
            post_id=post_id,
            current_user_id=user.id,
        )
    except (TripNotFoundError, PostNotFoundError) as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc))
    except PostPermissionError as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc))
