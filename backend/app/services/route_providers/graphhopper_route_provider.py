from __future__ import annotations

import json
from json import JSONDecodeError
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from models.database.itinerary import TravelMode
from services.route_providers.route_provider import (
    RouteProviderBase,
    RouteProviderConfigurationError,
    RouteProviderError,
    RouteProviderResponseError,
    RouteResponse,
)


def _parse_geometry(geometry: object) -> dict:
    if not isinstance(geometry, dict) or geometry.get('type') != 'LineString':
        raise RouteProviderResponseError(
            'GraphHopper route points must be a GeoJSON LineString'
        )

    coordinates = geometry.get('coordinates')
    if not isinstance(coordinates, list) or len(coordinates) < 2:
        raise RouteProviderResponseError(
            'GraphHopper route must include at least two coordinates'
        )

    normalized_coordinates: list[list[float]] = []
    for point in coordinates:
        if not isinstance(point, list | tuple) or len(point) != 2:
            raise RouteProviderResponseError(
                'GraphHopper route coordinates must be coordinate pairs'
            )
        longitude, latitude = point
        if not isinstance(longitude, int | float) or not isinstance(
            latitude,
            int | float,
        ):
            raise RouteProviderResponseError(
                'GraphHopper route coordinates must be numeric'
            )
        normalized_coordinates.append([float(longitude), float(latitude)])

    return {'type': 'LineString', 'coordinates': normalized_coordinates}


def _parse_optional_nonnegative_int(
        value: object,
    *,
    field_name: str,
) -> int | None:
    if value is None:
        return None
    if not isinstance(value, int | float) or value < 0:
        raise RouteProviderResponseError(
            f'GraphHopper route {field_name} must be nonnegative'
        )
    return round(value)


def _parse_optional_seconds(value: object) -> int | None:
    milliseconds = _parse_optional_nonnegative_int(
        value,
        field_name='time',
    )
    if milliseconds is None:
        return None
    return round(milliseconds / 1000)


def _parse_optional_meters(value: object) -> int | None:
    return _parse_optional_nonnegative_int(value, field_name='distance')


def _parse_route_response(payload: object) -> RouteResponse:
    if not isinstance(payload, dict):
        raise RouteProviderResponseError('GraphHopper response must be an object')

    paths = payload.get('paths')
    if not isinstance(paths, list) or not paths:
        raise RouteProviderResponseError('GraphHopper response did not include paths')

    path = paths[0]
    if not isinstance(path, dict):
        raise RouteProviderResponseError('GraphHopper path must be an object')

    return RouteResponse(
        geometry_geojson=_parse_geometry(path.get('points')),
        distance_meters=_parse_optional_meters(path.get('distance')),
        duration_seconds=_parse_optional_seconds(path.get('time')),
    )


def _http_error_message(exc: HTTPError) -> str:
    body = exc.read().decode('utf-8', errors='replace')
    if not body:
        return f'GraphHopper request failed with HTTP {exc.code}'

    try:
        payload = json.loads(body)
    except JSONDecodeError:
        return f'GraphHopper request failed with HTTP {exc.code}'

    message = payload.get('message')
    if isinstance(message, str) and message:
        return f'GraphHopper request failed with HTTP {exc.code}: {message}'
    return f'GraphHopper request failed with HTTP {exc.code}'


def _graphhopper_point(coordinates: tuple[float, float]) -> str:
    longitude, latitude = coordinates
    return f'{latitude},{longitude}'


def _build_route_url(
    *,
    coordinates_from: tuple[float, float],
    coordinates_to: tuple[float, float],
    profile: str,
    api_key: str,
    base_url: str,
) -> str:
    query = urlencode(
        [
            ('point', _graphhopper_point(coordinates_from)),
            ('point', _graphhopper_point(coordinates_to)),
            ('vehicle', profile),
            ('points_encoded', 'false'),
            ('key', api_key),
        ]
    )
    return f'{base_url.rstrip("/")}/route?{query}'


class GraphHopperRouteProvider(RouteProviderBase):
    timeout_seconds = 15
    supported_travel_modes = frozenset(
        {
            TravelMode.WALK,
            TravelMode.BIKE,
            TravelMode.CAR,
        }
    )
    travel_mode_profiles = {
        TravelMode.WALK: 'foot',
        TravelMode.BIKE: 'bike',
        TravelMode.CAR: 'car',
    }
    name = 'graphhopper'

    def __init__(
        self,
        *,
        api_key: str,
        base_url: str,
    ) -> None:
        self.api_key = api_key
        self.base_url = base_url

    def is_configured(self) -> bool:
        return bool(self.api_key.strip())

    def get_route(
        self,
        coordinates_from: tuple[float, float],
        coordinates_to: tuple[float, float],
        travel_mode: TravelMode,
    ) -> RouteResponse:
        travel_mode = TravelMode(travel_mode)
        profile = self.travel_mode_profiles.get(travel_mode)
        if profile is None:
            raise RouteProviderConfigurationError(
                f'GraphHopper does not support travel mode: {travel_mode.value}'
            )

        api_key = self.api_key.strip()
        if not api_key:
            raise RouteProviderConfigurationError('GraphHopper API key is missing')

        request = Request(
            _build_route_url(
                coordinates_from=coordinates_from,
                coordinates_to=coordinates_to,
                profile=profile,
                api_key=api_key,
                base_url=self.base_url,
            ),
            headers={'User-Agent': 'openvoyage-backend'},
        )

        try:
            with urlopen(request, timeout=self.timeout_seconds) as response:
                payload = json.loads(response.read().decode('utf-8'))
        except HTTPError as exc:
            raise RouteProviderError(_http_error_message(exc)) from exc
        except URLError as exc:
            raise RouteProviderError(f'GraphHopper request failed: {exc.reason}') from exc
        except JSONDecodeError as exc:
            raise RouteProviderResponseError(
                'GraphHopper response was not valid JSON'
            ) from exc

        return _parse_route_response(payload)
