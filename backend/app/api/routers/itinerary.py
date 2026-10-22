import re
import uuid
from typing import Annotated

from fastapi import APIRouter, Header, HTTPException, Request, Response
from starlette import status

from models.api.planning import FlightLookupRequest, FlightLookupResponse
from models.api.route_overview import RouteOverviewResponse
from api.deps import CurrentUser, ItineraryServiceDep, OptionalCurrentUser, ShareToken
from models.api.itinerary import (
    ConnectionMutationResponse,
    ItineraryResponse,
    ItineraryStopCreateRequest,
    ItineraryStopDetailResponse,
    ItineraryStopUpdateRequest,
    ItineraryConnectionResponse,
    ItineraryConnectionReplaceRequest,
    PreviewResponse,
)
from services.itinerary_service import (
    ItineraryPermissionError,
    ItineraryPlacementError,
    ItineraryRevisionMismatchError,
    ItineraryStopNotFoundError,
    ItineraryConnectionNotFoundError,
    ItineraryConnectionValidationError,
)
from services.trip_errors import TripNotFoundError
from services.location_service import LocationNotFoundError

from api.planning_route import PlanningRoute, PLANNING_ERROR_RESPONSES

router = APIRouter(
    prefix='/trips/{trip_id}/itinerary', tags=['itinerary'],
    route_class=PlanningRoute, responses=PLANNING_ERROR_RESPONSES,
)

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
            ItineraryConnectionNotFoundError,
            LocationNotFoundError,
        ),
    ):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc))
    if isinstance(exc, ItineraryPermissionError):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc))
    if isinstance(exc, ItineraryRevisionMismatchError):
        raise HTTPException(
            status_code=status.HTTP_412_PRECONDITION_FAILED,
            detail={
                'code': 'ITINERARY_CHANGED',
                'message': (
                    'This trip\'s plan changed while you were editing. '
                    'Reload the page and try again. '
                    'Your unsaved changes will be lost when you reload.'
                ),
            },
        )
    if isinstance(exc, (ItineraryPlacementError, ItineraryConnectionValidationError)):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=str(exc),
        )
    raise exc


@router.get('/overview', response_model=RouteOverviewResponse)
def get_route_overview(
    trip_id: uuid.UUID,
    response: Response,
    itinerary_service: ItineraryServiceDep,
    user: OptionalCurrentUser,
    share_token: ShareToken = None,
) -> RouteOverviewResponse:
    try:
        snapshot = itinerary_service.get_route_overview(
            trip_id=trip_id,
            current_user_id=user.id if user else None,
            share_token=share_token,
        )
    except Exception as exc:
        _raise_http_error(exc)
    response.headers['Cache-Control'] = 'private, no-store'
    return RouteOverviewResponse.from_snapshot(
        snapshot, itinerary_service.route_service.resolve_route_response,
    )


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
    response.headers['Cache-Control'] = 'private, no-store'
    return ItineraryResponse.from_parts(
        trip_id=snapshot.trip_id,
        itinerary_revision=snapshot.itinerary_revision,
        stops=snapshot.stops,
        connections=snapshot.connections,
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
    confirm_connection_deletion: bool = False,
    if_match: Annotated[str | None, Header(alias='If-Match')] = None,
) -> ItineraryResponse:
    itinerary_service.confirm_connection_deletion = confirm_connection_deletion
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
        connections=snapshot.connections,
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
    response.headers['Cache-Control'] = 'private, no-store'
    return ItineraryStopDetailResponse.from_parts(
        stop=detail.stop,
        incoming_connection=detail.incoming_connection,
        outgoing_connection=detail.outgoing_connection,
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
    confirm_connection_deletion: bool = False,
    if_match: Annotated[str | None, Header(alias='If-Match')] = None,
) -> ItineraryResponse:
    itinerary_service.confirm_connection_deletion = confirm_connection_deletion
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
        connections=snapshot.connections,
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
    confirm_connection_deletion: bool = False,
    if_match: Annotated[str | None, Header(alias='If-Match')] = None,
) -> ItineraryResponse:
    itinerary_service.confirm_connection_deletion = confirm_connection_deletion
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
        connections=snapshot.connections,
        route_resolver=itinerary_service.route_service.resolve_route_response,
    )


