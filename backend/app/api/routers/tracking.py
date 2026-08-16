import uuid
from typing import Annotated

from fastapi import APIRouter, HTTPException, Query, Response
from starlette import status

from api.deps import CurrentUser, GpsTrackingServiceDep
from models.api.pagination import CursorPaginatedResponse
from models.api.tracking import (
    DEFAULT_RAW_SAMPLE_LIMIT,
    MAX_RAW_SAMPLE_LIMIT,
    TrackingSessionListResponse,
    TrackingSessionResponse,
    TrackingSessionCreateRequest,
    TrackingSessionEndRequest,
    TrackSampleBatchRequest,
    TrackSampleBatchResponse,
    TrackSampleDeleteRequest,
    TrackSampleDeleteResponse,
    TrackSampleModeUpdateRequest,
    TrackSampleModeUpdateResponse,
    TrackSampleResponse,
)
from services.gps.tracking_service import (
    InvalidCursorError,
    TrackingPermissionError,
    TrackingSessionConflictError,
    TrackingSessionNotFoundError,
    TrackingValidationError,
    TrackSampleNotFoundError,
    SessionSummary,
)
from services.trip_errors import TripNotFoundError

router = APIRouter(prefix='/trips/{trip_id}/tracking', tags=['tracking'])


def _raise_http_error(exc: Exception) -> None:
    """Map service errors onto the status codes the offline contract relies on.

    The client treats `409` as terminal and everything else as retryable, so
    the distinction between "gone forever" and "not yet" is load-bearing here.
    """
    if isinstance(exc, TripNotFoundError):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc))
    if isinstance(exc, (TrackingSessionNotFoundError, TrackSampleNotFoundError)):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc))
    if isinstance(exc, TrackingPermissionError):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc))
    if isinstance(exc, TrackingSessionConflictError):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc))
    if isinstance(exc, (TrackingValidationError, InvalidCursorError)):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=str(exc),
        )
    raise exc


def _session_response(summary: SessionSummary) -> TrackingSessionResponse:
    return TrackingSessionResponse(
        id=summary.session.id,
        started_at=summary.session.started_at,
        ended_at=summary.session.ended_at,
        recorded_by_user_id=summary.session.recorded_by_user_id,
        sample_count=summary.sample_count,
    )


# ---------------------------------------------------------------------------
# Sessions
# ---------------------------------------------------------------------------
@router.get('/sessions', response_model=TrackingSessionListResponse)
def list_tracking_sessions(
    trip_id: uuid.UUID,
    user: CurrentUser,
    tracking_service: GpsTrackingServiceDep,
    response: Response,
) -> TrackingSessionListResponse:
    try:
        summaries = tracking_service.list_sessions(
            trip_id=trip_id,
            current_user_id=user.id,
        )
    except Exception as exc:
        _raise_http_error(exc)

    response.headers['Cache-Control'] = 'no-store'
    return TrackingSessionListResponse(
        sessions=[_session_response(summary) for summary in summaries]
    )


@router.post(
    '/sessions/{session_id}',
    response_model=TrackingSessionResponse,
    status_code=status.HTTP_201_CREATED,
)
def create_tracking_session(
    trip_id: uuid.UUID,
    session_id: uuid.UUID,
    payload: TrackingSessionCreateRequest,
    user: CurrentUser,
    tracking_service: GpsTrackingServiceDep,
) -> TrackingSessionResponse:
    try:
        summary = tracking_service.create_session(
            trip_id=trip_id,
            session_id=session_id,
            current_user_id=user.id,
            payload=payload,
        )
    except Exception as exc:
        _raise_http_error(exc)

    return _session_response(summary)


@router.patch('/sessions/{session_id}', response_model=TrackingSessionResponse)
def end_tracking_session(
    trip_id: uuid.UUID,
    session_id: uuid.UUID,
    payload: TrackingSessionEndRequest,
    user: CurrentUser,
    tracking_service: GpsTrackingServiceDep,
) -> TrackingSessionResponse:
    try:
        summary = tracking_service.end_session(
            trip_id=trip_id,
            session_id=session_id,
            current_user_id=user.id,
            payload=payload,
        )
    except Exception as exc:
        _raise_http_error(exc)

    return _session_response(summary)


