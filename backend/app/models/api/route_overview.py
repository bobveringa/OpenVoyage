"""Explicitly allowed map data, shared by every reader of a trip.

Keep these models independent of planning responses so new private planning
fields cannot become public through inheritance or automatic serialization.
"""

from __future__ import annotations

import uuid
from collections.abc import Callable, Sequence
from datetime import date
from typing import TYPE_CHECKING, Literal, Self

from pydantic import BaseModel, Field

from models.api.geojson import GeoJsonLineString
from models.api.itinerary import (
    ConnectionEndpointResponse,
    ItineraryRouteType,
    connection_endpoint,
    is_itinerary_stop_visited,
)
from models.api.locations import LocationResponse
from models.api.planning import Endpoint
from models.database.itinerary import ItineraryConnection
from models.database.travel import TravelMode
from services.route_privacy import Zone, inside_any, trim_end, trim_start
from services.timezone_service import resolve_timezone

if TYPE_CHECKING:
    from services.itinerary_service import ItinerarySnapshot


class RouteOverviewStopResponse(BaseModel):
    id: uuid.UUID
    title: str
    location: LocationResponse
    visited: bool


class RouteOverviewPointResponse(BaseModel):
    latitude: float
    longitude: float
    name: str

    @classmethod
    def from_endpoint(cls, endpoint: Endpoint | None) -> Self | None:
        if endpoint is None:
            return None
        return cls(
            latitude=endpoint.latitude,
            longitude=endpoint.longitude,
            name=endpoint.name,
        )


class RouteOverviewTransportResponse(BaseModel):
    travel_mode: TravelMode


class RouteOverviewSegmentResponse(BaseModel):
    intent: RouteOverviewTransportResponse
    from_endpoint: RouteOverviewPointResponse | None
    to_endpoint: RouteOverviewPointResponse | None
    geometry: GeoJsonLineString | None
    route_state: Literal['NOT_CALCULATED', 'READY', 'FAILED', 'UNSUPPORTED']


class RouteOverviewGeometryResponse(BaseModel):
    type: ItineraryRouteType
    geometry: GeoJsonLineString


class RouteOverviewConnectionResponse(BaseModel):
    id: uuid.UUID
    from_: ConnectionEndpointResponse = Field(alias='from')
    to: ConnectionEndpointResponse
    segments: list[RouteOverviewSegmentResponse]
    route: RouteOverviewGeometryResponse


class RouteOverviewResponse(BaseModel):
    trip_id: uuid.UUID
    stops: list[RouteOverviewStopResponse]
    connections: list[RouteOverviewConnectionResponse]

    @classmethod
    def from_snapshot(
        cls,
        snapshot: ItinerarySnapshot,
        route_resolver: Callable[[ItineraryConnection], dict],
        *,
        privacy_zones: Sequence[Zone] = (),
        today: date | None = None,
    ) -> Self:
        """Build the map overview with every line's ends cut out of privacy zones.

        Zones are the members' GPS privacy zones. Everyone gets the same cut version; full lines are planning-only.
        """
        response_date = today or date.today()
        zones = list(privacy_zones)
        connections = []
        for connection in snapshot.connections:
            item = _overview_connection(connection, route_resolver(connection), zones)
            if item is not None:
                connections.append(item)
        return cls(
            trip_id=snapshot.trip_id,
            stops=[
                RouteOverviewStopResponse(
                    id=stop.id,
                    title=stop.location.name or 'Planned place',
                    location=LocationResponse.from_model(stop.location),
                    visited=is_itinerary_stop_visited(
                        planned_start_date=stop.planned_start_date,
                        planned_nights=stop.planned_nights,
                        today=response_date,
                    ),
                )
                for stop in snapshot.stops
            ],
            connections=connections,
        )


def _segment_points(segment) -> list[list[float]]:
    if segment.geometry is not None:
        return [list(point) for point in segment.geometry.coordinates]
    return [
        [endpoint.longitude, endpoint.latitude]
        for endpoint in (segment.from_endpoint, segment.to_endpoint)
        if endpoint is not None
    ]