@router.post(
    '/connections',
    status_code=status.HTTP_201_CREATED,
    response_model=ConnectionMutationResponse,
)
def create_connection(
    trip_id: uuid.UUID,
    payload: ItineraryConnectionReplaceRequest,
    response: Response,
    request: Request,
    itinerary_service: ItineraryServiceDep,
    user: CurrentUser,
    if_match: Annotated[str | None, Header(alias='If-Match')] = None,
):
    try:
        detail = itinerary_service.create_connection(
            trip_id,
            payload,
            user.id,
            _parse_if_match(if_match),
        )
    except Exception as exc:
        _raise_http_error(exc)
    response.headers['ETag'] = _etag(detail.itinerary_revision)
    response.headers['Location'] = f'{request.url.path}/{detail.connection.id}'
    return ConnectionMutationResponse(
        itinerary_revision=detail.itinerary_revision,
        connection=ItineraryConnectionResponse.from_model(
            detail.connection,
            route=itinerary_service.route_service.resolve_route_response(detail.connection),
        ),
    )


@router.delete('/connections/{connection_id}', response_model=ItineraryResponse)
def delete_connection(
    trip_id: uuid.UUID,
    connection_id: uuid.UUID,
    response: Response,
    itinerary_service: ItineraryServiceDep,
    user: CurrentUser,
    confirm_connection_deletion: bool = False,
    if_match: Annotated[str | None, Header(alias='If-Match')] = None,
):
    itinerary_service.confirm_connection_deletion = confirm_connection_deletion
    try:
        snapshot = itinerary_service.delete_connection(
            trip_id,
            connection_id,
            user.id,
            _parse_if_match(if_match),
        )
    except Exception as exc:
        _raise_http_error(exc)
    response.headers['ETag'] = _etag(snapshot.itinerary_revision)
    return ItineraryResponse.from_parts(
        trip_id=snapshot.trip_id,
        itinerary_revision=snapshot.itinerary_revision,
        stops=snapshot.stops,
        connections=snapshot.connections,
        route_resolver=itinerary_service.route_service.resolve_route_response,
    )


@router.get(
    '/connections/{connection_id}',
    response_model=ItineraryConnectionResponse,
)
def get_connection(
    trip_id: uuid.UUID,
    connection_id: uuid.UUID,
    response: Response,
    itinerary_service: ItineraryServiceDep,
    user: OptionalCurrentUser,
    share_token: ShareToken = None,
) -> ItineraryConnectionResponse:
    try:
        detail = itinerary_service.get_connection(
            trip_id=trip_id,
            connection_id=connection_id,
            current_user_id=user.id if user else None,
            share_token=share_token,
        )
    except Exception as exc:
        _raise_http_error(exc)

    response.headers['ETag'] = _etag(detail.itinerary_revision)
    response.headers['Cache-Control'] = 'private, no-store'
    return ItineraryConnectionResponse.from_model(
        detail.connection,
        route=itinerary_service.route_service.resolve_route_response(detail.connection),
    )


@router.put(
    '/connections/{connection_id}',
    response_model=ConnectionMutationResponse,
)
def replace_connection(
    trip_id: uuid.UUID,
    connection_id: uuid.UUID,
    payload: ItineraryConnectionReplaceRequest,
    response: Response,
    itinerary_service: ItineraryServiceDep,
    user: CurrentUser,
    if_match: Annotated[str | None, Header(alias='If-Match')] = None,
) -> ConnectionMutationResponse:
    try:
        detail = itinerary_service.replace_connection(
            trip_id=trip_id,
            connection_id=connection_id,
            payload=payload,
            current_user_id=user.id,
            expected_revision=_parse_if_match(if_match),
        )
    except Exception as exc:
        _raise_http_error(exc)

    response.headers['ETag'] = _etag(detail.itinerary_revision)
    return ConnectionMutationResponse(
        itinerary_revision=detail.itinerary_revision,
        connection=ItineraryConnectionResponse.from_model(
            detail.connection,
            route=itinerary_service.route_service.resolve_route_response(detail.connection),
        ),
    )


