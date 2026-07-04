import uuid
from datetime import date, datetime
from typing import Self

from pydantic import BaseModel, model_validator

from models.api.locations import LocationInput, LocationResponse
from models.database.planned_steps import PlannedStep
from models.database.planned_travel import PlannedTravel, PlannedTravelMode


class PlannedStepCreateRequest(BaseModel):
    location: LocationInput
    arrival_date: date
    departure_date: date
    notes: str = ''
    after_planned_step_id: uuid.UUID | None = None

    @model_validator(mode='after')
    def validate_dates(self) -> Self:
        if self.departure_date < self.arrival_date:
            raise ValueError('departure_date must be on or after arrival_date')
        return self


class PlannedStepUpdateRequest(BaseModel):
    location: LocationInput | None = None
    arrival_date: date | None = None
    departure_date: date | None = None
    notes: str | None = None

    @model_validator(mode='after')
    def validate_dates(self) -> Self:
        if (
            self.arrival_date is not None
            and self.departure_date is not None
            and self.departure_date < self.arrival_date
        ):
            raise ValueError('departure_date must be on or after arrival_date')
        return self


class PlannedStepMoveRequest(BaseModel):
    after_planned_step_id: uuid.UUID | None = None


class PlannedStepResponse(BaseModel):
    id: uuid.UUID
    trip_id: uuid.UUID
    location: LocationResponse
    arrival_date: date
    departure_date: date
    notes: str
    created_at: datetime
    updated_at: datetime

    @classmethod
    def from_model(cls, planned_step: PlannedStep) -> Self:
        return cls(
            id=planned_step.id,
            trip_id=planned_step.trip_id,
            location=LocationResponse.from_model(planned_step.location),
            arrival_date=planned_step.arrival_date,
            departure_date=planned_step.departure_date,
            notes=planned_step.notes,
            created_at=planned_step.created_at,
            updated_at=planned_step.updated_at,
        )


class PlannedTravelCreateRequest(BaseModel):
    from_planned_step_id: uuid.UUID
    to_planned_step_id: uuid.UUID
    travel_mode: PlannedTravelMode
    notes: str = ''

    @model_validator(mode='after')
    def validate_distinct_steps(self) -> Self:
        if self.from_planned_step_id == self.to_planned_step_id:
            raise ValueError('from_planned_step_id and to_planned_step_id must differ')
        return self


class PlannedTravelUpdateRequest(BaseModel):
    from_planned_step_id: uuid.UUID | None = None
    to_planned_step_id: uuid.UUID | None = None
    travel_mode: PlannedTravelMode | None = None
    notes: str | None = None

    @model_validator(mode='after')
    def validate_distinct_steps(self) -> Self:
        if (
            self.from_planned_step_id is not None
            and self.to_planned_step_id is not None
            and self.from_planned_step_id == self.to_planned_step_id
        ):
            raise ValueError('from_planned_step_id and to_planned_step_id must differ')
        return self


class PlannedTravelResponse(BaseModel):
    id: uuid.UUID
    trip_id: uuid.UUID
    from_planned_step_id: uuid.UUID
    to_planned_step_id: uuid.UUID
    travel_mode: PlannedTravelMode
    notes: str
    created_at: datetime
    updated_at: datetime

    @classmethod
    def from_model(cls, planned_travel: PlannedTravel) -> Self:
        return cls(
            id=planned_travel.id,
            trip_id=planned_travel.trip_id,
            from_planned_step_id=planned_travel.from_planned_step_id,
            to_planned_step_id=planned_travel.to_planned_step_id,
            travel_mode=planned_travel.travel_mode,
            notes=planned_travel.notes,
            created_at=planned_travel.created_at,
            updated_at=planned_travel.updated_at,
        )


class ItineraryResponse(BaseModel):
    steps: list[PlannedStepResponse]
    travel: list[PlannedTravelResponse]
