import uuid
from datetime import datetime
from typing import Self
from pydantic import BaseModel, Field, field_validator

from models.database.gps_tracking import GpsTrackSample
from models.database.travel import TravelMode

MAX_SAMPLES_PER_BATCH = 1_000
MAX_SAMPLE_IDS_PER_REQUEST = 5_000
DEFAULT_RAW_SAMPLE_LIMIT = 2_000
MAX_RAW_SAMPLE_LIMIT = 5_000
MAX_POST_CANDIDATES = 180


def _reject_duplicates(sample_ids: list[uuid.UUID]) -> list[uuid.UUID]:
    if len(set(sample_ids)) != len(sample_ids):
        raise ValueError('sample_ids must be unique')
    return sample_ids


# ---------------------------------------------------------------------------
# Sessions
# ---------------------------------------------------------------------------
class TrackingSessionCreateRequest(BaseModel):
    started_at: datetime
    ended_at: datetime | None = None


class TrackingSessionEndRequest(BaseModel):
    ended_at: datetime


class TrackingSessionResponse(BaseModel):
    id: uuid.UUID
    started_at: datetime
    ended_at: datetime | None
    recorded_by_user_id: uuid.UUID | None
    sample_count: int


class TrackingSessionListResponse(BaseModel):
    sessions: list[TrackingSessionResponse]


# ---------------------------------------------------------------------------
# Samples
# ---------------------------------------------------------------------------
class TrackSampleRequest(BaseModel):
    id: uuid.UUID
    recorded_at: datetime
    latitude: float = Field(ge=-90, le=90)
    longitude: float = Field(ge=-180, le=180)
    accuracy_meters: float | None = Field(default=None, ge=0)
    speed_mps: float | None = Field(default=None, ge=0)
    heading_degrees: float | None = Field(default=None, ge=0, le=360)
    altitude_meters: float | None = None
    travel_mode: TravelMode = TravelMode.UNKNOWN

    @field_validator('altitude_meters')
    @classmethod
    def round_altitude(cls, altitude_meters: float | None) -> float | None:
        if altitude_meters is None:
            return None
        return round(altitude_meters, 2)


class TrackSampleBatchRequest(BaseModel):
    samples: list[TrackSampleRequest] = Field(
        min_length=1,
        max_length=MAX_SAMPLES_PER_BATCH,
    )

    @field_validator('samples')
    @classmethod
    def validate_unique_ids(
        cls,
        samples: list[TrackSampleRequest],
    ) -> list[TrackSampleRequest]:
        ids = [sample.id for sample in samples]
        if len(set(ids)) != len(ids):
            raise ValueError('sample ids must be unique within a batch')
        return samples


class TrackSampleBatchResponse(BaseModel):
    """The four buckets add up to the request length.

    That lets a client retire a whole queue slice and still reconcile its local
    point count against the server's.
    """

    accepted_samples: int
    filtered_samples: int
    duplicate_samples: int
    discarded_samples: int


class TrackSampleResponse(BaseModel):
    id: uuid.UUID
    recorded_at: datetime
    latitude: float
    longitude: float
    accuracy_meters: float | None
    speed_mps: float | None
    heading_degrees: float | None
    altitude_meters: float | None
    travel_mode: TravelMode

    @classmethod
    def from_model(cls, sample: GpsTrackSample) -> Self:
        return cls(
            id=sample.id,
            recorded_at=sample.recorded_at,
            latitude=sample.latitude,
            longitude=sample.longitude,
            accuracy_meters=sample.accuracy_meters,
            speed_mps=sample.speed_mps,
            heading_degrees=sample.heading_degrees,
            altitude_meters=sample.altitude_meters,
            travel_mode=TravelMode(sample.travel_mode),
        )


class GpsPostCandidateResponse(BaseModel):
    """A deliberately sparse GPS point that can seed a new trip post.

    This is distinct from the raw-sample response: it contains only the
    fields needed by the map, is bounded server-side, and is never exposed to
    viewers or share-link readers.
    """

    id: uuid.UUID
    recorded_at: datetime
    latitude: float
    longitude: float

    @classmethod
    def from_model(cls, sample: GpsTrackSample) -> Self:
        return cls(
            id=sample.id,
            recorded_at=sample.recorded_at,
            latitude=sample.latitude,
            longitude=sample.longitude,
        )


# ---------------------------------------------------------------------------
# Bulk sample operations
# ---------------------------------------------------------------------------
class TrackSampleModeUpdateRequest(BaseModel):
    sample_ids: list[uuid.UUID] = Field(
        min_length=1,
        max_length=MAX_SAMPLE_IDS_PER_REQUEST,
    )
    travel_mode: TravelMode

    @field_validator('sample_ids')
    @classmethod
    def validate_unique(cls, sample_ids: list[uuid.UUID]) -> list[uuid.UUID]:
        return _reject_duplicates(sample_ids)


class TrackSampleModeUpdateResponse(BaseModel):
    updated_count: int


class TrackSampleDeleteRequest(BaseModel):
    sample_ids: list[uuid.UUID] = Field(
        min_length=1,
        max_length=MAX_SAMPLE_IDS_PER_REQUEST,
    )

    @field_validator('sample_ids')
    @classmethod
    def validate_unique(cls, sample_ids: list[uuid.UUID]) -> list[uuid.UUID]:
        return _reject_duplicates(sample_ids)


class TrackSampleDeleteResponse(BaseModel):
    deleted_count: int