@router.post(
    '/connections/{connection_id}/route-refresh',
    response_model=ConnectionMutationResponse,
)
def refresh_connection_route(
    trip_id: uuid.UUID,
    connection_id: uuid.UUID,
    response: Response,
    itinerary_service: ItineraryServiceDep,
    user: CurrentUser,
    if_match: Annotated[str | None, Header(alias='If-Match')] = None,
) -> ConnectionMutationResponse:
    try:
        detail = itinerary_service.calculate_saved_routes(
            trip_id=trip_id,
            connection_id=connection_id,
            current_user_id=user.id,
            expected_revision=_parse_if_match(if_match),
        )
    except Exception as exc:
        _raise_http_error(exc)

    response.headers['ETag'] = _etag(detail.itinerary_revision)
    return ConnectionMutationResponse(
        itinerary_revision=detail.itinerary_revision,
        connection=ItineraryConnectionResponse.from_model(
            detail.connection,
            route=itinerary_service.route_service.resolve_route_response(detail.connection),
        ),
    )


@router.post('/connections/preview', response_model=PreviewResponse)
def preview_new_connection(
    trip_id: uuid.UUID,
    payload: ItineraryConnectionReplaceRequest,
    itinerary_service: ItineraryServiceDep,
    user: CurrentUser,
    retry_failed: bool = False,
    if_match: Annotated[str | None, Header(alias='If-Match')] = None,
):
    try:
        return itinerary_service.preview_connection(
            trip_id, None, payload, user.id, _parse_if_match(if_match), retry_failed
        )
    except Exception as exc:
        _raise_http_error(exc)


@router.post('/connections/flight-lookups', response_model=FlightLookupResponse)
def lookup_new_connection_flight(
    trip_id: uuid.UUID,
    payload: FlightLookupRequest,
    itinerary_service: ItineraryServiceDep,
    user: CurrentUser,
    if_match: Annotated[str | None, Header(alias='If-Match')] = None,
):
    try:
        return itinerary_service.lookup_flights(
            trip_id, None, payload, user.id, _parse_if_match(if_match)
        )
    except Exception as exc:
        _raise_http_error(exc)


@router.post('/connections/{connection_id}/preview', response_model=PreviewResponse)
def preview_connection(
    trip_id: uuid.UUID,
    connection_id: uuid.UUID,
    payload: ItineraryConnectionReplaceRequest,
    itinerary_service: ItineraryServiceDep,
    user: CurrentUser,
    retry_failed: bool = False,
    if_match: Annotated[str | None, Header(alias='If-Match')] = None,
):
    try:
        return itinerary_service.preview_connection(
            trip_id, connection_id, payload, user.id, _parse_if_match(if_match), retry_failed
        )
    except Exception as exc:
        _raise_http_error(exc)


@router.post('/connections/{connection_id}/flight-lookups', response_model=FlightLookupResponse)
def lookup_connection_flight(
    trip_id: uuid.UUID,
    connection_id: uuid.UUID,
    payload: FlightLookupRequest,
    itinerary_service: ItineraryServiceDep,
    user: CurrentUser,
    if_match: Annotated[str | None, Header(alias='If-Match')] = None,
):
    try:
        return itinerary_service.lookup_flights(
            trip_id, connection_id, payload, user.id, _parse_if_match(if_match)
        )
    except Exception as exc:
        _raise_http_error(exc)
