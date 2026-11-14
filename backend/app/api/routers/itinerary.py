import re
import uuid
from typing import Annotated

from fastapi import APIRouter, Header, HTTPException, Query, Request, Response
from starlette import status

from models.api.planning import FlightLookupRequest, FlightLookupResponse
from models.api.route_overview import RouteOverviewResponse
from api.deps import (
    AppSettingsServiceDep,
    CurrentUser,
    ItineraryServiceDep,
    OptionalCurrentUser,
    PlacePhotoServiceDep,
    ShareToken,
)
from core import security
from models.api.places import AddressResponse, StopPhotoResponse
from models.api.planning_errors import PlanningErrorResponse
from services.address_search import (
    AddressResult,
    AddressSearchOffError,
    AddressSearchUnavailableError,
    address_provider,
    near_stop_first,
)
from models.api.itinerary import (
    ConnectionMutationResponse,
    ItineraryResponse,
    ItineraryStopCreateRequest,
    ItineraryStopDetailResponse,
    ItineraryStopUpdateRequest,
    ItineraryConnectionResponse,
    ItineraryConnectionReplaceRequest,
    PreviewResponse,
    StayCreateRequest,
    StayUpdateRequest,
    StopNotesResponse,
    StopNotesUpdateRequest,
)
from models.api.users import UserSummaryResponse
from services.itinerary_service import (
    ItineraryPermissionError,
    ItineraryPlacementError,
    ItineraryRevisionMismatchError,
    ItineraryStopNotFoundError,
    ItineraryConnectionNotFoundError,
    ItineraryConnectionValidationError,
    ItineraryStayNotFoundError,
    ItineraryStayValidationError,
    ItineraryMarkerError,
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
            ItineraryStayNotFoundError,
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
    if isinstance(
        exc,
        (
            ItineraryPlacementError,
            ItineraryConnectionValidationError,
            ItineraryStayValidationError,
            ItineraryMarkerError,
        ),
    ):
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
    zones = itinerary_service.route_privacy(trip_id)
    return RouteOverviewResponse.from_snapshot(
        snapshot,
        itinerary_service.route_service.resolve_route_response,
        privacy_zones=zones,
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


@router.get('/stops/{stop_id}/photo', response_model=StopPhotoResponse | None)
def get_stop_photo(
    trip_id: uuid.UUID,
    stop_id: uuid.UUID,
    request: Request,
    response: Response,
    itinerary_service: ItineraryServiceDep,
    photo_service: PlacePhotoServiceDep,
    user: OptionalCurrentUser,
    share_token: ShareToken = None,
) -> StopPhotoResponse | None:
    """The header photo of the stop's town, or null for the designed header.

    Trip members only. The first card for a town fetches the photo from
    Wikipedia within 3 seconds; every later card gets our stored copy.
    """
    try:
        stop = itinerary_service.get_member_stop(
            trip_id=trip_id,
            stop_id=stop_id,
            current_user_id=user.id if user else None,
            share_token=share_token,
        )
    except Exception as exc:
        _raise_http_error(exc)
    response.headers['Cache-Control'] = 'private, no-store'
    photo = photo_service.photo_for_location(stop.original_location)
    if photo is None:
        return None
    file_url = request.url_for('get_place_photo_file', place_id=str(photo.place_id))
    token = security.create_place_photo_url_token(photo.place_id)
    return StopPhotoResponse(
        url=f'{file_url}?token={token}',
        credit=photo.credit,
        license=photo.license,
        source_url=photo.source_url or '',
    )


_ADDRESS_ERRORS = {
    503: {'model': PlanningErrorResponse, 'description': 'Address search off or unavailable'},
}


def _address_provider(itinerary_service, app_settings, trip_id: uuid.UUID, user_id: uuid.UUID):
    try:
        itinerary_service.require_itinerary_manager(trip_id, user_id)
    except Exception as exc:
        _raise_http_error(exc)
    try:
        return address_provider(app_settings)
    except (AddressSearchOffError, AddressSearchUnavailableError) as exc:
        _raise_address_error(exc)


def _raise_address_error(exc: Exception):
    if isinstance(exc, AddressSearchOffError):
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail={'code': 'ADDRESS_SEARCH_OFF', 'message': 'Address search is switched off.'},
        )
    retry_soon = getattr(exc, 'retry_soon', False)
    raise HTTPException(
        status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
        detail={
            'code': 'ADDRESS_SEARCH_UNAVAILABLE',
            'message': str(exc) or 'Address search unavailable.',
        },
        headers={'Retry-After': '1'} if retry_soon else None,
    )


def _address_response(result: AddressResult) -> AddressResponse:
    return AddressResponse(
        name=result.name,
        address=result.address,
        latitude=result.latitude,
        longitude=result.longitude,
    )


@router.get(
    '/addresses/geocode',
    response_model=list[AddressResponse],
    responses=_ADDRESS_ERRORS,
)
def geocode_addresses(
    trip_id: uuid.UUID,
    response: Response,
    itinerary_service: ItineraryServiceDep,
    app_settings: AppSettingsServiceDep,
    user: CurrentUser,
    query: Annotated[str, Query(min_length=1, max_length=255)],
    near_latitude: Annotated[float | None, Query(ge=-90, le=90)] = None,
    near_longitude: Annotated[float | None, Query(ge=-180, le=180)] = None,
    limit: Annotated[int, Query(ge=1, le=10)] = 5,
) -> list[AddressResponse]:
    """Address and hotel search for stays, through our server (only people who plan the trip)."""
    provider = _address_provider(itinerary_service, app_settings, trip_id, user.id)
    near = (
        (near_latitude, near_longitude)
        if near_latitude is not None and near_longitude is not None
        else None
    )
    try:
        results = near_stop_first(provider.search(query.strip(), near, limit), near)
    except (AddressSearchOffError, AddressSearchUnavailableError) as exc:
        _raise_address_error(exc)
    response.headers['Cache-Control'] = 'private, no-store'
    return [_address_response(result) for result in results]


@router.get(
    '/addresses/reverse-geocode',
    response_model=AddressResponse | None,
    responses=_ADDRESS_ERRORS,
)
def reverse_geocode_address(
    trip_id: uuid.UUID,
    response: Response,
    itinerary_service: ItineraryServiceDep,
    app_settings: AppSettingsServiceDep,
    user: CurrentUser,
    latitude: Annotated[float, Query(ge=-90, le=90)],
    longitude: Annotated[float, Query(ge=-180, le=180)],
) -> AddressResponse | None:
    """The address at a dropped stay pin, or null."""
    provider = _address_provider(itinerary_service, app_settings, trip_id, user.id)
    try:
        result = provider.reverse(latitude, longitude)
    except (AddressSearchOffError, AddressSearchUnavailableError) as exc:
        _raise_address_error(exc)
    response.headers['Cache-Control'] = 'private, no-store'
    return _address_response(result) if result else None


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


@router.put('/stops/{stop_id}/notes', response_model=StopNotesResponse)
def save_stop_notes(
    trip_id: uuid.UUID,
    stop_id: uuid.UUID,
    payload: StopNotesUpdateRequest,
    response: Response,
    itinerary_service: ItineraryServiceDep,
    user: CurrentUser,
) -> StopNotesResponse:
    """Save a stop's notes. No If-Match: notes never change the revision."""
    try:
        saved = itinerary_service.save_stop_notes(
            trip_id=trip_id,
            stop_id=stop_id,
            notes=payload.notes,
            based_on=payload.based_on,
            current_user_id=user.id,
        )
    except Exception as exc:
        _raise_http_error(exc)
    response.headers['Cache-Control'] = 'private, no-store'
    return StopNotesResponse(
        notes=saved.stop.notes,
        notes_updated_at=saved.stop.notes_updated_at,
        replaced_change_by=(
            UserSummaryResponse.from_model(saved.replaced_change_by)
            if saved.replaced_change_by is not None
            else None
        ),
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


def _itinerary_response(snapshot, response: Response, itinerary_service) -> ItineraryResponse:
    response.headers['ETag'] = _etag(snapshot.itinerary_revision)
    return ItineraryResponse.from_parts(
        trip_id=snapshot.trip_id,
        itinerary_revision=snapshot.itinerary_revision,
        stops=snapshot.stops,
        connections=snapshot.connections,
        route_resolver=itinerary_service.route_service.resolve_route_response,
    )


@router.post(
    '/stays',
    status_code=status.HTTP_201_CREATED,
    response_model=ItineraryResponse,
)
def create_stay(
    trip_id: uuid.UUID,
    payload: StayCreateRequest,
    response: Response,
    itinerary_service: ItineraryServiceDep,
    user: CurrentUser,
    if_match: Annotated[str | None, Header(alias='If-Match')] = None,
) -> ItineraryResponse:
    """Add a stay to a stop. Its dates must fall within the stop's nights."""
    try:
        snapshot = itinerary_service.create_stay(
            trip_id=trip_id,
            payload=payload,
            current_user_id=user.id,
            expected_revision=_parse_if_match(if_match),
        )
    except Exception as exc:
        _raise_http_error(exc)
    return _itinerary_response(snapshot, response, itinerary_service)


@router.patch('/stays/{stay_id}', response_model=ItineraryResponse)
def update_stay(
    trip_id: uuid.UUID,
    stay_id: uuid.UUID,
    payload: StayUpdateRequest,
    response: Response,
    itinerary_service: ItineraryServiceDep,
    user: CurrentUser,
    if_match: Annotated[str | None, Header(alias='If-Match')] = None,
) -> ItineraryResponse:
    """Edit a stay. Only changed dates are checked against the stop."""
    try:
        snapshot = itinerary_service.update_stay(
            trip_id=trip_id,
            stay_id=stay_id,
            payload=payload,
            current_user_id=user.id,
            expected_revision=_parse_if_match(if_match),
        )
    except Exception as exc:
        _raise_http_error(exc)
    return _itinerary_response(snapshot, response, itinerary_service)


@router.delete('/stays/{stay_id}', response_model=ItineraryResponse)
def delete_stay(
    trip_id: uuid.UUID,
    stay_id: uuid.UUID,
    response: Response,
    itinerary_service: ItineraryServiceDep,
    user: CurrentUser,
    if_match: Annotated[str | None, Header(alias='If-Match')] = None,
) -> ItineraryResponse:
    try:
        snapshot = itinerary_service.delete_stay(
            trip_id=trip_id,
            stay_id=stay_id,
            current_user_id=user.id,
            expected_revision=_parse_if_match(if_match),
        )
    except Exception as exc:
        _raise_http_error(exc)
    return _itinerary_response(snapshot, response, itinerary_service)


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
