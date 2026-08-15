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
    ShareToken,
    TripServiceDep,
)
from models.api.pagination import PaginatedResponse, SortDirection
from models.api.trips import (
    TripCreateRequest,
    TripLiveLocationSettingsRequest,
    TripLiveLocationSettingsResponse,
    TripMemberCreateRequest,
    TripMemberResponse,
    TripMemberUpdateRequest,
    TripResponse,
    TripShareLinkCreateRequest,
    TripShareLinkCreateResponse,
    TripShareLinkResponse,
    TripShareLinkUpdateRequest,
    TripSortField,
    TripStatusFilter,
    TripUpdateRequest,
    TripViewerCreateRequest,
    TripViewerResponse,
)
from services.trip_service import (
    CoverMediaAlreadyUsedError,
    CoverMediaOwnershipError,
    LastTripOwnerError,
    MediaNotFoundError,
    TripDateRangeError,
    TripMemberAlreadyExistsError,
    TripMemberNotFoundError,
    TripPermissionError,
    TripShareLinkNotFoundError,
    TripViewerAlreadyExistsError,
    TripViewerNotFoundError,
    UserNotFoundError,
)
from services.trip_errors import TripNotFoundError

router = APIRouter(prefix='/trips', tags=['trips'])


def _trip_response(
    trip,
    media_base_url: str,
    *,
    user=None,
    share_token: str | None = None,
) -> TripResponse:
    media_token = (
        security.create_media_url_token(trip.cover_media.id)
        if (user or share_token) and trip.cover_media is not None
        else None
    )
    return TripResponse.from_model(
        trip,
        media_base_url=media_base_url,
        media_token=media_token,
    )


@router.post(
    '',
    status_code=status.HTTP_201_CREATED,
    response_model=TripResponse,
)
def create_trip(
    request: Request,
    payload: TripCreateRequest,
    trip_service: TripServiceDep,
    user: CurrentUser,
) -> TripResponse:
    try:
        trip = trip_service.create_trip(payload=payload, current_user_id=user.id)
    except MediaNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc))
    except CoverMediaOwnershipError as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc))
    except CoverMediaAlreadyUsedError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc))

    media_base_url = str(request.base_url).rstrip('/')
    return _trip_response(trip, media_base_url=media_base_url, user=user)


@router.get(
    '',
    response_model=PaginatedResponse[TripResponse],
)
def list_trips(
    request: Request,
    trip_service: TripServiceDep,
    user: OptionalCurrentUser,
    pagination: PaginationDep,
    user_id: Annotated[uuid.UUID | None, Query()] = None,
    sort_by: Annotated[TripSortField, Query()] = TripSortField.START_DATE,
    sort_order: Annotated[SortDirection, Query()] = SortDirection.DESC,
    trip_status: Annotated[TripStatusFilter, Query(alias='status')] = (
        TripStatusFilter.ALL
    ),
) -> PaginatedResponse[TripResponse]:
    if user_id is None and user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail='Authentication is required to list current user trips',
            headers={'WWW-Authenticate': 'Bearer'},
        )

    listed_user_id = user_id if user_id is not None else user.id
    trips, total = trip_service.list_trips_for_user(
        listed_user_id=listed_user_id,
        current_user_id=user.id if user else None,
        offset=pagination.offset,
        limit=pagination.page_size,
        sort_by=sort_by,
        sort_order=sort_order,
        status_filter=trip_status,
    )

    media_base_url = str(request.base_url).rstrip('/')
    return PaginatedResponse[TripResponse](
        items=[
            _trip_response(trip, media_base_url=media_base_url, user=user)
            for trip in trips
        ],
        total=total,
        page=pagination.page,
        page_size=pagination.page_size,
    )


@router.get(
    '/{trip_id}/members',
    response_model=list[TripMemberResponse],
)
def list_trip_members(
    request: Request,
    trip_id: uuid.UUID,
    trip_service: TripServiceDep,
    user: OptionalCurrentUser,
    share_token: ShareToken = None,
) -> list[TripMemberResponse]:
    try:
        members = trip_service.list_trip_members(
            trip_id=trip_id,
            current_user_id=user.id if user else None,
            share_token=share_token,
        )
    except TripNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc))

    media_base_url = str(request.base_url).rstrip('/')
    return [
        TripMemberResponse.from_model(member, media_base_url=media_base_url)
        for member in members
    ]


