"""Travel intent accepts user choices; estimates and provider snapshots are read-only."""

import re
import uuid
from datetime import date
from typing import Literal

from pydantic import (
    AwareDatetime,
    BaseModel,
    ConfigDict,
    Field,
    field_validator,
    model_validator,
)

from models.api.geojson import GeoJsonLineString
from models.api.locations import LocationCoordinatesInput, LocationPlaceInput
from models.database.travel import TravelMode

ROAD_MODES = {TravelMode.CAR, TravelMode.BIKE, TravelMode.WALK}
TRANSIT_MODES = {TravelMode.TRAIN, TravelMode.BUS, TravelMode.FERRY, TravelMode.OTHER}


class StrictInput(BaseModel):
    model_config = ConfigDict(extra='forbid', populate_by_name=True)


class ExistingLocationInput(StrictInput):
    location_id: uuid.UUID


PlanningLocation = LocationCoordinatesInput | LocationPlaceInput | ExistingLocationInput


def normalize_flight_number(value: str | None) -> str | None:
    if value is None:
        return None
    value = re.sub(r'\s+', '', value).upper()
    if not re.fullmatch(r'[A-Z0-9]{2,3}[0-9]{1,4}[A-Z]?', value):
        raise ValueError('Enter an airline code and flight number, for example KL597')
    return value


class FlightIntent(StrictInput):
    flight_number: str | None = Field(default=None, max_length=16)
    departure_date: date | None = None
    departure_airport_place_id: uuid.UUID | None = None
    arrival_airport_place_id: uuid.UUID | None = None
    airline_name: str | None = Field(default=None, max_length=255)
    candidate_id: uuid.UUID | None = None

    _normalize_number = field_validator('flight_number')(normalize_flight_number)


class FlightLookupRequest(StrictInput):
    flight_number: str = Field(max_length=16)
    departure_date: date

    _normalize_number = field_validator('flight_number')(normalize_flight_number)


class SegmentIntent(StrictInput):
    id: uuid.UUID | None = None
    travel_mode: TravelMode
    mode_selected: bool = False
    route_option: int = Field(default=0, ge=0, le=2)
    notes: str = Field(default='', max_length=10000)
    from_: PlanningLocation | None = Field(default=None, alias='from')
    to: PlanningLocation | None = None
    via: PlanningLocation | None = None
    service_company: str | None = Field(default=None, max_length=255)
    service_number: str | None = Field(default=None, max_length=255)
    flight: FlightIntent | None = None

    @model_validator(mode='after')
    def relevant_fields(self):
        if self.route_option and self.travel_mode not in ROAD_MODES:
            raise ValueError('Route alternatives require car, bike or walking')
        if self.travel_mode == TravelMode.UNKNOWN:
            raise ValueError('Choose a transport mode')
        if self.via is not None and self.travel_mode not in ROAD_MODES:
            raise ValueError('Via is only available for car, bike and walking')
        if self.travel_mode != TravelMode.FLIGHT and self.flight is not None:
            raise ValueError('Flight details require Flight mode')
        if self.travel_mode == TravelMode.FLIGHT and any(
            (self.from_, self.to, self.via)
        ):
            raise ValueError('Flight endpoints use airport fields')
        if self.travel_mode not in TRANSIT_MODES and (
            self.service_company or self.service_number
        ):
            raise ValueError('Service fields require transit mode')
        return self


class ConnectionIntent(StrictInput):
    notes: str = Field(default='', max_length=10000)
    segments: list[SegmentIntent] = Field(min_length=1, max_length=20)
    preview_id: uuid.UUID | None = None

    @model_validator(mode='after')
    def unique_ids(self):
        ids = [s.id for s in (self.segments or []) if s.id is not None]
        if len(ids) != len(set(ids)):
            raise ValueError('Duplicate segment IDs')
        return self


class Endpoint(BaseModel):
    latitude: float = Field(ge=-90, le=90, allow_inf_nan=False)
    longitude: float = Field(ge=-180, le=180, allow_inf_nan=False)
    name: str = ''
    place_id: uuid.UUID | None = None
    iata_code: str | None = None
    icao_code: str | None = None
    timezone: str | None = None


class FlightLookup(BaseModel):
    schema_version: Literal[1] = 1
    flight_number: str
    departure_date: date
    provider: str = Field(default='aerodatabox', min_length=1, max_length=64)
    fetched_at: AwareDatetime
    airline_name: str | None = None
    departure_airport: Endpoint
    arrival_airport: Endpoint
    scheduled_departure: AwareDatetime | None = None
    scheduled_arrival: AwareDatetime | None = None

    @property
    def duration_seconds(self) -> int | None:
        if self.scheduled_departure is None or self.scheduled_arrival is None:
            return None
        from datetime import timezone

        duration = (
            self.scheduled_arrival.astimezone(timezone.utc)
            - self.scheduled_departure.astimezone(timezone.utc)
        ).total_seconds()
        return int(duration) if duration > 0 else None


class FlightCandidate(BaseModel):
    candidate_id: uuid.UUID
    lookup: FlightLookup
    duration_seconds: int | None


class FlightLookupResponse(BaseModel):
    status: Literal['MATCHES', 'NOT_FOUND', 'UNAVAILABLE']
    candidates: list[FlightCandidate] = Field(default_factory=list)
    expires_at: AwareDatetime | None = None
    reason: str | None = None
    retry_after_seconds: int | None = None


class RouteOption(BaseModel):
    geometry: GeoJsonLineString
    distance_meters: int | None = None
    duration_seconds: int | None = None


class SegmentResponse(BaseModel):
    id: uuid.UUID
    intent: SegmentIntent
    mode_source: Literal['AUTO', 'USER']
    input_version: int
    from_endpoint: Endpoint | None
    to_endpoint: Endpoint | None
    via_endpoint: Endpoint | None = None
    geometry: GeoJsonLineString | None
    duration_seconds: int | None = None
    distance_meters: int | None = None
    route_state: Literal['NOT_CALCULATED', 'READY', 'FAILED', 'UNSUPPORTED']
    error_code: str | None = None
    lookup: FlightLookup | None = None
    route_options: list[RouteOption] = Field(default_factory=list)
