from __future__ import annotations

import base64
import binascii
import json
import uuid
from dataclasses import dataclass
from datetime import datetime

from sqlalchemy import delete, func, or_, select, update
from sqlalchemy.orm import Session

from models.api.geojson import GeoJsonLineString
from models.api.posts import PostTimelineRouteSegmentResponse
from models.api.tracking import (
    TrackSampleRequest,
    TrackingSessionCreateRequest,
    TrackingSessionEndRequest,
)
from models.database.base import utcnow
from models.database.posts import Post
from models.database.gps_tracking import GpsTrackingSession, GpsTrackSample
from models.database.travel import TravelMode
from models.database.trips import Trip, TripMember
from services.gps.geometry import simplify_line
from services.gps.privacy_zone_service import GpsPrivacyZoneService
from services.trip_access import get_membership, get_trip_read_access
from services.trip_authorization import TripPermission, role_has_permission
from services.trip_errors import TripNotFoundError


class TrackingPermissionError(Exception):
    """Raised when a trip reader lacks a tracking permission."""


class TrackingSessionNotFoundError(Exception):
    """Raised when a session does not exist in this trip."""


class TrackingSessionConflictError(Exception):
    """Raised when a session lifecycle action or upload conflicts with stored state."""


class TrackingValidationError(Exception):
    """Raised when a tracking request is semantically invalid."""


class TrackSampleNotFoundError(Exception):
    """Raised when a referenced sample is not a retained point in this trip."""


class InvalidCursorError(Exception):
    """Raised when a keyset cursor cannot be decoded."""


@dataclass(frozen=True)
class SampleBatchResult:
    accepted: int
    filtered: int
    duplicates: int
    discarded: int


@dataclass(frozen=True)
class SessionSummary:
    session: GpsTrackingSession
    sample_count: int


@dataclass(frozen=True)
class _Anchor:
    """One chronological point on the map: a post location or a GPS point."""

    sort_key: tuple
    latitude: float
    longitude: float
    travel_mode: TravelMode | None
    is_post: bool
    session_id: uuid.UUID | None = None


@dataclass(frozen=True)
class TimelineGeometry:
    """Everything the post timeline needs from the GPS side.

    ``carries_unbounded_open_geometry`` drives ``Cache-Control: no-store``: it
    is set when the response contains geometry that no visible post bounds from
    above, which is the only geometry that can disclose a present position.
    """

    opening_segments: list[PostTimelineRouteSegmentResponse] | None
    transition_segments: dict[int, list[PostTimelineRouteSegmentResponse]]
    final_segments: list[PostTimelineRouteSegmentResponse] | None
    carries_unbounded_open_geometry: bool


