import re
import uuid
from typing import Annotated

from fastapi import APIRouter, Header, HTTPException, Response
from starlette import status

from api.deps import CurrentUser, ItineraryServiceDep, OptionalCurrentUser, ShareToken
from models.api.itinerary import (
    ItineraryResponse,
    ItineraryStopCreateRequest,
    ItineraryStopDetailResponse,
    ItineraryStopUpdateRequest,
    ItineraryTravelLegResponse,
    ItineraryTravelReplaceRequest,
)
from services.itinerary_service import (
    ItineraryPermissionError,
    ItineraryPlacementError,
    ItineraryRevisionMismatchError,
    ItineraryStopNotFoundError,
    ItineraryTravelLegNotFoundError,
    ItineraryTravelValidationError,
)
from services.trip_errors import TripNotFoundError
from services.location_service import LocationNotFoundError

router = APIRouter(prefix='/trips/{trip_id}/itinerary', tags=['itinerary'])

_IF_MATCH_RE = re.compile(r'^"([0-9]+)"$')


def _etag(revision: int) -> str:
    return f'"{revision}"'


def _parse_if_match(if_match: str | None) -> int:
    if if_match is None:
        raise HTTPException(
            status_code=status.HTTP_428_PRECONDITION_REQUIRED,
            detail='If-Match header is required',
        )
    match = _IF_MATCH_RE.fullmatch(if_match)
    if match is None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail='If-Match must be a quoted integer revision',
        )
    return int(match.group(1))


def _raise_http_error(exc: Exception) -> None:
    if isinstance(
        exc,
        (
            TripNotFoundError,
            ItineraryStopNotFoundError,
            ItineraryTravelLegNotFoundError,
            LocationNotFoundError,
        ),
    ):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc))
    if isinstance(exc, ItineraryPermissionError):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc))
    if isinstance(exc, ItineraryRevisionMismatchError):
        raise HTTPException(
            status_code=status.HTTP_412_PRECONDITION_FAILED,
            detail=str(exc),
        )
    if isinstance(exc, (ItineraryPlacementError, ItineraryTravelValidationError)):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=str(exc),
        )
    raise exc


@router.get(
    '',
    response_model=ItineraryResponse,
)
def get_itinerary(
    trip_id: uuid.UUID,
    response: Response,
    itinerary_service: ItineraryServiceDep,
    user: OptionalCurrentUser,
    share_token: ShareToken = None,
) -> ItineraryResponse:
    try:
        snapshot = itinerary_service.get_itinerary(
            trip_id=trip_id,
            current_user_id=user.id if user else None,
            share_token=share_token,
        )
    except Exception as exc:
        _raise_http_error(exc)

    response.headers['ETag'] = _etag(snapshot.itinerary_revision)
    return ItineraryResponse.from_parts(
        trip_id=snapshot.trip_id,
        itinerary_revision=snapshot.itinerary_revision,
        stops=snapshot.stops,
        legs=snapshot.legs,
        route_resolver=itinerary_service.route_service.resolve_route_response,
    )


@router.post(
    '/stops',
    status_code=status.HTTP_201_CREATED,
    response_model=ItineraryResponse,
)
def create_stop(
    trip_id: uuid.UUID,
    payload: ItineraryStopCreateRequest,
    response: Response,
    itinerary_service: ItineraryServiceDep,
    user: CurrentUser,
    if_match: Annotated[str | None, Header(alias='If-Match')] = None,
) -> ItineraryResponse:
    try:
        snapshot = itinerary_service.create_stop(
            trip_id=trip_id,
            payload=payload,
            current_user_id=user.id,
            expected_revision=_parse_if_match(if_match),
        )
    except Exception as exc:
        _raise_http_error(exc)

    response.headers['ETag'] = _etag(snapshot.itinerary_revision)
    return ItineraryResponse.from_parts(
        trip_id=snapshot.trip_id,
        itinerary_revision=snapshot.itinerary_revision,
        stops=snapshot.stops,
        legs=snapshot.legs,
        route_resolver=itinerary_service.route_service.resolve_route_response,
    )


@router.get(
    '/stops/{stop_id}',
    response_model=ItineraryStopDetailResponse,
)
def get_stop(
    trip_id: uuid.UUID,
    stop_id: uuid.UUID,
    response: Response,
    itinerary_service: ItineraryServiceDep,
    user: OptionalCurrentUser,
    share_token: ShareToken = None,
) -> ItineraryStopDetailResponse:
    try:
        detail = itinerary_service.get_stop_detail(
            trip_id=trip_id,
            stop_id=stop_id,
            current_user_id=user.id if user else None,
            share_token=share_token,
        )
    except Exception as exc:
        _raise_http_error(exc)

    response.headers['ETag'] = _etag(detail.itinerary_revision)
    return ItineraryStopDetailResponse.from_parts(
        stop=detail.stop,
        incoming_leg=detail.incoming_leg,
        outgoing_leg=detail.outgoing_leg,
        route_resolver=itinerary_service.route_service.resolve_route_response,
    )


