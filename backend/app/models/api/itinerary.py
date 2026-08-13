import enum
import uuid
from collections.abc import Callable
from datetime import date, datetime, timedelta
from typing import Self, TypeAlias

from pydantic import BaseModel, ConfigDict, Field, model_validator

from models.api.geojson import GeoJsonLineString
from models.api.locations import LocationInput, LocationResponse
from models.api.users import UserSummaryResponse
from models.database.itinerary import (
    ItineraryStop,
    ItineraryTravelLeg,
    TravelMode,
)


class ItineraryRouteType(str, enum.Enum):
    PROVIDER_BACKED = 'PROVIDER_BACKED'
    SIMPLE = 'SIMPLE'


class ItineraryTravelRouteResponse(BaseModel):
    type: ItineraryRouteType
    geometry: GeoJsonLineString
    distance_meters: int | None
    duration_seconds: int | None


RouteResolver: TypeAlias = Callable[[ItineraryTravelLeg], ItineraryTravelRouteResponse]


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


class ItineraryTravelReplaceRequest(BaseModel):
    model_config = ConfigDict(extra='forbid')

    travel_mode: TravelMode
    notes: str = ''
    operator: str | None = Field(default=None, max_length=255)
    reference: str | None = Field(default=None, max_length=255)


class ItineraryStopCreateRequest(BaseModel):
    model_config = ConfigDict(extra='forbid')

    location: LocationInput
    title: str = Field(min_length=1, max_length=255)
    notes: str = ''
    planned_nights: int = Field(ge=0)
    placement: ItineraryPlacement
    incoming_travel: ItineraryTravelReplaceRequest | None = None
    outgoing_travel: ItineraryTravelReplaceRequest | None = None


class ItineraryStopUpdateRequest(BaseModel):
    model_config = ConfigDict(extra='forbid')

    location: LocationInput | None = None
    title: str | None = Field(default=None, min_length=1, max_length=255)
    notes: str | None = None
    planned_nights: int | None = Field(default=None, ge=0)
    placement: ItineraryPlacement | None = None
    incoming_travel: ItineraryTravelReplaceRequest | None = None
    outgoing_travel: ItineraryTravelReplaceRequest | None = None

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


class ItineraryTravelLegResponse(BaseModel):
    id: uuid.UUID
    trip_id: uuid.UUID
    from_stop_id: uuid.UUID
    to_stop_id: uuid.UUID
    travel_mode: TravelMode
    notes: str
    operator: str | None
    reference: str | None
    route: ItineraryTravelRouteResponse
    created_at: datetime
    updated_at: datetime

    @classmethod
    def from_model(
        cls,
        leg: ItineraryTravelLeg,
        *,
        route: ItineraryTravelRouteResponse,
    ) -> Self:
        return cls(
            id=leg.id,
            trip_id=leg.trip_id,
            from_stop_id=leg.from_stop_id,
            to_stop_id=leg.to_stop_id,
            travel_mode=TravelMode(leg.travel_mode),
            notes=leg.notes,
            operator=leg.operator,
            reference=leg.reference,
            route=route,
            created_at=leg.created_at,
            updated_at=leg.updated_at,
        )


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
    legs: list[ItineraryTravelLegResponse]

    @classmethod
    def from_parts(
        cls,
        *,
        trip_id: uuid.UUID,
        itinerary_revision: int,
        stops: list[ItineraryStop],
        legs: list[ItineraryTravelLeg],
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
            legs=[
                ItineraryTravelLegResponse.from_model(
                    leg,
                    route=route_resolver(leg),
                )
                for leg in legs
            ],
        )


class ItineraryStopDetailResponse(BaseModel):
    stop: ItineraryStopResponse
    incoming_leg: ItineraryTravelLegResponse | None
    outgoing_leg: ItineraryTravelLegResponse | None

    @classmethod
    def from_parts(
        cls,
        *,
        stop: ItineraryStop,
        incoming_leg: ItineraryTravelLeg | None,
        outgoing_leg: ItineraryTravelLeg | None,
        route_resolver: RouteResolver,
        today: date | None = None,
    ) -> Self:
        response_date = today or date.today()
        return cls(
            stop=ItineraryStopResponse.from_model(stop, today=response_date),
            incoming_leg=(
                ItineraryTravelLegResponse.from_model(
                    incoming_leg,
                    route=route_resolver(incoming_leg),
                )
                if incoming_leg
                else None
            ),
            outgoing_leg=(
                ItineraryTravelLegResponse.from_model(
                    outgoing_leg,
                    route=route_resolver(outgoing_leg),
                )
                if outgoing_leg
                else None
            ),
        )
