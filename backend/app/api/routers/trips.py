import uuid
from typing import Annotated

from fastapi import APIRouter, HTTPException, Query
from starlette import status
from starlette.requests import Request

from api.deps import CurrentUser, OptionalCurrentUser, PaginationDep, TripServiceDep
from models.api.pagination import PaginatedResponse, SortDirection
from models.api.trips import (
    TripCreateRequest,
    TripMemberCreateRequest,
    TripMemberResponse,
    TripMemberUpdateRequest,
    TripResponse,
    TripSortField,
    TripUpdateRequest,
)
from services.trip_service import (
    CoverMediaAlreadyUsedError,
    CoverMediaOwnershipError,
    LastTripOwnerError,
    MediaNotFoundError,
    TripDateRangeError,
    TripMemberAlreadyExistsError,
    TripMemberNotFoundError,
    TripNotFoundError,
    TripPermissionError,
    UserNotFoundError,
)

router = APIRouter(prefix='/trips', tags=['trips'])


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
    return TripResponse.from_model(trip, media_base_url=media_base_url)


@router.get(
    '',
    response_model=PaginatedResponse[TripResponse],
)
def list_trips(
    request: Request,
    trip_service: TripServiceDep,
    user: CurrentUser,
    pagination: PaginationDep,
    sort_by: Annotated[TripSortField, Query()] = TripSortField.CREATED_AT,
    sort_order: Annotated[SortDirection, Query()] = SortDirection.DESC,
) -> PaginatedResponse[TripResponse]:
    trips, total = trip_service.list_trips_for_user(
        current_user_id=user.id,
        offset=pagination.offset,
        limit=pagination.page_size,
        sort_by=sort_by,
        sort_order=sort_order,
    )

    media_base_url = str(request.base_url).rstrip('/')
    return PaginatedResponse[TripResponse](
        items=[
            TripResponse.from_model(trip, media_base_url=media_base_url)
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
    trip_id: uuid.UUID,
    trip_service: TripServiceDep,
    user: CurrentUser,
) -> list[TripMemberResponse]:
    try:
        members = trip_service.list_trip_members(
            trip_id=trip_id,
            current_user_id=user.id,
        )
    except TripNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc))

    return [TripMemberResponse.from_model(member) for member in members]


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
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=str(exc),
        )

    media_base_url = str(request.base_url).rstrip('/')
    return TripResponse.from_model(trip, media_base_url=media_base_url)


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

    return TripMemberResponse.from_model(member)


@router.patch(
    '/{trip_id}/members/{user_id}',
    response_model=TripMemberResponse,
)
def update_trip_member(
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

    return TripMemberResponse.from_model(member)


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
    '/{trip_id}',
    response_model=TripResponse,
)
def get_trip(
    request: Request,
    trip_id: uuid.UUID,
    trip_service: TripServiceDep,
    user: OptionalCurrentUser,
) -> TripResponse:
    try:
        trip = trip_service.get_trip(
            trip_id=trip_id,
            current_user_id=user.id if user else None,
        )
    except TripNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc))

    media_base_url = str(request.base_url).rstrip('/')
    return TripResponse.from_model(trip, media_base_url=media_base_url)
