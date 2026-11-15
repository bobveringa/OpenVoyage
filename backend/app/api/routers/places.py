import uuid
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import FileResponse
from jwt import InvalidTokenError

from api.deps import PlaceServiceDep, get_current_user
from models.api.places import PlaceResponse, ReverseGeocodeResponse, TimezoneResponse
from core import security
from services.place_photo_service import place_photo_path
from services.timezone_service import resolve_timezone

# Place lookups are only used by signed-in editing UIs (posts, planning,
# flights, GPS privacy zones); viewers and share links never call them.
router = APIRouter(
    prefix='/places',
    tags=['places'],
    dependencies=[Depends(get_current_user)],
)

# The photo file is opened by an <img>, which cannot send the login header:
# a 24-hour token in the link (from the stop photo route) opens it instead.
photo_router = APIRouter(prefix='/places', tags=['places'])


@router.get('/geocode', response_model=list[PlaceResponse])
def geocode_places(
    place_service: PlaceServiceDep,
    query: Annotated[str, Query(min_length=1, max_length=255)],
    limit: Annotated[int, Query(ge=1, le=50)] = 10,
    type: Literal['AIRPORT'] | None = None,
    country_code: Annotated[str | None, Query(min_length=2, max_length=2)] = None,
) -> list[PlaceResponse]:
    places = place_service.geocode(
        query=query,
        limit=limit,
        country_code=country_code,
        place_type=type,
    )
    parents = place_service.parent_names(places)
    return [PlaceResponse.from_model(place, parents.get(place.id)) for place in places]


@router.get('/reverse-geocode', response_model=list[ReverseGeocodeResponse])
def reverse_geocode_places(
    place_service: PlaceServiceDep,
    latitude: Annotated[float, Query(ge=-90, le=90)],
    longitude: Annotated[float, Query(ge=-180, le=180)],
    limit: Annotated[int, Query(ge=1, le=20)] = 1,
    max_distance_km: Annotated[float | None, Query(gt=0)] = None,
) -> list[ReverseGeocodeResponse]:
    results = place_service.reverse_geocode(
        latitude=latitude,
        longitude=longitude,
        limit=limit,
        max_distance_km=max_distance_km,
    )
    return [
        ReverseGeocodeResponse(
            place=PlaceResponse.from_model(result.place),
            distance_km=result.distance_km,
        )
        for result in results
    ]


@router.get('/timezone', response_model=TimezoneResponse)
def get_timezone(
    latitude: Annotated[float, Query(ge=-90, le=90)],
    longitude: Annotated[float, Query(ge=-180, le=180)],
) -> TimezoneResponse:
    """Return the IANA time zone at a point (used for the post form hint)."""
    return TimezoneResponse(timezone=resolve_timezone(latitude, longitude))


@photo_router.get(
    '/{place_id}/photo',
    response_class=FileResponse,
    responses={200: {'content': {'image/webp': {}}}, 404: {'description': 'Not found'}},
)
def get_place_photo_file(place_id: uuid.UUID, token: str | None = None) -> FileResponse:
    """A place's stored header photo. A missing, wrong or expired token gets 404."""
    not_found = HTTPException(
        status_code=status.HTTP_404_NOT_FOUND,
        headers={'Cache-Control': 'private, no-store'},
    )
    if not token:
        raise not_found
    try:
        token_place_id = security.decode_place_photo_url_token(token)
    except InvalidTokenError, KeyError, ValueError:
        raise not_found
    path = place_photo_path(place_id)
    if token_place_id != place_id or not path.is_file():
        raise not_found
    return FileResponse(
        path,
        media_type='image/webp',
        headers={'Cache-Control': 'private, max-age=86400'},
    )