def _region_name(location) -> str:
    return location.region or location.country_code or 'Planned place'


def _end_name(connection, side: str, *, cut: bool) -> str | None:
    """The public name of a line's end, or ``None`` to keep the planning name.

    A cut end is named after its region.
    """
    stop = getattr(connection, f'{side}_stop')
    if cut:
        location = stop.location if stop is not None else getattr(
            connection, f'{side}_location'
        )
        return _region_name(location)
    return None


def _overview_connection(connection, resolved, zones):
    route_line, start_cut = trim_start(
        [resolved['route']['geometry'].coordinates], zones
    )
    route_line, end_cut = trim_end(route_line, zones)
    if not route_line or len(route_line[0]) < 2:
        return None  # The whole line lies inside a zone.
    route_points = route_line[0]

    # Segments with no points at all carry nothing to draw.
    segments = [s for s in resolved['segments'] if _segment_points(s)]
    lines, _ = trim_start([_segment_points(s) for s in segments], zones)
    first = len(segments) - len(lines)
    lines, _ = trim_end(lines, zones)
    segments = segments[first:first + len(lines)]

    names = {
        side: _end_name(connection, side, cut=cut)
        for side, cut in (('from', start_cut), ('to', end_cut))
    }

    responses = []
    for index, (segment, line) in enumerate(zip(segments, lines)):
        from_point = RouteOverviewPointResponse.from_endpoint(segment.from_endpoint)
        to_point = RouteOverviewPointResponse.from_endpoint(segment.to_endpoint)
        if index == 0 and from_point is not None:
            from_point = _moved_point(from_point, line[0], names['from'])
        if index == len(segments) - 1 and to_point is not None:
            to_point = _moved_point(to_point, line[-1], names['to'])
        responses.append(
            RouteOverviewSegmentResponse(
                intent=RouteOverviewTransportResponse(
                    travel_mode=segment.intent.travel_mode,
                ),
                from_endpoint=from_point,
                to_endpoint=to_point,
                geometry=GeoJsonLineString(coordinates=line)
                if segment.geometry is not None and len(line) >= 2
                else None,
                route_state=segment.route_state,
            )
        )
    return RouteOverviewConnectionResponse(
        id=connection.id,
        **{'from': _public_endpoint(connection, 'from', route_points[0], zones)},
        to=_public_endpoint(connection, 'to', route_points[-1], zones),
        segments=responses,
        route=RouteOverviewGeometryResponse(
            type=resolved['route']['type'],
            geometry=GeoJsonLineString(coordinates=route_points),
        ),
    )


def _moved_point(point, coordinate, name):
    """Put a line's end at its (possibly cut) first or last coordinate.

    A cut end takes the new name.
    """
    if (point.longitude, point.latitude) == tuple(coordinate):
        return point
    return RouteOverviewPointResponse(
        latitude=coordinate[1],
        longitude=coordinate[0],
        name=name if name is not None else point.name,
    )


def _public_endpoint(connection, side, line_end, zones):
    """A home or other outside place, moved out of any zone it lies in.

    It takes the line's end and its region's name, so a departure from home
    never shows the home itself, also when the line starts at an airport.
    """
    endpoint = connection_endpoint(connection, side)
    if endpoint.type != 'LOCATION':
        return endpoint
    location = endpoint.location
    if not inside_any([location.longitude, location.latitude], zones):
        return endpoint
    region = _region_name(location)
    parts = [part.strip() for part in location.full_name.split(',')][1:]
    return endpoint.model_copy(
        update={
            'location': location.model_copy(
                update={
                    'name': region,
                    'full_name': ', '.join(parts) or region,
                    'latitude': line_end[1],
                    'longitude': line_end[0],
                    'timezone': resolve_timezone(line_end[1], line_end[0]),
                }
            )
        }
    )
