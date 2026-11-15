import enum
import uuid
from collections.abc import Callable
import re
from datetime import date, datetime, time, timedelta
from urllib.parse import urlsplit
from pydantic import AwareDatetime
from typing import Annotated, Self, TypeAlias, Literal

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    field_serializer,
    field_validator,
    model_validator,
)
from models.api.planning import (
    ConnectionIntent,
    SegmentIntent,
    SegmentResponse,
    StrictInput,
    PlanningWarning,
)

from models.api.geojson import GeoJsonLineString
from models.api.locations import (
    LocationCoordinatesInput,
    LocationInput,
    LocationResponse,
)
from models.api.users import UserSummaryResponse
from models.database.itinerary import ItineraryConnection, ItineraryStay, ItineraryStop


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
    """Where a stop goes in the trip's list of stops."""

    model_config = ConfigDict(extra='forbid')

    after_stop_id: uuid.UUID | None = Field(
        description='The stop right before it in the trip. Null puts it first.',
    )


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
    planned_nights: int = Field(ge=0)
    planned_start_date: date | None = Field(
        default=None,
        description=(
            'Defaults to the leave date of the stop before it, '
            "or the trip's start date."
        ),
    )
    placement: ItineraryPlacement
    incoming_connection: ConnectionIntent | None = None
    outgoing_connection: ConnectionIntent | None = None


class ItineraryStopUpdateRequest(BaseModel):
    model_config = ConfigDict(extra='forbid')

    location: LocationInput | None = None
    title: str | None = Field(default=None, min_length=1, max_length=255)
    planned_nights: int | None = Field(default=None, ge=0)
    planned_start_date: date | None = None
    placement: ItineraryPlacement | None = Field(
        default=None,
        description='Moves the stop. Applied before planned_start_date and planned_nights.',
    )
    incoming_connection: ConnectionIntent | None = None
    outgoing_connection: ConnectionIntent | None = None
    marker: LocationCoordinatesInput | None = Field(
        default=None,
        description=(
            'Moves the marker within 25 km of the original location, keeping '
            'travel. Null puts it back on the original location.'
        ),
    )

    @model_validator(mode='after')
    def reject_null_nonnullable_fields(self) -> Self:
        if {'marker', 'location'} <= self.model_fields_set:
            raise ValueError('marker and location cannot change together')
        for field_name in (
            'location',
            'title',
            'planned_nights',
            'planned_start_date',
            'placement',
        ):
            if (
                field_name in self.model_fields_set
                and getattr(self, field_name) is None
            ):
                raise ValueError(f'{field_name} may not be null')
        return self


STOP_NOTES_MAX_LENGTH = 20_000

StayType = Literal[
    'HOTEL', 'RENTAL', 'HOSTEL', 'CAMPING', 'FRIENDS', 'OVERNIGHT_TRAVEL', 'OTHER'
]
StayStatus = Literal['IDEA', 'BOOKED']
_EMAIL_RE = re.compile(r'^[^@\s]+@[^@\s]+\.[^@\s]+$')


class _StayFields(BaseModel):
    """Shared checks for stay bodies. Empty optional text becomes null."""

    model_config = ConfigDict(extra='forbid')

    @field_validator('name', 'address', 'booking_reference', 'booking_url',
                     'contact_phone', 'contact_email', mode='before', check_fields=False)
    @classmethod
    def strip_text(cls, value):
        if isinstance(value, str):
            value = value.strip()
            return value or None
        return value

    @field_validator('booking_url', check_fields=False)
    @classmethod
    def http_url(cls, value: str | None) -> str | None:
        if value is None:
            return value
        parts = urlsplit(value)
        if parts.scheme not in ('http', 'https') or not parts.netloc:
            raise ValueError('booking_url must be an http or https link')
        return value

    @field_validator('contact_email', check_fields=False)
    @classmethod
    def email(cls, value: str | None) -> str | None:
        if value is not None and not _EMAIL_RE.fullmatch(value):
            raise ValueError('contact_email must look like an email address')
        return value


class StayCreateRequest(_StayFields):
    stop_id: uuid.UUID
    stay_type: StayType
    status: StayStatus | None = Field(
        default=None,
        description=(
            'Null for FRIENDS and OVERNIGHT_TRAVEL, which need no booking. '
            'Defaults to IDEA for the other types.'
        ),
    )
    name: str = Field(min_length=1, max_length=255)
    address: str | None = None
    location: LocationInput | None = None
    check_in_date: date
    check_out_date: date = Field(description='The morning you leave.')
    check_in_time: time | None = None
    check_out_time: time | None = None
    booking_reference: str | None = Field(default=None, max_length=255)
    booking_url: str | None = Field(default=None, max_length=2048)
    contact_phone: str | None = Field(default=None, max_length=64)
    contact_email: str | None = Field(default=None, max_length=255)


