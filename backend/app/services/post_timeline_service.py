import uuid
from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload, selectinload

from models.api.posts import (
    PostStatusFilter,
    PostTimelineRouteResponse,
    PostTimelineRouteSegmentResponse,
)
from models.database.posts import Post, PostMedia
from models.database.user import User, UserProfile
from services.gps.tracking_service import GpsTrackingService, TimelineGeometry
from services.trip_errors import TripNotFoundError
from services.trip_access import get_trip_read_access


@dataclass(frozen=True)
class PostTimelineEntry:
    post: Post
    route_after: PostTimelineRouteResponse | None


@dataclass(frozen=True)
class PostTimeline:
    """The public route read model for a trip.

    ``carries_unbounded_open_geometry`` tells the router to send
    ``Cache-Control: no-store``. It is set only for geometry that no visible
    post bounds from above, because that is the only geometry that can
    disclose where somebody is right now.
    """

    opening_segments: list[PostTimelineRouteSegmentResponse] | None
    entries: list[PostTimelineEntry]
    carries_unbounded_open_geometry: bool


class PostTimelineService:
    """Builds the chronological post-and-route read model for a trip."""

    def __init__(
        self,
        db: Session,
        gps_tracking_service: GpsTrackingService,
    ) -> None:
        self.db = db
        self.gps_tracking_service = gps_tracking_service

    def get_timeline(
        self,
        *,
        trip_id: uuid.UUID,
        current_user_id: uuid.UUID | None,
        share_token: str | None = None,
        status_filter: PostStatusFilter,
    ) -> PostTimeline:
        access = get_trip_read_access(
            self.db,
            trip_id=trip_id,
            current_user_id=current_user_id,
            share_token=share_token,
        )
        if access is None:
            raise TripNotFoundError(f'Trip not found: {trip_id}')

        conditions = [Post.trip_id == trip_id]
        if status_filter == PostStatusFilter.PUBLISHED:
            conditions.append(Post.published_at.is_not(None))
        elif status_filter == PostStatusFilter.DRAFT:
            if not access.can_read_drafts:
                # An empty timeline, not a postless one: a reader who cannot
                # see drafts must not fall through to the whole-trip opening
                # route that a genuinely postless trip would return.
                return PostTimeline(
                    opening_segments=None,
                    entries=[],
                    carries_unbounded_open_geometry=False,
                )
            conditions.append(Post.published_at.is_(None))
        elif status_filter == PostStatusFilter.ALL and not access.can_read_drafts:
            conditions.append(Post.published_at.is_not(None))

        posts = list(
            self.db.execute(
                select(Post)
                .options(
                    joinedload(Post.author)
                    .joinedload(User.profile)
                    .joinedload(UserProfile.profile_picture),
                    joinedload(Post.location),
                    selectinload(Post.media_links).joinedload(PostMedia.media),
                )
                .where(*conditions)
                .order_by(Post.occurred_at.asc(), Post.id.asc())
            )
            .scalars()
            .all()
        )

        geometry = self.gps_tracking_service.build_timeline_geometry(
            trip_id=trip_id,
            posts=posts,
            is_member=access.membership is not None,
            share_live_location=access.trip.share_live_location,
        )

        entries: list[PostTimelineEntry] = []
        for index, post in enumerate(posts):
            is_final = index == len(posts) - 1
            if is_final:
                route_after = self._final_route(geometry)
            else:
                route_after = self._transition_route(
                    geometry=geometry,
                    index=index,
                    from_post=post,
                    to_post=posts[index + 1],
                )
            entries.append(PostTimelineEntry(post=post, route_after=route_after))

        return PostTimeline(
            opening_segments=geometry.opening_segments,
            entries=entries,
            carries_unbounded_open_geometry=geometry.carries_unbounded_open_geometry,
        )

    @staticmethod
    def _transition_route(
        *,
        geometry: TimelineGeometry,
        index: int,
        from_post: Post,
        to_post: Post,
    ) -> PostTimelineRouteResponse:
        # Every completed transition already contains its two post anchors, so
        # the plain post-to-post line falls out of the same algorithm when no
        # GPS point lies between them.
        duration_seconds = int(
            (to_post.occurred_at - from_post.occurred_at).total_seconds()
        )
        return PostTimelineRouteResponse(
            duration_seconds=duration_seconds,
            segments=geometry.transition_segments[index],
        )

    @staticmethod
    def _final_route(
        geometry: TimelineGeometry,
    ) -> PostTimelineRouteResponse | None:
        if geometry.final_segments is None:
            return None
        return PostTimelineRouteResponse(
            duration_seconds=None,
            segments=geometry.final_segments,
        )
