from typing import Annotated, Literal

from fastapi import APIRouter, Depends, Query

from api.deps import PlaceServiceDep, get_current_user
from models.api.places import PlaceResponse, ReverseGeocodeResponse, TimezoneResponse
from services.timezone_service import resolve_timezone

# Place lookups are only used by signed-in editing UIs (posts, planning,
# flights, GPS privacy zones); viewers and share links never call them.
router = APIRouter(
    prefix='/places',
    tags=['places'],
    dependencies=[Depends(get_current_user)],
)


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
    return [PlaceResponse.from_model(place) for place in places]


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
