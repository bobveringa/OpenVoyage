import uuid

from fastapi import APIRouter, HTTPException
from starlette import status

from api.deps import CurrentUser, ItineraryServiceDep, OptionalCurrentUser
from models.api.itinerary import (
    ItineraryResponse,
    PlannedStepCreateRequest,
    PlannedStepMoveRequest,
    PlannedStepResponse,
    PlannedStepUpdateRequest,
    PlannedTravelCreateRequest,
    PlannedTravelResponse,
    PlannedTravelUpdateRequest,
)
from services.itinerary_service import (
    PlannedStepDateRangeError,
    PlannedStepNotFoundError,
    PlannedStepPlacementError,
    PlannedStepPositionConflictError,
    PlannedTravelAlreadyExistsError,
    PlannedTravelNotFoundError,
    PlannedTravelStepError,
)
from services.location_service import LocationNotFoundError
from services.trip_service import TripNotFoundError, TripPermissionError

router = APIRouter(prefix='/trips/{trip_id}', tags=['itinerary'])


@router.get(
    '/itinerary',
    response_model=ItineraryResponse,
)
def get_itinerary(
    trip_id: uuid.UUID,
    itinerary_service: ItineraryServiceDep,
    user: OptionalCurrentUser,
) -> ItineraryResponse:
    try:
        planned_steps, planned_travel = itinerary_service.get_itinerary(
            trip_id=trip_id,
            current_user_id=user.id if user else None,
        )
    except TripNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc))
    except TripPermissionError as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc))

    return ItineraryResponse(
        steps=[PlannedStepResponse.from_model(step) for step in planned_steps],
        travel=[
            PlannedTravelResponse.from_model(travel) for travel in planned_travel
        ],
    )


@router.get(
    '/planned-steps',
    response_model=list[PlannedStepResponse],
)
def list_planned_steps(
    trip_id: uuid.UUID,
    itinerary_service: ItineraryServiceDep,
    user: OptionalCurrentUser,
) -> list[PlannedStepResponse]:
    try:
        planned_steps = itinerary_service.list_planned_steps(
            trip_id=trip_id,
            current_user_id=user.id if user else None,
        )
    except TripNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc))
    except TripPermissionError as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc))

    return [PlannedStepResponse.from_model(step) for step in planned_steps]


@router.post(
    '/planned-steps',
    status_code=status.HTTP_201_CREATED,
    response_model=PlannedStepResponse,
)
def create_planned_step(
    trip_id: uuid.UUID,
    payload: PlannedStepCreateRequest,
    itinerary_service: ItineraryServiceDep,
    user: CurrentUser,
) -> PlannedStepResponse:
    try:
        planned_step = itinerary_service.create_planned_step(
            trip_id=trip_id,
            payload=payload,
            current_user_id=user.id,
        )
    except (TripNotFoundError, LocationNotFoundError) as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc))
    except TripPermissionError as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc))
    except (PlannedStepDateRangeError, PlannedStepPlacementError) as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=str(exc),
        )
    except PlannedStepPositionConflictError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc))

    return PlannedStepResponse.from_model(planned_step)


@router.get(
    '/planned-steps/{step_id}',
    response_model=PlannedStepResponse,
)
def get_planned_step(
    trip_id: uuid.UUID,
    step_id: uuid.UUID,
    itinerary_service: ItineraryServiceDep,
    user: OptionalCurrentUser,
) -> PlannedStepResponse:
    try:
        planned_step = itinerary_service.get_planned_step(
            trip_id=trip_id,
            step_id=step_id,
            current_user_id=user.id if user else None,
        )
    except (TripNotFoundError, PlannedStepNotFoundError) as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc))
    except TripPermissionError as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc))

    return PlannedStepResponse.from_model(planned_step)


@router.patch(
    '/planned-steps/{step_id}',
    response_model=PlannedStepResponse,
)
def update_planned_step(
    trip_id: uuid.UUID,
    step_id: uuid.UUID,
    payload: PlannedStepUpdateRequest,
    itinerary_service: ItineraryServiceDep,
    user: CurrentUser,
) -> PlannedStepResponse:
    try:
        planned_step = itinerary_service.update_planned_step(
            trip_id=trip_id,
            step_id=step_id,
            payload=payload,
            current_user_id=user.id,
        )
    except (TripNotFoundError, PlannedStepNotFoundError, LocationNotFoundError) as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc))
    except TripPermissionError as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc))
    except PlannedStepDateRangeError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=str(exc),
        )

    return PlannedStepResponse.from_model(planned_step)


