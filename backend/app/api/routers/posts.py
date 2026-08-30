import uuid
from typing import Annotated

from fastapi import APIRouter, HTTPException, Query, Response
from starlette import status
from starlette.requests import Request

from core import security
from api.deps import (
    CurrentUser,
    OptionalCurrentUser,
    PaginationDep,
    PostServiceDep,
    PostSocialServiceDep,
    PostTimelineServiceDep,
    ShareToken,
)
from models.api.pagination import (
    CursorPaginatedResponse,
    PaginatedResponse,
    SortDirection,
)
from models.api.posts import (
    PostCreateRequest,
    PostCommentCreateRequest,
    PostCommentResponse,
    PostResponse,
    PostSocialSummaryResponse,
    PostSortField,
    PostStatusFilter,
    PostTimelineEntryResponse,
    PostTimelineOpeningRouteResponse,
    PostTimelineResponse,
    PostUpdateRequest,
)
from services.location_service import LocationNotFoundError
from services.post_service import (
    DuplicatePostMediaError,
    MediaNotFoundError,
    PostMediaOwnershipError,
    PostNotFoundError,
    PostPermissionError,
)
from services.trip_errors import TripNotFoundError
from services.post_social_service import (
    InvalidCommentCursorError,
    SocialNameRequiredError,
    SocialNotFoundError,
    SocialPermissionError,
)

router = APIRouter(prefix='/trips/{trip_id}/posts', tags=['posts'])


def _post_response(
    post,
    media_base_url: str,
    *,
    user=None,
    share_token: str | None = None,
    social: PostSocialSummaryResponse,
) -> PostResponse:
    media_token_factory = (
        security.create_media_url_token if user or share_token else None
    )
    return PostResponse.from_model(
        post,
        media_base_url=media_base_url,
        media_token_factory=media_token_factory,
        social=social,
    )


def _social_error(exc: Exception) -> HTTPException:
    if isinstance(exc, SocialNotFoundError):
        return HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc))
    if isinstance(exc, SocialNameRequiredError):
        return HTTPException(
            status_code=status.HTTP_428_PRECONDITION_REQUIRED, detail=str(exc)
        )
    if isinstance(exc, InvalidCommentCursorError):
        return HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=str(exc)
        )
    return HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc))


@router.post(
    '',
    status_code=status.HTTP_201_CREATED,
    response_model=PostResponse,
)
def create_post(
    request: Request,
    response: Response,
    trip_id: uuid.UUID,
    payload: PostCreateRequest,
    post_service: PostServiceDep,
    social_service: PostSocialServiceDep,
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
    social = social_service.get_summary(
        trip_id=trip_id,
        post_id=post.id,
        current_user_id=user.id,
        share_token=None,
    )
    response.headers['Cache-Control'] = 'private, no-store'
    return _post_response(post, media_base_url=media_base_url, user=user, social=social)


@router.get(
    '',
    response_model=PaginatedResponse[PostResponse],
)
def list_posts(
    request: Request,
    response: Response,
    trip_id: uuid.UUID,
    post_service: PostServiceDep,
    social_service: PostSocialServiceDep,
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
    summaries = social_service.get_summaries(
        trip_id=trip_id,
        post_ids=[post.id for post in posts],
        current_user_id=user.id if user else None,
        share_token=share_token,
    )
    response.headers['Cache-Control'] = 'private, no-store'
    return PaginatedResponse[PostResponse](
        items=[
            _post_response(
                post,
                media_base_url=media_base_url,
                user=user,
                share_token=share_token,
                social=summaries[post.id],
            )
            for post in posts
        ],
        total=total,
        page=pagination.page,
        page_size=pagination.page_size,
    )


@router.get(
    '/timeline',
    response_model=PostTimelineResponse,
)
def get_post_timeline(
    request: Request,
    response: Response,
    trip_id: uuid.UUID,
    post_timeline_service: PostTimelineServiceDep,
    social_service: PostSocialServiceDep,
    user: OptionalCurrentUser,
    share_token: ShareToken = None,
    status_filter: Annotated[
        PostStatusFilter,
        Query(alias='status'),
    ] = PostStatusFilter.PUBLISHED,
) -> PostTimelineResponse:
    try:
        timeline = post_timeline_service.get_timeline(
            trip_id=trip_id,
            current_user_id=user.id if user else None,
            share_token=share_token,
            status_filter=status_filter,
        )
    except TripNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc))

    response.headers['Cache-Control'] = 'private, no-store'
    if timeline.carries_unbounded_open_geometry:
        # Geometry no visible post bounds from above carries a coordinate
        # recorded moments ago, so it must not sit in a shared cache. A route
        # that ends at a published post is as fresh as that post and stays
        # ordinarily cacheable.
        response.headers['Cache-Control'] = 'no-store'

    media_base_url = str(request.base_url).rstrip('/')
    summaries = social_service.get_summaries(
        trip_id=trip_id,
        post_ids=[entry.post.id for entry in timeline.entries],
        current_user_id=user.id if user else None,
        share_token=share_token,
    )
    return PostTimelineResponse(
        opening_route=(
            PostTimelineOpeningRouteResponse(segments=timeline.opening_segments)
            if timeline.opening_segments
            else None
        ),
        entries=[
            PostTimelineEntryResponse(
                post=_post_response(
                    entry.post,
                    media_base_url=media_base_url,
                    user=user,
                    share_token=share_token,
                    social=summaries[entry.post.id],
                ),
                route_after=entry.route_after,
            )
            for entry in timeline.entries
        ],
    )


