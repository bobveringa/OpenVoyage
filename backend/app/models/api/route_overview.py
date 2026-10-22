"""Explicitly allowed map data, shared by every reader of a trip.

Keep these models independent of planning responses so new private planning
fields cannot become public through inheritance or automatic serialization.
"""

from __future__ import annotations

import uuid
from collections.abc import Callable
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
        today: date | None = None,
    ) -> Self:
        response_date = today or date.today()
        connections = []
        for connection in snapshot.connections:
            resolved = route_resolver(connection)
            segments = []
            for segment in resolved['segments']:
                segments.append(
                    RouteOverviewSegmentResponse(
                        intent=RouteOverviewTransportResponse(
                            travel_mode=segment.intent.travel_mode,
                        ),
                        from_endpoint=RouteOverviewPointResponse.from_endpoint(
                            segment.from_endpoint
                        ),
                        to_endpoint=RouteOverviewPointResponse.from_endpoint(
                            segment.to_endpoint
                        ),
                        geometry=segment.geometry,
                        route_state=segment.route_state,
                    )
                )
            connections.append(
                RouteOverviewConnectionResponse(
                    id=connection.id,
                    **{'from': connection_endpoint(connection, 'from')},
                    to=connection_endpoint(connection, 'to'),
                    segments=segments,
                    route=RouteOverviewGeometryResponse(
                        type=resolved['route']['type'],
                        geometry=resolved['route']['geometry'],
                    ),
                )
            )
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