class StayUpdateRequest(_StayFields):
    """Send only what changes. Null clears an optional field."""

    stay_type: StayType | None = None
    status: StayStatus | None = None
    name: str | None = Field(default=None, min_length=1, max_length=255)
    address: str | None = None
    location: LocationInput | None = None
    check_in_date: date | None = None
    check_out_date: date | None = None
    check_in_time: time | None = None
    check_out_time: time | None = None
    booking_reference: str | None = Field(default=None, max_length=255)
    booking_url: str | None = Field(default=None, max_length=2048)
    contact_phone: str | None = Field(default=None, max_length=64)
    contact_email: str | None = Field(default=None, max_length=255)

    @model_validator(mode='after')
    def reject_null_required_fields(self) -> Self:
        for field_name in ('stay_type', 'name', 'check_in_date', 'check_out_date'):
            if field_name in self.model_fields_set and getattr(self, field_name) is None:
                raise ValueError(f'{field_name} may not be null')
        return self


class StayResponse(BaseModel):
    id: uuid.UUID
    stop_id: uuid.UUID
    stay_type: StayType
    status: StayStatus | None
    name: str
    address: str | None
    location: LocationResponse | None
    check_in_date: date
    check_out_date: date
    check_in_time: time | None = Field(description='Local clock time at the stay, HH:MM.')
    check_out_time: time | None = Field(description='Local clock time at the stay, HH:MM.')
    booking_reference: str | None
    booking_url: str | None
    contact_phone: str | None
    contact_email: str | None

    @field_serializer('check_in_time', 'check_out_time')
    def clock_time(self, value: time | None) -> str | None:
        return value.strftime('%H:%M') if value is not None else None

    @classmethod
    def from_model(cls, stay: ItineraryStay) -> Self:
        return cls(
            id=stay.id,
            stop_id=stay.stop_id,
            stay_type=stay.stay_type,
            status=stay.status,
            name=stay.name,
            address=stay.address,
            location=LocationResponse.from_model(stay.location) if stay.location else None,
            check_in_date=stay.check_in_date,
            check_out_date=stay.check_out_date,
            check_in_time=stay.check_in_time,
            check_out_time=stay.check_out_time,
            booking_reference=stay.booking_reference,
            booking_url=stay.booking_url,
            contact_phone=stay.contact_phone,
            contact_email=stay.contact_email,
        )


class StopNotesUpdateRequest(BaseModel):
    model_config = ConfigDict(extra='forbid')

    notes: str = Field(max_length=STOP_NOTES_MAX_LENGTH)
    based_on: AwareDatetime | None = Field(
        description=(
            'The notes_updated_at the editor last saw, or null when the notes '
            'were never saved.'
        ),
    )


class StopNotesResponse(BaseModel):
    notes: str
    notes_updated_at: datetime | None
    replaced_change_by: UserSummaryResponse | None = Field(
        description=(
            'Set when this save replaced a change another user saved after '
            'based_on. Never set for your own earlier saves.'
        ),
    )


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
    location: LocationResponse = Field(description='Where the marker is shown.')
    original_location: LocationResponse = Field(
        description='The place the stop was made for. Same id as location until moved.',
    )
    title: str
    notes: str
    notes_updated_at: datetime | None
    planned_start_date: date
    planned_nights: int
    visited: bool
    stays: list[StayResponse] = Field(
        description='Sorted by check-in date, then name. Trip members only.',
    )
    created_by: UserSummaryResponse | None = Field(
        description='Null when the creator account has been deleted.',
    )
    created_at: datetime
    updated_at: datetime

    @classmethod
    def from_model(cls, stop: ItineraryStop, *, today: date) -> Self:
        return cls(
            id=stop.id,
            trip_id=stop.trip_id,
            location=LocationResponse.from_model(stop.location),
            original_location=LocationResponse.from_model(stop.original_location),
            title=stop.title,
            notes=stop.notes,
            notes_updated_at=stop.notes_updated_at,
            planned_start_date=stop.planned_start_date,
            planned_nights=stop.planned_nights,
            visited=is_itinerary_stop_visited(
                planned_start_date=stop.planned_start_date,
                planned_nights=stop.planned_nights,
                today=today,
            ),
            stays=[StayResponse.from_model(stay) for stay in stop.stays],
            created_by=(
                UserSummaryResponse.from_model(stop.creator)
                if stop.creator is not None
                else None
            ),
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
