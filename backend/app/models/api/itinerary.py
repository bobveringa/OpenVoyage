import enum
import uuid
from collections.abc import Callable
from datetime import date, datetime, timedelta
from pydantic import AwareDatetime
from typing import Annotated, Self, TypeAlias, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator
from models.api.planning import (
    ConnectionIntent,
    SegmentIntent,
    SegmentResponse,
    StrictInput,
    PlanningWarning,
)

from models.api.geojson import GeoJsonLineString
from models.api.locations import LocationInput, LocationResponse
from models.api.users import UserSummaryResponse
from models.database.itinerary import ItineraryStop, ItineraryConnection


class ItineraryRouteType(str, enum.Enum):
    PROVIDER_BACKED = 'PROVIDER_BACKED'
    SIMPLE = 'SIMPLE'


class ItineraryConnectionRouteResponse(BaseModel):
    type: ItineraryRouteType
    geometry: GeoJsonLineString
    distance_meters: int | None
    duration_seconds: int | None


RouteResolver: TypeAlias = Callable[[ItineraryConnection], dict]


def is_itinerary_stop_visited(
    *,
    planned_start_date: date,
    planned_nights: int,
    today: date,
) -> bool:
    leave_date = planned_start_date + timedelta(days=planned_nights)
    return today >= leave_date


class ItineraryPlacement(BaseModel):
    model_config = ConfigDict(extra='forbid')

    planned_start_date: date
    after_stop_id: uuid.UUID | None


class StopConnectionEndpoint(StrictInput):
    type: Literal['STOP']
    stop_id: uuid.UUID


class LocationConnectionEndpointInput(StrictInput):
    type: Literal['LOCATION']
    location: LocationInput


class LocationConnectionEndpointResponse(StrictInput):
    type: Literal['LOCATION']
    location: LocationResponse


ConnectionEndpointInput = Annotated[
    StopConnectionEndpoint | LocationConnectionEndpointInput,
    Field(discriminator='type'),
]
ConnectionEndpointResponse = Annotated[
    StopConnectionEndpoint | LocationConnectionEndpointResponse,
    Field(discriminator='type'),
]


def connection_endpoint(connection, side):
    stop_id = getattr(connection, f'{side}_stop_id')
    if stop_id is not None:
        return StopConnectionEndpoint(type='STOP', stop_id=stop_id)
    return LocationConnectionEndpointResponse(
        type='LOCATION',
        location=LocationResponse.from_model(getattr(connection, f'{side}_location')),
    )


class ItineraryConnectionReplaceRequest(ConnectionIntent):
    from_: ConnectionEndpointInput = Field(alias='from')
    to: ConnectionEndpointInput
    # Omission uses an internal sentinel; explicit null still fails list validation.
    segments: list[SegmentIntent] = Field(
        default=None,
        min_length=1,
        max_length=20,
        description=(
            'Omit to choose transport automatically. Provide one or more segments '
            'to choose transport explicitly. An empty list or null is not accepted.'
        ),
    )

    @model_validator(mode='after')
    def valid_endpoints(self):
        if self.from_.type == self.to.type == 'LOCATION':
            raise ValueError('A connection requires at least one stop endpoint')
        if (
            self.from_.type == self.to.type == 'STOP'
            and self.from_.stop_id == self.to.stop_id
        ):
            raise ValueError('Connection stops must be distinct')
        return self


class ItineraryStopCreateRequest(BaseModel):
    model_config = ConfigDict(extra='forbid')

    location: LocationInput
    title: str = Field(min_length=1, max_length=255)
    notes: str = ''
    planned_nights: int = Field(ge=0)
    placement: ItineraryPlacement
    incoming_connection: ConnectionIntent | None = None
    outgoing_connection: ConnectionIntent | None = None


class ItineraryStopUpdateRequest(BaseModel):
    model_config = ConfigDict(extra='forbid')

    location: LocationInput | None = None
    title: str | None = Field(default=None, min_length=1, max_length=255)
    notes: str | None = None
    planned_nights: int | None = Field(default=None, ge=0)
    placement: ItineraryPlacement | None = None
    incoming_connection: ConnectionIntent | None = None
    outgoing_connection: ConnectionIntent | None = None

    @model_validator(mode='after')
    def reject_null_nonnullable_fields(self) -> Self:
        for field_name in (
            'location',
            'title',
            'notes',
            'planned_nights',
            'placement',
        ):
            if (
                field_name in self.model_fields_set
                and getattr(self, field_name) is None
            ):
                raise ValueError(f'{field_name} may not be null')
        return self