@router.patch(
    '/stops/{stop_id}',
    response_model=ItineraryResponse,
)
def update_stop(
    trip_id: uuid.UUID,
    stop_id: uuid.UUID,
    payload: ItineraryStopUpdateRequest,
    response: Response,
    itinerary_service: ItineraryServiceDep,
    user: CurrentUser,
    if_match: Annotated[str | None, Header(alias='If-Match')] = None,
) -> ItineraryResponse:
    try:
        snapshot = itinerary_service.update_stop(
            trip_id=trip_id,
            stop_id=stop_id,
            payload=payload,
            current_user_id=user.id,
            expected_revision=_parse_if_match(if_match),
        )
    except Exception as exc:
        _raise_http_error(exc)

    response.headers['ETag'] = _etag(snapshot.itinerary_revision)
    return ItineraryResponse.from_parts(
        trip_id=snapshot.trip_id,
        itinerary_revision=snapshot.itinerary_revision,
        stops=snapshot.stops,
        legs=snapshot.legs,
        route_resolver=itinerary_service.route_service.resolve_route_response,
    )


@router.delete(
    '/stops/{stop_id}',
    response_model=ItineraryResponse,
)
def delete_stop(
    trip_id: uuid.UUID,
    stop_id: uuid.UUID,
    response: Response,
    itinerary_service: ItineraryServiceDep,
    user: CurrentUser,
    if_match: Annotated[str | None, Header(alias='If-Match')] = None,
) -> ItineraryResponse:
    try:
        snapshot = itinerary_service.delete_stop(
            trip_id=trip_id,
            stop_id=stop_id,
            current_user_id=user.id,
            expected_revision=_parse_if_match(if_match),
        )
    except Exception as exc:
        _raise_http_error(exc)

    response.headers['ETag'] = _etag(snapshot.itinerary_revision)
    return ItineraryResponse.from_parts(
        trip_id=snapshot.trip_id,
        itinerary_revision=snapshot.itinerary_revision,
        stops=snapshot.stops,
        legs=snapshot.legs,
        route_resolver=itinerary_service.route_service.resolve_route_response,
    )


@router.get(
    '/legs/{leg_id}',
    response_model=ItineraryTravelLegResponse,
)
def get_leg(
    trip_id: uuid.UUID,
    leg_id: uuid.UUID,
    response: Response,
    itinerary_service: ItineraryServiceDep,
    user: OptionalCurrentUser,
    share_token: ShareToken = None,
) -> ItineraryTravelLegResponse:
    try:
        detail = itinerary_service.get_travel_leg(
            trip_id=trip_id,
            leg_id=leg_id,
            current_user_id=user.id if user else None,
            share_token=share_token,
        )
    except Exception as exc:
        _raise_http_error(exc)

    response.headers['ETag'] = _etag(detail.itinerary_revision)
    return ItineraryTravelLegResponse.from_model(
        detail.leg,
        route=itinerary_service.route_service.resolve_route_response(detail.leg),
    )


@router.put(
    '/legs/{leg_id}',
    response_model=ItineraryTravelLegResponse,
)
def replace_leg(
    trip_id: uuid.UUID,
    leg_id: uuid.UUID,
    payload: ItineraryTravelReplaceRequest,
    response: Response,
    itinerary_service: ItineraryServiceDep,
    user: CurrentUser,
    if_match: Annotated[str | None, Header(alias='If-Match')] = None,
) -> ItineraryTravelLegResponse:
    try:
        detail = itinerary_service.replace_travel_leg(
            trip_id=trip_id,
            leg_id=leg_id,
            payload=payload,
            current_user_id=user.id,
            expected_revision=_parse_if_match(if_match),
        )
    except Exception as exc:
        _raise_http_error(exc)

    response.headers['ETag'] = _etag(detail.itinerary_revision)
    return ItineraryTravelLegResponse.from_model(
        detail.leg,
        route=itinerary_service.route_service.resolve_route_response(detail.leg),
    )


@router.post(
    '/legs/{leg_id}/route-refresh',
    response_model=ItineraryTravelLegResponse,
)
def refresh_leg_route(
    trip_id: uuid.UUID,
    leg_id: uuid.UUID,
    response: Response,
    itinerary_service: ItineraryServiceDep,
    user: CurrentUser,
) -> ItineraryTravelLegResponse:
    try:
        detail = itinerary_service.refresh_travel_leg_route(
            trip_id=trip_id,
            leg_id=leg_id,
            current_user_id=user.id,
        )
    except Exception as exc:
        _raise_http_error(exc)

    response.headers['ETag'] = _etag(detail.itinerary_revision)
    return ItineraryTravelLegResponse.from_model(
        detail.leg,
        route=itinerary_service.route_service.resolve_route_response(detail.leg),
    )
