import uuid
from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload, selectinload

from models.api.posts import (
    PostStatusFilter,
    PostTimelineRouteResponse,
    PostTimelineRouteSegmentResponse,
)
from models.api.geojson import GeoJsonLineString
from models.database.itinerary import TravelMode
from models.database.posts import Post, PostMedia
from models.database.user import User
from services.post_service import TripNotFoundError
from services.trip_access import get_trip_read_access


@dataclass(frozen=True)
class PostTimelineEntry:
    post: Post
    route_after: PostTimelineRouteResponse | None


class PostTimelineService:
    """Builds the chronological post-and-route read model for a trip."""

    def __init__(self, db: Session) -> None:
        self.db = db

    def get_timeline(
        self,
        *,
        trip_id: uuid.UUID,
        current_user_id: uuid.UUID | None,
        share_token: str | None = None,
        status_filter: PostStatusFilter,
    ) -> list[PostTimelineEntry]:
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
                return []
            conditions.append(Post.published_at.is_(None))
        elif status_filter == PostStatusFilter.ALL and not access.can_read_drafts:
            conditions.append(Post.published_at.is_not(None))

        posts = list(
            self.db.execute(
                select(Post)
                .options(
                    joinedload(Post.author).joinedload(User.profile),
                    joinedload(Post.location),
                    selectinload(Post.media_links).joinedload(PostMedia.media),
                )
                .where(*conditions)
                .order_by(Post.occurred_at.asc(), Post.id.asc())
            )
            .scalars()
            .all()
        )

        entries: list[PostTimelineEntry] = []
        for index, post in enumerate(posts):
            next_post = posts[index + 1] if index + 1 < len(posts) else None
            entries.append(
                PostTimelineEntry(
                    post=post,
                    route_after=(
                        self._straight_route(post, next_post)
                        if next_post is not None
                        else None
                    ),
                )
            )
        return entries

    @staticmethod
    def _straight_route(from_post: Post, to_post: Post) -> PostTimelineRouteResponse:
        duration_seconds = int(
            (to_post.occurred_at - from_post.occurred_at).total_seconds()
        )
        return PostTimelineRouteResponse(
            duration_seconds=duration_seconds,
            segments=[
                PostTimelineRouteSegmentResponse(
                    travel_mode=TravelMode.UNKNOWN,
                    geometry=GeoJsonLineString(
                        coordinates=[
                            (
                                from_post.location.longitude,
                                from_post.location.latitude,
                            ),
                            (
                                to_post.location.longitude,
                                to_post.location.latitude,
                            ),
                        ]
                    ),
                )
            ],
        )
