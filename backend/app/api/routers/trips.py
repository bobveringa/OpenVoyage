import uuid

from fastapi import APIRouter, HTTPException
from starlette import status
from starlette.requests import Request

from api.deps import CurrentUser, TripServiceDep
from models.api.trips import TripCreateRequest, TripResponse
from services.trip_service import (
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

    media_base_url = str(request.base_url).rstrip('/')
    return TripResponse.from_model(trip, media_base_url=media_base_url)


@router.get(
    '/{trip_id}',
    response_model=TripResponse,
)
def get_trip(
    request: Request,
    trip_id: uuid.UUID,
    trip_service: TripServiceDep,
) -> TripResponse:
    try:
        trip = trip_service.get_trip(trip_id=trip_id)
    except TripNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc))

    media_base_url = str(request.base_url).rstrip('/')
    return TripResponse.from_model(trip, media_base_url=media_base_url)