class GpsTrackingService:
    """Owns tracking sessions, retained points, and timeline geometry."""

    def __init__(self, db: Session, privacy_zones: GpsPrivacyZoneService) -> None:
        self.db = db
        self.privacy_zones = privacy_zones

    # ------------------------------------------------------------------
    # Sessions
    # ------------------------------------------------------------------
    def list_sessions(
        self,
        *,
        trip_id: uuid.UUID,
        current_user_id: uuid.UUID,
    ) -> list[SessionSummary]:
        self._require_trip_permission(
            trip_id=trip_id,
            user_id=current_user_id,
            permission=TripPermission.GET_TRACKING,
        )
        sessions = list(
            self.db.execute(
                select(GpsTrackingSession)
                .where(GpsTrackingSession.trip_id == trip_id)
                .order_by(
                    GpsTrackingSession.started_at.asc(),
                    GpsTrackingSession.id.asc(),
                )
            )
            .scalars()
            .all()
        )
        if not sessions:
            return []

        # One grouped count for the whole page, never one query per session.
        counts = dict(
            self.db.execute(
                select(GpsTrackSample.session_id, func.count())
                .where(
                    GpsTrackSample.session_id.in_([session.id for session in sessions])
                )
                .group_by(GpsTrackSample.session_id)
            ).all()
        )
        return [
            SessionSummary(session=session, sample_count=counts.get(session.id, 0))
            for session in sessions
        ]

    def create_session(
        self,
        *,
        trip_id: uuid.UUID,
        session_id: uuid.UUID,
        current_user_id: uuid.UUID,
        payload: TrackingSessionCreateRequest,
    ) -> SessionSummary:
        """Create a tracking session with a client-generated id."""
        self._require_trip_permission(
            trip_id=trip_id,
            user_id=current_user_id,
            permission=TripPermission.MANAGE_TRACKING,
        )
        if payload.ended_at is not None and payload.ended_at < payload.started_at:
            raise TrackingValidationError('ended_at must not precede started_at')

        self._lock_trip(trip_id)
        existing = self.db.get(GpsTrackingSession, session_id)
        if existing is not None:
            if existing.trip_id != trip_id:
                raise TrackingSessionConflictError(
                    f'Session belongs to another trip: {session_id}'
                )
            raise TrackingSessionConflictError(f'Session already exists: {session_id}')

        self._require_no_overlap(
            trip_id=trip_id,
            session_id=session_id,
            started_at=payload.started_at,
            ended_at=payload.ended_at,
        )
        session = GpsTrackingSession(
            id=session_id,
            trip_id=trip_id,
            recorded_by_user_id=current_user_id,
            started_at=payload.started_at,
            ended_at=payload.ended_at,
        )
        self.db.add(session)
        self.db.commit()
        return SessionSummary(session=session, sample_count=0)

    def end_session(
        self,
        *,
        trip_id: uuid.UUID,
        session_id: uuid.UUID,
        current_user_id: uuid.UUID,
        payload: TrackingSessionEndRequest,
    ) -> SessionSummary:
        """Advance a session's end time without changing its creation data."""
        self._require_trip_permission(
            trip_id=trip_id,
            user_id=current_user_id,
            permission=TripPermission.MANAGE_TRACKING,
        )
        self._lock_trip(trip_id)
        existing = self.db.get(GpsTrackingSession, session_id)
        if existing is None:
            raise TrackingSessionNotFoundError(f'Session not found: {session_id}')
        if existing.trip_id != trip_id:
            raise TrackingSessionConflictError(
                f'Session belongs to another trip: {session_id}'
            )
        if payload.ended_at < existing.started_at:
            raise TrackingValidationError('ended_at must not precede started_at')

        # The end is monotonic so an offline retry or an older device cannot
        # shorten an already-recorded session.
        newest_sample = self.db.execute(
            select(func.max(GpsTrackSample.recorded_at)).where(
                GpsTrackSample.session_id == session_id
            )
        ).scalar_one_or_none()
        candidates = [
            value
            for value in (existing.ended_at, payload.ended_at, newest_sample)
            if value is not None
        ]
        resolved_end = max(candidates) if candidates else None

        if resolved_end != existing.ended_at:
            self._require_no_overlap(
                trip_id=trip_id,
                session_id=session_id,
                started_at=existing.started_at,
                ended_at=resolved_end,
            )
            existing.ended_at = resolved_end
            self.db.add(existing)
            self.db.commit()
        return SessionSummary(
            session=existing,
            sample_count=self._count_samples(session_id),
        )

    def _count_samples(self, session_id: uuid.UUID) -> int:
        return self.db.execute(
            select(func.count())
            .select_from(GpsTrackSample)
            .where(GpsTrackSample.session_id == session_id)
        ).scalar_one()

    def delete_session(
        self,
        *,
        trip_id: uuid.UUID,
        session_id: uuid.UUID,
        current_user_id: uuid.UUID,
    ) -> None:
        self._require_trip_permission(
            trip_id=trip_id,
            user_id=current_user_id,
            permission=TripPermission.MANAGE_TRACKING,
        )
        self._lock_trip(trip_id)
        session = self._get_session(trip_id=trip_id, session_id=session_id)
        self.db.delete(session)
        self.db.commit()

    # ------------------------------------------------------------------
    # Sample ingestion
    # ------------------------------------------------------------------
    def upload_samples(
        self,
        *,
        trip_id: uuid.UUID,
        session_id: uuid.UUID,
        current_user_id: uuid.UUID,
        samples: list[TrackSampleRequest],
    ) -> SampleBatchResult:
        # Upload is gated on being the recorder, not on a role, but the
        # recorder must still be a current trip owner or member.
        self._require_membership(trip_id=trip_id, user_id=current_user_id)

        self._lock_trip(trip_id)
        session = self.db.get(GpsTrackingSession, session_id)
        if session is not None and session.trip_id != trip_id:
            raise TrackingSessionConflictError(
                f'Session belongs to another trip: {session_id}'
            )
        if session is None:
            # Not an error the client should give up on: the batch may simply
            # have overtaken the session creation request.
            raise TrackingSessionNotFoundError(f'Session not found: {session_id}')
        if (
            session.recorded_by_user_id is None
            or session.recorded_by_user_id != current_user_id
        ):
            raise TrackingPermissionError(
                'Only the recording user may upload samples to this session'
            )

        lower_bound = session.started_at
        if session.ended_at is not None:
            upper_bound = session.ended_at
            upper_inclusive = True
        else:
            upper_bound = utcnow()
            upper_inclusive = False

        submitted_ids = [sample.id for sample in samples]
        stored = list(
            self.db.execute(
                select(GpsTrackSample).where(GpsTrackSample.id.in_(submitted_ids))
            )
            .scalars()
            .all()
        )
        duplicate_ids: set[uuid.UUID] = set()
        for row in stored:
            if row.session_id != session_id:
                raise TrackingSessionConflictError(
                    f'Sample id already belongs to another session: {row.id}'
                )
            duplicate_ids.add(row.id)

        zones = self.privacy_zones.list_trip_member_zone_coordinates(trip_id=trip_id)

        accepted = 0
        filtered = 0
        duplicates = 0
        discarded = 0

        for sample in samples:
            # Bucket order matters. A retained point is never re-examined, so
            # the duplicate check runs before the privacy test; otherwise a
            # retry of a stored point would be reported as filtered while its
            # row sat untouched and the client's reconciliation would drift.
            if sample.id in duplicate_ids:
                duplicates += 1
                continue
            if not self._within_session_bounds(
                sample.recorded_at,
                lower_bound,
                upper_bound,
                upper_inclusive,
            ):
                discarded += 1
                continue
            if self.privacy_zones.is_within_any_zone(
                latitude=sample.latitude,
                longitude=sample.longitude,
                zones=zones,
            ):
                filtered += 1
                continue

            self.db.add(
                GpsTrackSample(
                    id=sample.id,
                    trip_id=trip_id,
                    session_id=session_id,
                    recorded_at=sample.recorded_at,
                    latitude=sample.latitude,
                    longitude=sample.longitude,
                    accuracy_meters=sample.accuracy_meters,
                    travel_mode=sample.travel_mode,
                )
            )
            accepted += 1

        self.db.commit()
        return SampleBatchResult(
            accepted=accepted,
            filtered=filtered,
            duplicates=duplicates,
            discarded=discarded,
        )

    @staticmethod
    def _within_session_bounds(
        recorded_at: datetime,
        lower_bound: datetime,
        upper_bound: datetime,
        upper_inclusive: bool,
    ) -> bool:
        if recorded_at < lower_bound:
            return False
        if upper_inclusive:
            return recorded_at <= upper_bound
        return recorded_at < upper_bound

    # ------------------------------------------------------------------
    # Raw sample reads
    # ------------------------------------------------------------------
    def list_samples(
        self,
        *,
        trip_id: uuid.UUID,
        session_id: uuid.UUID,
        current_user_id: uuid.UUID,
        limit: int,
        cursor: str | None,
    ) -> tuple[list[GpsTrackSample], str | None]:
        self._require_trip_permission(
            trip_id=trip_id,
            user_id=current_user_id,
            permission=TripPermission.GET_TRACKING,
        )
        self._get_session(trip_id=trip_id, session_id=session_id)

        conditions = [GpsTrackSample.session_id == session_id]
        if cursor is not None:
            cursor_recorded_at, cursor_id = self._decode_cursor(cursor)
            conditions.append(
                or_(
                    GpsTrackSample.recorded_at > cursor_recorded_at,
                    (GpsTrackSample.recorded_at == cursor_recorded_at)
                    & (GpsTrackSample.id > cursor_id),
                )
            )

        rows = list(
            self.db.execute(
                select(GpsTrackSample)
                .where(*conditions)
                .order_by(
                    GpsTrackSample.recorded_at.asc(),
                    GpsTrackSample.id.asc(),
                )
                .limit(limit + 1)
            )
            .scalars()
            .all()
        )

        if len(rows) > limit:
            rows = rows[:limit]
            last = rows[-1]
            return rows, self._encode_cursor(last.recorded_at, last.id)
        return rows, None

    @staticmethod
    def _encode_cursor(recorded_at: datetime, sample_id: uuid.UUID) -> str:
        payload = json.dumps(
            {'r': recorded_at.isoformat(), 'i': str(sample_id)},
            separators=(',', ':'),
        )
        return base64.urlsafe_b64encode(payload.encode('utf-8')).decode('ascii')

    @staticmethod
    def _decode_cursor(cursor: str) -> tuple[datetime, uuid.UUID]:
        try:
            padding = '=' * (-len(cursor) % 4)
            raw = base64.urlsafe_b64decode(cursor + padding)
            payload = json.loads(raw.decode('utf-8'))
            return datetime.fromisoformat(payload['r']), uuid.UUID(payload['i'])
        except (
            binascii.Error,
            UnicodeDecodeError,
            json.JSONDecodeError,
            KeyError,
            TypeError,
            ValueError,
        ) as exc:
            raise InvalidCursorError('Cursor could not be decoded') from exc

    # ------------------------------------------------------------------
    # Bulk sample operations
    # ------------------------------------------------------------------
    def update_sample_modes(
        self,
        *,
        trip_id: uuid.UUID,
        current_user_id: uuid.UUID,
        sample_ids: list[uuid.UUID],
        travel_mode: TravelMode,
    ) -> int:
        self._require_trip_permission(
            trip_id=trip_id,
            user_id=current_user_id,
            permission=TripPermission.MANAGE_TRACKING,
        )
        self._require_all_samples_in_trip(trip_id=trip_id, sample_ids=sample_ids)
        self.db.execute(
            update(GpsTrackSample)
            .where(
                GpsTrackSample.trip_id == trip_id,
                GpsTrackSample.id.in_(sample_ids),
            )
            .values(travel_mode=travel_mode, updated_at=utcnow())
        )
        self.db.commit()
        return len(sample_ids)

    def delete_samples(
        self,
        *,
        trip_id: uuid.UUID,
        current_user_id: uuid.UUID,
        sample_ids: list[uuid.UUID],
    ) -> int:
        self._require_trip_permission(
            trip_id=trip_id,
            user_id=current_user_id,
            permission=TripPermission.MANAGE_TRACKING,
        )
        self._require_all_samples_in_trip(trip_id=trip_id, sample_ids=sample_ids)
        self.db.execute(
            delete(GpsTrackSample).where(
                GpsTrackSample.trip_id == trip_id,
                GpsTrackSample.id.in_(sample_ids),
            )
        )
        self.db.commit()
        return len(sample_ids)

    def _require_all_samples_in_trip(
        self,
        *,
        trip_id: uuid.UUID,
        sample_ids: list[uuid.UUID],
    ) -> None:
        """Reject the whole request unless every id is retained in this trip.

        The denormalized ``trip_id`` makes this a single indexed count with no
        session join, and one status for missing/deleted/other-trip ids keeps
        the endpoint from confirming another trip's samples.
        """
        found = self.db.execute(
            select(func.count())
            .select_from(GpsTrackSample)
            .where(
                GpsTrackSample.trip_id == trip_id,
                GpsTrackSample.id.in_(sample_ids),
            )
        ).scalar_one()
        if found != len(sample_ids):
            raise TrackSampleNotFoundError(
                'Every sample id must be a retained point in this trip'
            )

    # ------------------------------------------------------------------
    # Timeline geometry
    # ------------------------------------------------------------------
    def build_timeline_geometry(
        self,
        *,
        trip_id: uuid.UUID,
        posts: list[Post],
        is_member: bool,
        share_live_location: bool,
    ) -> TimelineGeometry:
        """Build every GPS-derived route the post timeline exposes.

        Loads the trip's retained points once and slices them in Python rather
        than issuing a query per post interval.
        """
        open_session = self._get_open_session(trip_id)
        open_session_id = open_session.id if open_session is not None else None
        gps_anchors = self._load_gps_anchors(trip_id)

        post_anchors = [self._post_anchor(post) for post in posts]

        if not post_anchors:
            return self._postless_geometry(
                gps_anchors=gps_anchors,
                open_session_id=open_session_id,
                is_member=is_member,
                share_live_location=share_live_location,
            )

        opening_segments = self._build_opening_route(
            gps_anchors=gps_anchors,
            first_post=post_anchors[0],
        )
        transition_segments: dict[int, list[PostTimelineRouteSegmentResponse]] = {}
        for index in range(len(post_anchors) - 1):
            transition_segments[index] = self._build_transition(
                gps_anchors=gps_anchors,
                post_a=post_anchors[index],
                post_b=post_anchors[index + 1],
            )

        final_segments, final_route_has_open_endpoint = self._build_final_route(
            gps_anchors=gps_anchors,
            final_post=post_anchors[-1],
            open_session_id=open_session_id,
            is_member=is_member,
            share_live_location=share_live_location,
        )

        return TimelineGeometry(
            opening_segments=opening_segments,
            transition_segments=transition_segments,
            final_segments=final_segments,
            carries_unbounded_open_geometry=final_route_has_open_endpoint,
        )

    def _postless_geometry(
        self,
        *,
        gps_anchors: list[_Anchor],
        open_session_id: uuid.UUID | None,
        is_member: bool,
        share_live_location: bool,
    ) -> TimelineGeometry:
        """The whole retained path, because no post divides history from now.

        This is the one opening route with no upper bound, so its open-session
        tail is the only part of ``opening_route`` the live-sharing switch gates.
        """
        include_open = is_member or share_live_location
        anchors = [
            anchor
            for anchor in gps_anchors
            if include_open or anchor.session_id != open_session_id
        ]
        segments = (
            self._segments_from_anchors(
                anchors,
                member_only_session_id=(
                    open_session_id if is_member and not share_live_location else None
                ),
            )
            if len(anchors) >= 2
            else None
        )
        opening_has_open_endpoint = segments is not None and any(
            anchor.session_id == open_session_id for anchor in anchors
        )
        return TimelineGeometry(
            opening_segments=segments,
            transition_segments={},
            final_segments=None,
            carries_unbounded_open_geometry=opening_has_open_endpoint,
        )

    def _build_opening_route(
        self,
        *,
        gps_anchors: list[_Anchor],
        first_post: _Anchor,
    ) -> list[PostTimelineRouteSegmentResponse] | None:
        """Every retained point before the first visible post, then that post.

        No live-sharing gate applies. Every coordinate here sorts before a post
        whose location and timestamp the same reader can already see, so the
        route cannot disclose a present position even when the points come from
        a session that is still open.
        """
        leading = [
            anchor for anchor in gps_anchors if anchor.sort_key < first_post.sort_key
        ]
        if not leading:
            return None
        return self._segments_from_anchors([*leading, first_post])

    def _build_transition(
        self,
        *,
        gps_anchors: list[_Anchor],
        post_a: _Anchor,
        post_b: _Anchor,
    ) -> list[PostTimelineRouteSegmentResponse]:
        between = [
            anchor
            for anchor in gps_anchors
            if post_a.sort_key < anchor.sort_key < post_b.sort_key
        ]
        # With no GPS point between them the two-item anchor list naturally
        # produces the existing straight UNKNOWN post-to-post segment.
        return self._segments_from_anchors([post_a, *between, post_b])

    def _build_final_route(
        self,
        *,
        gps_anchors: list[_Anchor],
        final_post: _Anchor,
        open_session_id: uuid.UUID | None,
        is_member: bool,
        share_live_location: bool,
    ) -> tuple[list[PostTimelineRouteSegmentResponse] | None, bool]:
        # Members always see the trip's trailing path. Other readers only see
        # it when live-location sharing is enabled.
        if not (is_member or share_live_location):
            return None, False

        trailing = [
            anchor for anchor in gps_anchors if anchor.sort_key > final_post.sort_key
        ]
        if not trailing:
            return None, False

        return (
            self._segments_from_anchors(
                [final_post, *trailing],
                visible_to_members_only=is_member and not share_live_location,
            ),
            open_session_id is not None and trailing[-1].session_id == open_session_id,
        )

    # ------------------------------------------------------------------
    # Anchor plumbing
    # ------------------------------------------------------------------
    @staticmethod
    def _post_anchor(post: Post) -> _Anchor:
        # Posts sort before GPS points at equal timestamps, so the second key
        # element is the anchor kind.
        return _Anchor(
            sort_key=(post.occurred_at, 0, post.id),
            latitude=post.location.latitude,
            longitude=post.location.longitude,
            travel_mode=None,
            is_post=True,
        )

    def _load_gps_anchors(self, trip_id: uuid.UUID) -> list[_Anchor]:
        rows = self.db.execute(
            select(
                GpsTrackSample.recorded_at,
                GpsTrackSample.id,
                GpsTrackSample.latitude,
                GpsTrackSample.longitude,
                GpsTrackSample.travel_mode,
                GpsTrackSample.session_id,
                GpsTrackingSession.started_at,
            )
            .join(
                GpsTrackingSession,
                GpsTrackingSession.id == GpsTrackSample.session_id,
            )
            .where(
                GpsTrackSample.trip_id == trip_id,
            )
            .order_by(
                GpsTrackSample.recorded_at.asc(),
                GpsTrackingSession.started_at.asc(),
                GpsTrackSample.session_id.asc(),
                GpsTrackSample.id.asc(),
            )
        ).all()

        return [
            _Anchor(
                # Same-time GPS points order by their session's start, then
                # session id, then sample id, so touching sessions interleave
                # deterministically instead of by unrelated point UUIDs.
                sort_key=(
                    row.recorded_at,
                    1,
                    row.started_at,
                    row.session_id,
                    row.id,
                ),
                latitude=row.latitude,
                longitude=row.longitude,
                travel_mode=TravelMode(row.travel_mode),
                is_post=False,
                session_id=row.session_id,
            )
            for row in rows
        ]

    def _segments_from_anchors(
        self,
        anchors: list[_Anchor],
        *,
        visible_to_members_only: bool = False,
        member_only_session_id: uuid.UUID | None = None,
    ) -> list[PostTimelineRouteSegmentResponse]:
        """Turn a chronological anchor list into mode-split, simplified segments."""
        segments: list[PostTimelineRouteSegmentResponse] = []
        current_mode = self._edge_mode(anchors[0], anchors[1])
        current_member_only = visible_to_members_only or (
            member_only_session_id is not None
            and anchors[1].session_id == member_only_session_id
        )
        current: list[_Anchor] = [anchors[0], anchors[1]]

        for previous, current_anchor in zip(anchors[1:], anchors[2:], strict=False):
            mode = self._edge_mode(previous, current_anchor)
            member_only = visible_to_members_only or (
                member_only_session_id is not None
                and current_anchor.session_id == member_only_session_id
            )
            if mode != current_mode or member_only != current_member_only:
                segments.append(
                    self._segment(
                        current_mode,
                        current,
                        visible_to_members_only=current_member_only,
                    )
                )
                # The boundary coordinate belongs to both adjacent segments.
                current = [current[-1]]
                current_mode = mode
                current_member_only = member_only
            current.append(current_anchor)

        segments.append(
            self._segment(
                current_mode,
                current,
                visible_to_members_only=current_member_only,
            )
        )
        return segments

    @staticmethod
    def _edge_mode(source: _Anchor, destination: _Anchor) -> TravelMode:
        if not destination.is_post:
            return destination.travel_mode or TravelMode.UNKNOWN
        if not source.is_post:
            # A post carries no mode of its own, so the final approach borrows
            # the previous leg's. This is the one edge whose mode is not taken
            # from its destination.
            return source.travel_mode or TravelMode.UNKNOWN
        return TravelMode.UNKNOWN

    @staticmethod
    def _segment(
        travel_mode: TravelMode,
        anchors: list[_Anchor],
        *,
        visible_to_members_only: bool = False,
    ) -> PostTimelineRouteSegmentResponse:
        coordinates = [(anchor.longitude, anchor.latitude) for anchor in anchors]
        return PostTimelineRouteSegmentResponse(
            travel_mode=travel_mode,
            geometry=GeoJsonLineString(coordinates=simplify_line(coordinates)),
            visible_to_members_only=visible_to_members_only,
        )

    # ------------------------------------------------------------------
    # Shared helpers
    # ------------------------------------------------------------------
    def _require_trip(self, trip_id: uuid.UUID) -> Trip:
        trip = self.db.get(Trip, trip_id)
        if trip is None:
            raise TripNotFoundError(f'Trip not found: {trip_id}')
        return trip

    def _lock_trip(self, trip_id: uuid.UUID) -> None:
        self.db.execute(select(Trip).where(Trip.id == trip_id).with_for_update())

    def _require_membership(
        self,
        *,
        trip_id: uuid.UUID,
        user_id: uuid.UUID,
    ) -> TripMember:
        membership = get_membership(self.db, trip_id=trip_id, user_id=user_id)
        if membership is None:
            # Conceal the trip from a caller who cannot read it at all; a trip
            # reader who merely lacks the permission gets a 403.
            if (
                get_trip_read_access(
                    self.db,
                    trip_id=trip_id,
                    current_user_id=user_id,
                )
                is None
            ):
                raise TripNotFoundError(f'Trip not found: {trip_id}')
            raise TrackingPermissionError('The user does not have enough privileges')
        return membership

    def _require_trip_permission(
        self,
        *,
        trip_id: uuid.UUID,
        user_id: uuid.UUID,
        permission: TripPermission,
    ) -> TripMember:
        membership = self._require_membership(trip_id=trip_id, user_id=user_id)
        if not role_has_permission(membership.role, permission):
            raise TrackingPermissionError('The user does not have enough privileges')
        return membership

    def _get_open_session(self, trip_id: uuid.UUID) -> GpsTrackingSession | None:
        return self.db.execute(
            select(GpsTrackingSession).where(
                GpsTrackingSession.trip_id == trip_id,
                GpsTrackingSession.ended_at.is_(None),
            )
        ).scalar_one_or_none()

    def _get_session(
        self,
        *,
        trip_id: uuid.UUID,
        session_id: uuid.UUID,
    ) -> GpsTrackingSession:
        session = self.db.execute(
            select(GpsTrackingSession).where(
                GpsTrackingSession.id == session_id,
                GpsTrackingSession.trip_id == trip_id,
            )
        ).scalar_one_or_none()
        if session is None:
            raise TrackingSessionNotFoundError(f'Session not found: {session_id}')
        return session

    def _require_no_overlap(
        self,
        *,
        trip_id: uuid.UUID,
        session_id: uuid.UUID,
        started_at: datetime,
        ended_at: datetime | None,
    ) -> None:
        """Reject a session interval that collides with an accepted one.

        Intervals are half-open ``[started_at, ended_at)`` so two sessions may
        touch at a single timestamp, and an open session occupies
        ``[started_at, infinity)``.
        """
        others = self.db.execute(
            select(GpsTrackingSession).where(
                GpsTrackingSession.trip_id == trip_id,
                GpsTrackingSession.id != session_id,
            )
        ).scalars()

        for other in others:
            starts_before_other_ends = (
                other.ended_at is None or started_at < other.ended_at
            )
            other_starts_before_this_ends = (
                ended_at is None or other.started_at < ended_at
            )
            if starts_before_other_ends and other_starts_before_this_ends:
                raise TrackingSessionConflictError(
                    f'Session overlaps an accepted session: {other.id}'
                )