class ItineraryConnectionResponse(BaseModel):
    id: uuid.UUID
    trip_id: uuid.UUID
    connection_type: Literal['BETWEEN_STOPS', 'DEPARTURE', 'RETURN']
    from_: ConnectionEndpointResponse = Field(alias='from')
    to: ConnectionEndpointResponse
    notes: str
    segments: list[SegmentResponse]
    duration_seconds: int | None
    duration_scope: Literal['JOURNEY', 'FLIGHT_JOURNEY'] | None
    warnings: list[PlanningWarning]
    route: ItineraryConnectionRouteResponse
    created_at: datetime
    updated_at: datetime

    @classmethod
    def from_model(cls, connection: ItineraryConnection, *, route: dict) -> Self:
        return cls(
            id=connection.id,
            trip_id=connection.trip_id,
            connection_type=(
                'DEPARTURE'
                if connection.from_stop_id is None
                else 'RETURN'
                if connection.to_stop_id is None
                else 'BETWEEN_STOPS'
            ),
            **{
                'from': connection_endpoint(connection, 'from'),
                'to': connection_endpoint(connection, 'to'),
            },
            notes=connection.notes,
            created_at=connection.created_at,
            updated_at=connection.updated_at,
            **route,
        )


class ConnectionMutationResponse(BaseModel):
    itinerary_revision: int
    connection: ItineraryConnectionResponse


class ItineraryStopResponse(BaseModel):
    id: uuid.UUID
    trip_id: uuid.UUID
    same_day_position: int
    location: LocationResponse
    title: str
    notes: str
    planned_start_date: date
    planned_nights: int
    visited: bool
    created_by: UserSummaryResponse
    created_at: datetime
    updated_at: datetime

    @classmethod
    def from_model(cls, stop: ItineraryStop, *, today: date) -> Self:
        return cls(
            id=stop.id,
            trip_id=stop.trip_id,
            same_day_position=stop.same_day_position,
            location=LocationResponse.from_model(stop.location),
            title=stop.title,
            notes=stop.notes,
            planned_start_date=stop.planned_start_date,
            planned_nights=stop.planned_nights,
            visited=is_itinerary_stop_visited(
                planned_start_date=stop.planned_start_date,
                planned_nights=stop.planned_nights,
                today=today,
            ),
            created_by=UserSummaryResponse.from_model(stop.creator),
            created_at=stop.created_at,
            updated_at=stop.updated_at,
        )


class ItineraryResponse(BaseModel):
    trip_id: uuid.UUID
    itinerary_revision: int
    stops: list[ItineraryStopResponse]
    connections: list[ItineraryConnectionResponse]

    @classmethod
    def from_parts(
        cls,
        *,
        trip_id: uuid.UUID,
        itinerary_revision: int,
        stops: list[ItineraryStop],
        connections: list[ItineraryConnection],
        route_resolver: RouteResolver,
        today: date | None = None,
    ) -> Self:
        response_date = today or date.today()
        return cls(
            trip_id=trip_id,
            itinerary_revision=itinerary_revision,
            stops=[
                ItineraryStopResponse.from_model(stop, today=response_date)
                for stop in stops
            ],
            connections=[
                ItineraryConnectionResponse.from_model(
                    connection,
                    route=route_resolver(connection),
                )
                for connection in connections
            ],
        )


class ItineraryStopDetailResponse(BaseModel):
    stop: ItineraryStopResponse
    incoming_connection: ItineraryConnectionResponse | None
    outgoing_connection: ItineraryConnectionResponse | None

    @classmethod
    def from_parts(
        cls,
        *,
        stop: ItineraryStop,
        incoming_connection: ItineraryConnection | None,
        outgoing_connection: ItineraryConnection | None,
        route_resolver: RouteResolver,
        today: date | None = None,
    ) -> Self:
        response_date = today or date.today()
        return cls(
            stop=ItineraryStopResponse.from_model(stop, today=response_date),
            incoming_connection=(
                ItineraryConnectionResponse.from_model(
                    incoming_connection,
                    route=route_resolver(incoming_connection),
                )
                if incoming_connection
                else None
            ),
            outgoing_connection=(
                ItineraryConnectionResponse.from_model(
                    outgoing_connection,
                    route=route_resolver(outgoing_connection),
                )
                if outgoing_connection
                else None
            ),
        )


class PreviewResponse(BaseModel):
    preview_id: uuid.UUID
    expires_at: AwareDatetime
    connection: ItineraryConnectionResponse
