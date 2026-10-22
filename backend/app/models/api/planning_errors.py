"""Shared error contract for every itinerary endpoint."""

import uuid
from pydantic import BaseModel, Field


class ConnectionDeletionSummary(BaseModel):
    id: uuid.UUID
    from_: str = Field(alias='from')
    to: str


class PlanningValidationIssue(BaseModel):
    location: list[str | int]
    message: str
    type: str


class PlanningErrorDetail(BaseModel):
    code: str
    message: str
    segment_id: uuid.UUID | None = None
    connections: list[ConnectionDeletionSummary] = Field(default_factory=list)
    validation_errors: list[PlanningValidationIssue] = Field(default_factory=list)


class PlanningErrorResponse(BaseModel):
    detail: PlanningErrorDetail
