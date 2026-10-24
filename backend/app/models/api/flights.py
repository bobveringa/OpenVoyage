import uuid
from datetime import datetime
from typing import Literal

from pydantic import AwareDatetime, BaseModel, Field
from models.api.geojson import GeoJsonLineString
from models.api.tracking import TrackingSessionResponse


class FlightAirportResponse(BaseModel):
    id: uuid.UUID
    name: str
    iata_code: str | None
    latitude: float
    longitude: float
    timezone: str | None


class TrackedFlightResponse(BaseModel):
    id: uuid.UUID
    flight_number: str
    airline_name: str | None
    departure_airport: FlightAirportResponse
    arrival_airport: FlightAirportResponse | None
    status: Literal[
        'UNKNOWN',
        'SCHEDULED',
        'CHECK_IN',
        'BOARDING',
        'GATE_CLOSED',
        'DELAYED',
        'IN_FLIGHT',
        'ARRIVED',
        'CANCELLED',
        'DIVERTED',
    ]
    scheduled_departure: datetime
    scheduled_arrival: datetime | None
    estimated_departure: datetime | None
    estimated_arrival: datetime | None
    actual_departure: datetime | None
    actual_arrival: datetime | None
    completion_source: Literal['PROVIDER', 'OWNER'] | None
    stop_reason: Literal['MANUAL', 'NEXT_FLIGHT_DEPARTED'] | None
    progress: float | None = Field(ge=0, le=1)
    estimate_basis: Literal['PROVIDER_TIMES', 'SCHEDULED_DURATION'] | None
    position_at: datetime | None
    status_updated_at: datetime | None
    update_state: Literal['CURRENT', 'STALE', 'UNAVAILABLE']
    visible_to_members_only: bool
    can_complete: bool = False
    gps_tracking_session_id: uuid.UUID | None = None


class FlightJourneyResponse(BaseModel):
    itinerary_connection_id: uuid.UUID
    flights: list[TrackedFlightResponse]


class FlightCompleteRequest(BaseModel):
    estimated_arrival: AwareDatetime
    arrival_airport_place_id: uuid.UUID | None = None


class FlightCompleteResponse(BaseModel):
    flight_id: uuid.UUID
    completion_source: Literal['PROVIDER', 'OWNER']
    session: TrackingSessionResponse


class JourneyPosition(BaseModel):
    latitude: float
    longitude: float
    at: datetime
    source: Literal['MOBILE_GPS', 'FLIGHT_ESTIMATE', 'POST_CONNECTOR']


class JourneyTarget(BaseModel):
    type: Literal['AIRPORT', 'CURRENT_STOP', 'DESTINATION']
    name: str
    latitude: float
    longitude: float


class JourneyResponse(BaseModel):
    server_time: datetime
    current_connection_id: uuid.UUID | None = None
    current_flight_segment_index: int | None = Field(default=None, ge=0)
    position: JourneyPosition | None = None
    target: JourneyTarget | None = None
    connector: GeoJsonLineString | None = None
    active_flight_id: uuid.UUID | None = None
    remaining_flight_route: GeoJsonLineString | None = None
    visible_to_members_only: bool = False