@router.delete(
    '/sessions/{session_id}',
    status_code=status.HTTP_204_NO_CONTENT,
)
def delete_tracking_session(
    trip_id: uuid.UUID,
    session_id: uuid.UUID,
    user: CurrentUser,
    tracking_service: GpsTrackingServiceDep,
) -> Response:
    try:
        tracking_service.delete_session(
            trip_id=trip_id,
            session_id=session_id,
            current_user_id=user.id,
        )
    except Exception as exc:
        _raise_http_error(exc)

    return Response(
        status_code=status.HTTP_204_NO_CONTENT,
    )


# ---------------------------------------------------------------------------
# Samples
# ---------------------------------------------------------------------------
@router.post(
    '/sessions/{session_id}/samples/batch',
    response_model=TrackSampleBatchResponse,
)
def upload_track_samples(
    trip_id: uuid.UUID,
    session_id: uuid.UUID,
    payload: TrackSampleBatchRequest,
    user: CurrentUser,
    tracking_service: GpsTrackingServiceDep,
) -> TrackSampleBatchResponse:
    print(payload)
    try:
        result = tracking_service.upload_samples(
            trip_id=trip_id,
            session_id=session_id,
            current_user_id=user.id,
            samples=payload.samples,
        )
    except Exception as exc:
        _raise_http_error(exc)

    return TrackSampleBatchResponse(
        accepted_samples=result.accepted,
        filtered_samples=result.filtered,
        duplicate_samples=result.duplicates,
        discarded_samples=result.discarded,
    )


@router.get(
    '/sessions/{session_id}/samples',
    response_model=CursorPaginatedResponse[TrackSampleResponse],
)
def list_track_samples(
    trip_id: uuid.UUID,
    session_id: uuid.UUID,
    user: CurrentUser,
    tracking_service: GpsTrackingServiceDep,
    response: Response,
    limit: Annotated[
        int,
        Query(ge=1, le=MAX_RAW_SAMPLE_LIMIT),
    ] = DEFAULT_RAW_SAMPLE_LIMIT,
    cursor: str | None = None,
) -> CursorPaginatedResponse[TrackSampleResponse]:
    try:
        samples, next_cursor = tracking_service.list_samples(
            trip_id=trip_id,
            session_id=session_id,
            current_user_id=user.id,
            limit=limit,
            cursor=cursor,
        )
    except Exception as exc:
        _raise_http_error(exc)

    response.headers['Cache-Control'] = 'no-store'
    return CursorPaginatedResponse[TrackSampleResponse](
        items=[TrackSampleResponse.from_model(sample) for sample in samples],
        next_cursor=next_cursor,
    )


@router.patch(
    '/samples/travel-mode',
    response_model=TrackSampleModeUpdateResponse,
)
def update_track_sample_modes(
    trip_id: uuid.UUID,
    payload: TrackSampleModeUpdateRequest,
    user: CurrentUser,
    tracking_service: GpsTrackingServiceDep,
) -> TrackSampleModeUpdateResponse:
    try:
        updated_count = tracking_service.update_sample_modes(
            trip_id=trip_id,
            current_user_id=user.id,
            sample_ids=payload.sample_ids,
            travel_mode=payload.travel_mode,
        )
    except Exception as exc:
        _raise_http_error(exc)

    return TrackSampleModeUpdateResponse(updated_count=updated_count)


@router.post('/samples/delete', response_model=TrackSampleDeleteResponse)
def delete_track_samples(
    trip_id: uuid.UUID,
    payload: TrackSampleDeleteRequest,
    user: CurrentUser,
    tracking_service: GpsTrackingServiceDep,
) -> TrackSampleDeleteResponse:
    try:
        deleted_count = tracking_service.delete_samples(
            trip_id=trip_id,
            current_user_id=user.id,
            sample_ids=payload.sample_ids,
        )
    except Exception as exc:
        _raise_http_error(exc)

    return TrackSampleDeleteResponse(deleted_count=deleted_count)