@router.get(
    '/{trip_id}/live-location-settings',
    response_model=TripLiveLocationSettingsResponse,
)
def get_live_location_settings(
    trip_id: uuid.UUID,
    trip_service: TripServiceDep,
    user: CurrentUser,
    response: Response,
) -> TripLiveLocationSettingsResponse:
    try:
        share_live_location = trip_service.get_live_location_settings(
            trip_id=trip_id,
            current_user_id=user.id,
        )
    except TripNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc))
    except TripPermissionError as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc))

    response.headers['Cache-Control'] = 'no-store'
    return TripLiveLocationSettingsResponse(share_live_location=share_live_location)


@router.put(
    '/{trip_id}/live-location-settings',
    response_model=TripLiveLocationSettingsResponse,
)
def replace_live_location_settings(
    trip_id: uuid.UUID,
    payload: TripLiveLocationSettingsRequest,
    trip_service: TripServiceDep,
    user: CurrentUser,
) -> TripLiveLocationSettingsResponse:
    try:
        share_live_location = trip_service.replace_live_location_settings(
            trip_id=trip_id,
            current_user_id=user.id,
            share_live_location=payload.share_live_location,
        )
    except TripNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc))
    except TripPermissionError as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc))

    return TripLiveLocationSettingsResponse(share_live_location=share_live_location)


@router.patch(
    '/{trip_id}',
    response_model=TripResponse,
)
def update_trip(
    request: Request,
    trip_id: uuid.UUID,
    payload: TripUpdateRequest,
    trip_service: TripServiceDep,
    user: CurrentUser,
) -> TripResponse:
    try:
        trip = trip_service.update_trip(
            trip_id=trip_id,
            payload=payload,
            current_user_id=user.id,
        )
    except (TripNotFoundError, MediaNotFoundError) as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc))
    except (TripPermissionError, CoverMediaOwnershipError) as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc))
    except CoverMediaAlreadyUsedError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc))
    except TripDateRangeError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=str(exc),
        )

    media_base_url = str(request.base_url).rstrip('/')
    return _trip_response(trip, media_base_url=media_base_url, user=user)


@router.delete(
    '/{trip_id}',
    status_code=status.HTTP_204_NO_CONTENT,
)
def delete_trip(
    trip_id: uuid.UUID,
    trip_service: TripServiceDep,
    user: CurrentUser,
) -> None:
    try:
        trip_service.delete_trip(trip_id=trip_id, current_user_id=user.id)
    except TripNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc))
    except TripPermissionError as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc))


@router.post(
    '/{trip_id}/members',
    status_code=status.HTTP_201_CREATED,
    response_model=TripMemberResponse,
)
def add_trip_member(
    request: Request,
    trip_id: uuid.UUID,
    payload: TripMemberCreateRequest,
    trip_service: TripServiceDep,
    user: CurrentUser,
) -> TripMemberResponse:
    try:
        member = trip_service.add_trip_member(
            trip_id=trip_id,
            current_user_id=user.id,
            target_user_id=payload.user_id,
            role=payload.role,
        )
    except (TripNotFoundError, UserNotFoundError) as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc))
    except TripPermissionError as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc))
    except TripMemberAlreadyExistsError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc))

    return TripMemberResponse.from_model(
        member,
        media_base_url=str(request.base_url).rstrip('/'),
    )


@router.patch(
    '/{trip_id}/members/{user_id}',
    response_model=TripMemberResponse,
)
def update_trip_member(
    request: Request,
    trip_id: uuid.UUID,
    user_id: uuid.UUID,
    payload: TripMemberUpdateRequest,
    trip_service: TripServiceDep,
    user: CurrentUser,
) -> TripMemberResponse:
    try:
        member = trip_service.update_trip_member(
            trip_id=trip_id,
            current_user_id=user.id,
            target_user_id=user_id,
            role=payload.role,
        )
    except (TripNotFoundError, TripMemberNotFoundError) as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc))
    except TripPermissionError as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc))
    except LastTripOwnerError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc))

    return TripMemberResponse.from_model(
        member,
        media_base_url=str(request.base_url).rstrip('/'),
    )


@router.delete(
    '/{trip_id}/members/{user_id}',
    status_code=status.HTTP_204_NO_CONTENT,
)
def remove_trip_member(
    trip_id: uuid.UUID,
    user_id: uuid.UUID,
    trip_service: TripServiceDep,
    user: CurrentUser,
) -> None:
    try:
        trip_service.remove_trip_member(
            trip_id=trip_id,
            current_user_id=user.id,
            target_user_id=user_id,
        )
    except (TripNotFoundError, TripMemberNotFoundError) as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc))
    except TripPermissionError as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc))
    except LastTripOwnerError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc))


@router.get(
    '/{trip_id}/viewers',
    response_model=list[TripViewerResponse],
)
def list_trip_viewers(
    trip_id: uuid.UUID,
    trip_service: TripServiceDep,
    user: CurrentUser,
) -> list[TripViewerResponse]:
    try:
        viewers = trip_service.list_trip_viewers(
            trip_id=trip_id,
            current_user_id=user.id,
        )
    except TripNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc))
    except TripPermissionError as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc))

    return [TripViewerResponse.from_model(viewer) for viewer in viewers]


