"""Typed planning drafts and resolved calculation inputs."""

import uuid
from dataclasses import dataclass, field
from datetime import datetime

from models.api.planning import (
    ConnectionIntent,
    Endpoint,
    FlightLookup,
    PlanningWarning,
    SegmentIntent,
)
from models.database.base import utcnow
from models.database.itinerary import ItineraryStop, ItineraryTravelSegment
from models.database.locations import Location
from services.location_service import ResolvedLocation


@dataclass(frozen=True)
class DraftLocation(ResolvedLocation):
    id: uuid.UUID
    source_place_id: uuid.UUID | None = None


@dataclass
class ConnectionDraft:
    id: uuid.UUID
    trip_id: uuid.UUID
    notes: str = ''
    segments: list[ItineraryTravelSegment] = field(default_factory=list)
    created_at: datetime = field(default_factory=utcnow)
    updated_at: datetime = field(default_factory=utcnow)
    from_stop_id: uuid.UUID | None = None
    to_stop_id: uuid.UUID | None = None
    from_stop: ItineraryStop | None = None
    to_stop: ItineraryStop | None = None
    from_location: Location | DraftLocation | None = None
    to_location: Location | DraftLocation | None = None

    @property
    def artifact_connection_id(self) -> uuid.UUID | None:
        return self.id if self.id.int else None


@dataclass(frozen=True)
class ArtifactScope:
    id: uuid.UUID | None
    trip_id: uuid.UUID


@dataclass
class ResolvedSegment:
    intent: SegmentIntent
    id: uuid.UUID
    source: str
    version: int
    start: Endpoint | None
    end: Endpoint | None
    via: Endpoint | None
    lookup: FlightLookup | None
    lookup_owner: uuid.UUID | None
    result: dict | None
    input_hash: str = ''


@dataclass(frozen=True)
class PreparedConnection:
    intent: ConnectionIntent
    segments: list[ResolvedSegment]
    warnings: list[PlanningWarning]
    binding: str
