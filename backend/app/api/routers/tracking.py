import uuid
from datetime import datetime, timedelta, timezone
from typing import Annotated

from fastapi import APIRouter, HTTPException, Query, Response
from starlette import status

from api.deps import CurrentUser, GpsTrackingServiceDep, TrackingUploadUser
from core import security
from core.config import settings
from models.database.base import utcnow
from models.api.pagination import CursorPaginatedResponse
from models.api.tracking import (
    DEFAULT_RAW_SAMPLE_LIMIT,
    GpsPostCandidateResponse,
    MAX_RAW_SAMPLE_LIMIT,
    TrackingSessionListResponse,
    TrackingUploadTokenResponse,
    TrackingUploadStateResponse,
    TrackingConflictResponse,
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
    TrackSessionPointsReplaceRequest,
)
from services.gps.tracking_service import (
    InvalidCursorError,
    TrackingPermissionError,
    TrackingSessionConflictError,
    TrackingSessionDeletedError,
    TrackingSessionNotFoundError,
    TrackingValidationError,
    TrackSampleNotFoundError,
    SessionSummary,
)
from services.trip_errors import TripNotFoundError

router = APIRouter(prefix='/trips/{trip_id}/tracking', tags=['tracking'])


@router.post('/sessions/{session_id}/stop', response_model=TrackingSessionResponse)
def stop_tracking_session(
    trip_id: uuid.UUID,
    session_id: uuid.UUID,
    user: CurrentUser,
    tracking_service: GpsTrackingServiceDep,
):
    try:
        return _session_response(
            tracking_service.stop_session(
                trip_id=trip_id, session_id=session_id, current_user_id=user.id
            )
        )
    except Exception as exc:
        _raise_http_error(exc)


@router.put('/sessions/{session_id}/points', status_code=status.HTTP_204_NO_CONTENT)
def replace_session_points(
    trip_id: uuid.UUID,
    session_id: uuid.UUID,
    payload: TrackSessionPointsReplaceRequest,
    user: CurrentUser,
    tracking_service: GpsTrackingServiceDep,
) -> Response:
    try:
        tracking_service.replace_session_points(
            trip_id=trip_id,
            session_id=session_id,
            current_user_id=user.id,
            payload=payload,
        )
    except Exception as exc:
        _raise_http_error(exc)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


def _raise_http_error(exc: Exception) -> None:
    """Preserve machine-readable deletion and the existing permission errors."""
    if isinstance(exc, TrackingSessionDeletedError):
        raise HTTPException(
            status_code=409,
            detail={
                'code': 'session_deleted',
                'message': 'This recording was deleted.',
            },
        )
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
@router.post(
    '/sessions/{session_id}/upload-token',
    response_model=TrackingUploadTokenResponse,
    responses={
        409: {
            'model': TrackingConflictResponse,
            'description': 'Deleted session or conflicting trip',
        }
    },
)
def issue_tracking_upload_token(
    trip_id: uuid.UUID,
    session_id: uuid.UUID,
    user: CurrentUser,
    tracking_service: GpsTrackingServiceDep,
    response: Response,
):
    try:
        tracking_service.upload_session_state(
            trip_id=trip_id,
            session_id=session_id,
            current_user_id=user.id,
            issuing=True,
        )
    except Exception as exc:
        _raise_http_error(exc)
    token = security.create_token(
        user.id,
        security.TOKEN_TYPE_TRACKING_UPLOAD,
        timedelta(minutes=settings.TRACKING_UPLOAD_TOKEN_EXPIRE_MINUTES),
        {
            'ver': user.auth_version,
            'trip_id': str(trip_id),
            'session_id': str(session_id),
        },
    )
    claims = security.decode_token(token, security.TOKEN_TYPE_TRACKING_UPLOAD)
    response.headers['Cache-Control'] = 'no-store'
    return TrackingUploadTokenResponse(
        upload_token=token,
        trip_id=trip_id,
        session_id=session_id,
        recorded_by_user_id=user.id,
        expires_at=datetime.fromtimestamp(claims['exp'], timezone.utc),
    )


@router.get(
    '/sessions/{session_id}/upload-state', response_model=TrackingUploadStateResponse
)
def tracking_upload_state(
    trip_id: uuid.UUID,
    session_id: uuid.UUID,
    user: TrackingUploadUser,
    tracking_service: GpsTrackingServiceDep,
    response: Response,
):
    try:
        row = tracking_service.upload_session_state(
            trip_id=trip_id, session_id=session_id, current_user_id=user.id
        )
    except Exception as exc:
        _raise_http_error(exc)
    response.headers['Cache-Control'] = 'no-store'
    return TrackingUploadStateResponse(
        exists=row is not None and row.deleted_at is None,
        deleted=row is not None and row.deleted_at is not None,
        recorded_by_user_id=row.recorded_by_user_id if row else None,
        started_at=row.started_at if row else None,
        ended_at=row.ended_at if row else None,
        server_time=utcnow(),
    )


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
    responses={
        200: {
            'model': TrackingSessionResponse,
            'description': 'Verified creation retry',
        },
        409: {
            'model': TrackingConflictResponse,
            'description': 'Deleted session or lifecycle conflict',
        },
    },
)
def create_tracking_session(
    trip_id: uuid.UUID,
    session_id: uuid.UUID,
    payload: TrackingSessionCreateRequest,
    user: TrackingUploadUser,
    tracking_service: GpsTrackingServiceDep,
    response: Response,
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

    if not summary.created:
        response.status_code = status.HTTP_200_OK
    return _session_response(summary)


@router.patch(
    '/sessions/{session_id}',
    response_model=TrackingSessionResponse,
    responses={
        409: {
            'model': TrackingConflictResponse,
            'description': 'Deleted session or lifecycle conflict',
        }
    },
)
def end_tracking_session(
    trip_id: uuid.UUID,
    session_id: uuid.UUID,
    payload: TrackingSessionEndRequest,
    user: TrackingUploadUser,
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
@router.get('/post-candidates', response_model=list[GpsPostCandidateResponse])
def list_post_candidates(
    trip_id: uuid.UUID,
    user: CurrentUser,
    tracking_service: GpsTrackingServiceDep,
    response: Response,
) -> list[GpsPostCandidateResponse]:
    """Return a bounded set of member-only GPS points for creating posts."""
    try:
        candidates = tracking_service.list_post_candidates(
            trip_id=trip_id,
            current_user_id=user.id,
        )
    except Exception as exc:
        _raise_http_error(exc)

    response.headers['Cache-Control'] = 'no-store'
    return [GpsPostCandidateResponse.from_model(sample) for sample in candidates]


@router.post(
    '/sessions/{session_id}/samples/batch',
    response_model=TrackSampleBatchResponse,
    responses={
        409: {
            'model': TrackingConflictResponse,
            'description': 'Deleted session or conflicting sample',
        }
    },
)
def upload_track_samples(
    trip_id: uuid.UUID,
    session_id: uuid.UUID,
    payload: TrackSampleBatchRequest,
    user: TrackingUploadUser,
    tracking_service: GpsTrackingServiceDep,
) -> TrackSampleBatchResponse:
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
        session_ended_at=result.session_ended_at,
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