@router.get(
    '/{post_id}',
    response_model=PostResponse,
)
def get_post(
    request: Request,
    response: Response,
    trip_id: uuid.UUID,
    post_id: uuid.UUID,
    post_service: PostServiceDep,
    social_service: PostSocialServiceDep,
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
    social = social_service.get_summary(
        trip_id=trip_id,
        post_id=post.id,
        current_user_id=user.id if user else None,
        share_token=share_token,
    )
    response.headers['Cache-Control'] = 'private, no-store'
    return _post_response(
        post,
        media_base_url=media_base_url,
        user=user,
        share_token=share_token,
        social=social,
    )


@router.patch(
    '/{post_id}',
    response_model=PostResponse,
)
def update_post(
    request: Request,
    response: Response,
    trip_id: uuid.UUID,
    post_id: uuid.UUID,
    payload: PostUpdateRequest,
    post_service: PostServiceDep,
    social_service: PostSocialServiceDep,
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
    social = social_service.get_summary(
        trip_id=trip_id,
        post_id=post.id,
        current_user_id=user.id,
        share_token=None,
    )
    response.headers['Cache-Control'] = 'private, no-store'
    return _post_response(post, media_base_url=media_base_url, user=user, social=social)


@router.post(
    '/{post_id}/publish',
    response_model=PostResponse,
)
def publish_post(
    request: Request,
    response: Response,
    trip_id: uuid.UUID,
    post_id: uuid.UUID,
    post_service: PostServiceDep,
    social_service: PostSocialServiceDep,
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
    social = social_service.get_summary(
        trip_id=trip_id,
        post_id=post.id,
        current_user_id=user.id,
        share_token=None,
    )
    response.headers['Cache-Control'] = 'private, no-store'
    return _post_response(post, media_base_url=media_base_url, user=user, social=social)


@router.post(
    '/{post_id}/unpublish',
    response_model=PostResponse,
)
def unpublish_post(
    request: Request,
    response: Response,
    trip_id: uuid.UUID,
    post_id: uuid.UUID,
    post_service: PostServiceDep,
    social_service: PostSocialServiceDep,
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
    social = social_service.get_summary(
        trip_id=trip_id,
        post_id=post.id,
        current_user_id=user.id,
        share_token=None,
    )
    response.headers['Cache-Control'] = 'private, no-store'
    return _post_response(post, media_base_url=media_base_url, user=user, social=social)


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


@router.put('/{post_id}/like', response_model=PostSocialSummaryResponse)
def like_post(
    trip_id: uuid.UUID,
    post_id: uuid.UUID,
    social_service: PostSocialServiceDep,
    response: Response,
    user: OptionalCurrentUser,
    share_token: ShareToken = None,
) -> PostSocialSummaryResponse:
    try:
        summary = social_service.like(
            trip_id=trip_id,
            post_id=post_id,
            current_user_id=user.id if user else None,
            share_token=share_token,
        )
    except (SocialNotFoundError, SocialPermissionError, SocialNameRequiredError) as exc:
        raise _social_error(exc)
    response.headers['Cache-Control'] = 'private, no-store'
    return summary


@router.delete('/{post_id}/like', response_model=PostSocialSummaryResponse)
def unlike_post(
    trip_id: uuid.UUID,
    post_id: uuid.UUID,
    social_service: PostSocialServiceDep,
    response: Response,
    user: OptionalCurrentUser,
    share_token: ShareToken = None,
) -> PostSocialSummaryResponse:
    try:
        summary = social_service.unlike(
            trip_id=trip_id,
            post_id=post_id,
            current_user_id=user.id if user else None,
            share_token=share_token,
        )
    except (SocialNotFoundError, SocialPermissionError) as exc:
        raise _social_error(exc)
    response.headers['Cache-Control'] = 'private, no-store'
    return summary


@router.get(
    '/{post_id}/comments',
    response_model=CursorPaginatedResponse[PostCommentResponse],
)
def list_post_comments(
    request: Request,
    trip_id: uuid.UUID,
    post_id: uuid.UUID,
    social_service: PostSocialServiceDep,
    response: Response,
    user: OptionalCurrentUser,
    share_token: ShareToken = None,
    cursor: str | None = None,
    page_size: Annotated[int, Query(ge=1, le=100)] = 20,
) -> CursorPaginatedResponse[PostCommentResponse]:
    try:
        page = social_service.list_comments(
            trip_id=trip_id,
            post_id=post_id,
            current_user_id=user.id if user else None,
            share_token=share_token,
            cursor=cursor,
            page_size=page_size,
            media_base_url=str(request.base_url).rstrip('/'),
            media_token_factory=(
                security.create_media_url_token if user or share_token else None
            ),
        )
    except (SocialNotFoundError, InvalidCommentCursorError) as exc:
        raise _social_error(exc)
    response.headers['Cache-Control'] = 'private, no-store'
    return page


@router.post(
    '/{post_id}/comments',
    status_code=status.HTTP_201_CREATED,
    response_model=PostCommentResponse,
)
def create_post_comment(
    request: Request,
    trip_id: uuid.UUID,
    post_id: uuid.UUID,
    payload: PostCommentCreateRequest,
    social_service: PostSocialServiceDep,
    response: Response,
    user: OptionalCurrentUser,
    share_token: ShareToken = None,
) -> PostCommentResponse:
    try:
        comment = social_service.create_comment(
            trip_id=trip_id,
            post_id=post_id,
            payload=payload,
            current_user_id=user.id if user else None,
            share_token=share_token,
            media_base_url=str(request.base_url).rstrip('/'),
            media_token_factory=(
                security.create_media_url_token if user or share_token else None
            ),
        )
    except (SocialNotFoundError, SocialPermissionError, SocialNameRequiredError) as exc:
        raise _social_error(exc)
    response.headers['Cache-Control'] = 'private, no-store'
    return comment


@router.delete(
    '/{post_id}/comments/{comment_id}', status_code=status.HTTP_204_NO_CONTENT
)
def delete_post_comment(
    trip_id: uuid.UUID,
    post_id: uuid.UUID,
    comment_id: uuid.UUID,
    social_service: PostSocialServiceDep,
    response: Response,
    user: OptionalCurrentUser,
    share_token: ShareToken = None,
) -> None:
    try:
        social_service.delete_comment(
            trip_id=trip_id,
            post_id=post_id,
            comment_id=comment_id,
            current_user_id=user.id if user else None,
            share_token=share_token,
        )
    except (SocialNotFoundError, SocialPermissionError) as exc:
        raise _social_error(exc)
    response.headers['Cache-Control'] = 'private, no-store'