@router.post(
    '/{trip_id}/viewers',
    status_code=status.HTTP_201_CREATED,
    response_model=TripViewerResponse,
)
def add_trip_viewer(
    trip_id: uuid.UUID,
    payload: TripViewerCreateRequest,
    trip_service: TripServiceDep,
    user: CurrentUser,
) -> TripViewerResponse:
    try:
        viewer = trip_service.add_trip_viewer(
            trip_id=trip_id,
            current_user_id=user.id,
            target_user_id=payload.user_id,
        )
    except (TripNotFoundError, UserNotFoundError) as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc))
    except TripPermissionError as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc))
    except TripViewerAlreadyExistsError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc))

    return TripViewerResponse.from_model(viewer)


@router.delete(
    '/{trip_id}/viewers/{user_id}',
    status_code=status.HTTP_204_NO_CONTENT,
)
def remove_trip_viewer(
    trip_id: uuid.UUID,
    user_id: uuid.UUID,
    trip_service: TripServiceDep,
    user: CurrentUser,
) -> None:
    try:
        trip_service.remove_trip_viewer(
            trip_id=trip_id,
            current_user_id=user.id,
            target_user_id=user_id,
        )
    except (TripNotFoundError, TripViewerNotFoundError) as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc))
    except TripPermissionError as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc))


@router.get(
    '/{trip_id}/share-links',
    response_model=list[TripShareLinkResponse],
)
def list_share_links(
    trip_id: uuid.UUID,
    trip_service: TripServiceDep,
    user: CurrentUser,
) -> list[TripShareLinkResponse]:
    try:
        share_links = trip_service.list_share_links(
            trip_id=trip_id,
            current_user_id=user.id,
        )
    except TripNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc))
    except TripPermissionError as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc))

    return [TripShareLinkResponse.from_model(link) for link in share_links]


@router.post(
    '/{trip_id}/share-links',
    status_code=status.HTTP_201_CREATED,
    response_model=TripShareLinkCreateResponse,
)
def create_share_link(
    trip_id: uuid.UUID,
    payload: TripShareLinkCreateRequest,
    trip_service: TripServiceDep,
    user: CurrentUser,
) -> TripShareLinkCreateResponse:
    try:
        share_link, token = trip_service.create_share_link(
            trip_id=trip_id,
            current_user_id=user.id,
            payload=payload,
        )
    except TripNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc))
    except TripPermissionError as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc))

    return TripShareLinkCreateResponse.from_model_with_token(share_link, token)


@router.patch(
    '/{trip_id}/share-links/{share_link_id}',
    response_model=TripShareLinkResponse,
)
def update_share_link(
    trip_id: uuid.UUID,
    share_link_id: uuid.UUID,
    payload: TripShareLinkUpdateRequest,
    trip_service: TripServiceDep,
    user: CurrentUser,
) -> TripShareLinkResponse:
    try:
        share_link = trip_service.update_share_link(
            trip_id=trip_id,
            share_link_id=share_link_id,
            current_user_id=user.id,
            payload=payload,
        )
    except (TripNotFoundError, TripShareLinkNotFoundError) as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc))
    except TripPermissionError as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc))

    return TripShareLinkResponse.from_model(share_link)


@router.delete(
    '/{trip_id}/share-links/{share_link_id}',
    status_code=status.HTTP_204_NO_CONTENT,
)
def revoke_share_link(
    trip_id: uuid.UUID,
    share_link_id: uuid.UUID,
    trip_service: TripServiceDep,
    user: CurrentUser,
) -> None:
    try:
        trip_service.revoke_share_link(
            trip_id=trip_id,
            share_link_id=share_link_id,
            current_user_id=user.id,
        )
    except (TripNotFoundError, TripShareLinkNotFoundError) as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc))
    except TripPermissionError as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc))


@router.get(
    '/{trip_id}',
    response_model=TripResponse,
)
def get_trip(
    request: Request,
    trip_id: uuid.UUID,
    trip_service: TripServiceDep,
    user: OptionalCurrentUser,
    share_token: ShareToken = None,
) -> TripResponse:
    try:
        trip = trip_service.get_trip(
            trip_id=trip_id,
            current_user_id=user.id if user else None,
            share_token=share_token,
        )
    except TripNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc))

    media_base_url = str(request.base_url).rstrip('/')
    return _trip_response(
        trip,
        media_base_url=media_base_url,
        user=user,
        share_token=share_token,
    )
