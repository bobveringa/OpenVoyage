import uuid
from typing import Annotated

from fastapi import APIRouter, HTTPException, Query
from starlette import status
from starlette.requests import Request

from api.deps import CurrentUser, OptionalCurrentUser, PaginationDep, TripServiceDep
from models.api.pagination import PaginatedResponse, SortDirection
from models.api.trips import TripCreateRequest, TripResponse, TripSortField
from services.trip_service import (
    CoverMediaAlreadyUsedError,
    CoverMediaOwnershipError,
    MediaNotFoundError,
    TripNotFoundError,
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
