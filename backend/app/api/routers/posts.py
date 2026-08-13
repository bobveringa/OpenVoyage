import uuid
from typing import Annotated

from fastapi import APIRouter, HTTPException, Query
from starlette import status
from starlette.requests import Request

from core import security
from api.deps import (
    CurrentUser,
    OptionalCurrentUser,
    PaginationDep,
    PostServiceDep,
    PostTimelineServiceDep,
    ShareToken,
)
from models.api.pagination import PaginatedResponse, SortDirection
from models.api.posts import (
    PostCreateRequest,
    PostResponse,
    PostSortField,
    PostStatusFilter,
    PostTimelineEntryResponse,
    PostUpdateRequest,
)
from services.location_service import LocationNotFoundError
from services.post_service import (
    DuplicatePostMediaError,
    MediaNotFoundError,
    PostMediaOwnershipError,
    PostNotFoundError,
    PostPermissionError,
    TripNotFoundError,
)

router = APIRouter(prefix='/trips/{trip_id}/posts', tags=['posts'])


def _post_response(
    post,
    media_base_url: str,
    *,
    user=None,
    share_token: str | None = None,
) -> PostResponse:
    media_token_factory = (
        security.create_media_url_token if user or share_token else None
    )
    return PostResponse.from_model(
        post,
        media_base_url=media_base_url,
        media_token_factory=media_token_factory,
    )


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
    return _post_response(post, media_base_url=media_base_url, user=user)


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
    share_token: ShareToken = None,
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
            share_token=share_token,
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
            _post_response(
                post,
                media_base_url=media_base_url,
                user=user,
                share_token=share_token,
            )
            for post in posts
        ],
        total=total,
        page=pagination.page,
        page_size=pagination.page_size,
    )


@router.get(
    '/timeline',
    response_model=list[PostTimelineEntryResponse],
)
def get_post_timeline(
    request: Request,
    trip_id: uuid.UUID,
    post_timeline_service: PostTimelineServiceDep,
    user: OptionalCurrentUser,
    share_token: ShareToken = None,
    status_filter: Annotated[
        PostStatusFilter,
        Query(alias='status'),
    ] = PostStatusFilter.PUBLISHED,
) -> list[PostTimelineEntryResponse]:
    try:
        entries = post_timeline_service.get_timeline(
            trip_id=trip_id,
            current_user_id=user.id if user else None,
            share_token=share_token,
            status_filter=status_filter,
        )
    except TripNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc))

    media_base_url = str(request.base_url).rstrip('/')
    return [
        PostTimelineEntryResponse(
            post=_post_response(
                entry.post,
                media_base_url=media_base_url,
                user=user,
                share_token=share_token,
            ),
            route_after=entry.route_after,
        )
        for entry in entries
    ]


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
    share_token: ShareToken = None,
) -> PostResponse:
    try:
        post = post_service.get_post(
            trip_id=trip_id,
            post_id=post_id,
            current_user_id=user.id if user else None,
            share_token=share_token,
        )
    except (TripNotFoundError, PostNotFoundError) as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc))
    except PostPermissionError as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc))

    media_base_url = str(request.base_url).rstrip('/')
    return _post_response(
        post,
        media_base_url=media_base_url,
        user=user,
        share_token=share_token,
    )


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
    return _post_response(post, media_base_url=media_base_url, user=user)


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
    return _post_response(post, media_base_url=media_base_url, user=user)


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
    return _post_response(post, media_base_url=media_base_url, user=user)


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