@router.post(
    '/planned-steps/{step_id}/move',
    response_model=PlannedStepResponse,
)
def move_planned_step(
    trip_id: uuid.UUID,
    step_id: uuid.UUID,
    payload: PlannedStepMoveRequest,
    itinerary_service: ItineraryServiceDep,
    user: CurrentUser,
) -> PlannedStepResponse:
    try:
        planned_step = itinerary_service.move_planned_step(
            trip_id=trip_id,
            step_id=step_id,
            after_planned_step_id=payload.after_planned_step_id,
            current_user_id=user.id,
        )
    except (TripNotFoundError, PlannedStepNotFoundError) as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc))
    except TripPermissionError as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc))
    except PlannedStepPlacementError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=str(exc),
        )
    except PlannedStepPositionConflictError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc))

    return PlannedStepResponse.from_model(planned_step)


@router.delete(
    '/planned-steps/{step_id}',
    status_code=status.HTTP_204_NO_CONTENT,
)
def delete_planned_step(
    trip_id: uuid.UUID,
    step_id: uuid.UUID,
    itinerary_service: ItineraryServiceDep,
    user: CurrentUser,
) -> None:
    try:
        itinerary_service.delete_planned_step(
            trip_id=trip_id,
            step_id=step_id,
            current_user_id=user.id,
        )
    except (TripNotFoundError, PlannedStepNotFoundError) as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc))
    except TripPermissionError as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc))


@router.get(
    '/planned-travel',
    response_model=list[PlannedTravelResponse],
)
def list_planned_travel(
    trip_id: uuid.UUID,
    itinerary_service: ItineraryServiceDep,
    user: OptionalCurrentUser,
) -> list[PlannedTravelResponse]:
    try:
        planned_travel = itinerary_service.list_planned_travel(
            trip_id=trip_id,
            current_user_id=user.id if user else None,
        )
    except TripNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc))
    except TripPermissionError as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc))

    return [PlannedTravelResponse.from_model(travel) for travel in planned_travel]


@router.post(
    '/planned-travel',
    status_code=status.HTTP_201_CREATED,
    response_model=PlannedTravelResponse,
)
def create_planned_travel(
    trip_id: uuid.UUID,
    payload: PlannedTravelCreateRequest,
    itinerary_service: ItineraryServiceDep,
    user: CurrentUser,
) -> PlannedTravelResponse:
    try:
        planned_travel = itinerary_service.create_planned_travel(
            trip_id=trip_id,
            payload=payload,
            current_user_id=user.id,
        )
    except TripNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc))
    except TripPermissionError as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc))
    except PlannedTravelStepError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=str(exc),
        )
    except PlannedTravelAlreadyExistsError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc))

    return PlannedTravelResponse.from_model(planned_travel)


@router.get(
    '/planned-travel/{travel_id}',
    response_model=PlannedTravelResponse,
)
def get_planned_travel(
    trip_id: uuid.UUID,
    travel_id: uuid.UUID,
    itinerary_service: ItineraryServiceDep,
    user: OptionalCurrentUser,
) -> PlannedTravelResponse:
    try:
        planned_travel = itinerary_service.get_planned_travel(
            trip_id=trip_id,
            travel_id=travel_id,
            current_user_id=user.id if user else None,
        )
    except (TripNotFoundError, PlannedTravelNotFoundError) as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc))
    except TripPermissionError as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc))

    return PlannedTravelResponse.from_model(planned_travel)


@router.patch(
    '/planned-travel/{travel_id}',
    response_model=PlannedTravelResponse,
)
def update_planned_travel(
    trip_id: uuid.UUID,
    travel_id: uuid.UUID,
    payload: PlannedTravelUpdateRequest,
    itinerary_service: ItineraryServiceDep,
    user: CurrentUser,
) -> PlannedTravelResponse:
    try:
        planned_travel = itinerary_service.update_planned_travel(
            trip_id=trip_id,
            travel_id=travel_id,
            payload=payload,
            current_user_id=user.id,
        )
    except (TripNotFoundError, PlannedTravelNotFoundError) as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc))
    except TripPermissionError as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc))
    except PlannedTravelStepError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=str(exc),
        )
    except PlannedTravelAlreadyExistsError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc))

    return PlannedTravelResponse.from_model(planned_travel)


@router.delete(
    '/planned-travel/{travel_id}',
    status_code=status.HTTP_204_NO_CONTENT,
)
def delete_planned_travel(
    trip_id: uuid.UUID,
    travel_id: uuid.UUID,
    itinerary_service: ItineraryServiceDep,
    user: CurrentUser,
) -> None:
    try:
        itinerary_service.delete_planned_travel(
            trip_id=trip_id,
            travel_id=travel_id,
            current_user_id=user.id,
        )
    except (TripNotFoundError, PlannedTravelNotFoundError) as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc))
    except TripPermissionError as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc))
 
