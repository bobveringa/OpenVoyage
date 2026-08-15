import uuid

from sqlalchemy import func, select
from sqlalchemy.orm import Session, joinedload, selectinload

from models.api.pagination import SortDirection
from models.api.posts import (
    PostCreateRequest,
    PostSortField,
    PostStatusFilter,
    PostUpdateRequest,
)
from models.database.base import utcnow
from models.database.media import Media
from models.database.posts import Post, PostMedia
from models.database.trips import TripMember, TripRole
from models.database.user import User
from services.location_service import LocationService
from services.trip_access import TripReadAccess, get_trip_read_access, get_membership
from services.trip_authorization import TripPermission, role_has_permission
from services.trip_errors import TripNotFoundError


class PostNotFoundError(Exception):
    """Raised when a post cannot be found or read by the user."""


class MediaNotFoundError(Exception):
    """Raised when requested post media cannot be found."""


class DuplicatePostMediaError(Exception):
    """Raised when the same media id appears multiple times in one post."""


class PostMediaOwnershipError(Exception):
    """Raised when a user attaches media they do not own."""


class PostPermissionError(Exception):
    """Raised when a trip member does not have enough post privileges."""


class PostService:
    """Coordinates post lifecycle, media ordering, and post authorization."""

    def __init__(
        self,
        db: Session,
        location_service: LocationService,
    ) -> None:
        self.db = db
        self.location_service = location_service

    def create_post(
        self,
        trip_id: uuid.UUID,
        payload: PostCreateRequest,
        current_user_id: uuid.UUID,
    ) -> Post:
        membership = self._require_trip_permission(
            trip_id=trip_id,
            user_id=current_user_id,
            permission=TripPermission.CREATE_POST,
        )
        location = self.location_service.create_location_for_trip(
            trip_id=trip_id,
            created_by=current_user_id,
            location_input=payload.location,
        )
        media_by_id = self._validate_media_ids(
            media_ids=payload.media_ids,
            current_user_id=current_user_id,
        )

        post = Post(
            trip_id=trip_id,
            author_user_id=membership.user_id,
            location_id=location.id,
            title=payload.title,
            body=payload.body,
            occurred_at=payload.occurred_at,
            published_at=utcnow() if payload.publish else None,
        )
        self.db.add(post)
        self.db.flush()

        for sort_order, media_id in enumerate(payload.media_ids):
            self.db.add(
                PostMedia(
                    post_id=post.id,
                    media_id=media_by_id[media_id].id,
                    sort_order=sort_order,
                )
            )

        post_id = post.id
        self.db.commit()
        return self._get_post_for_response(post_id=post_id, trip_id=trip_id)

    def list_posts(
        self,
        trip_id: uuid.UUID,
        current_user_id: uuid.UUID | None,
        share_token: str | None = None,
        *,
        offset: int,
        limit: int,
        sort_by: PostSortField,
        sort_order: SortDirection,
        status_filter: PostStatusFilter,
    ) -> tuple[list[Post], int]:
        access = self._get_readable_trip_access(
            trip_id=trip_id,
            current_user_id=current_user_id,
            share_token=share_token,
        )
        conditions = [Post.trip_id == trip_id]
        if status_filter == PostStatusFilter.PUBLISHED:
            conditions.append(Post.published_at.is_not(None))
        elif status_filter == PostStatusFilter.DRAFT:
            if not self._can_read_drafts(access):
                return [], 0
            conditions.append(Post.published_at.is_(None))
        elif status_filter == PostStatusFilter.ALL and not self._can_read_drafts(
            access
        ):
            conditions.append(Post.published_at.is_not(None))

        sort_columns = {
            PostSortField.OCCURRED_AT: Post.occurred_at,
            PostSortField.PUBLISHED_AT: Post.published_at,
            PostSortField.CREATED_AT: Post.created_at,
            PostSortField.UPDATED_AT: Post.updated_at,
        }
        sort_column = sort_columns[sort_by]
        sort_expression = (
            sort_column.asc().nulls_last()
            if sort_order == SortDirection.ASC
            else sort_column.desc().nulls_last()
        )

        total_statement = select(func.count()).select_from(Post).where(*conditions)
        statement = (
            self._post_response_statement()
            .where(*conditions)
            .order_by(sort_expression, Post.id.asc())
            .offset(offset)
            .limit(limit)
        )

        posts = list(self.db.execute(statement).scalars().all())
        total = self.db.execute(total_statement).scalar_one()
        return posts, total

    def get_post(
        self,
        trip_id: uuid.UUID,
        post_id: uuid.UUID,
        current_user_id: uuid.UUID | None,
        share_token: str | None = None,
    ) -> Post:
        access = self._get_readable_trip_access(
            trip_id=trip_id,
            current_user_id=current_user_id,
            share_token=share_token,
        )
        post = self._get_post_for_response(post_id=post_id, trip_id=trip_id)
        if post.published_at is None and not self._can_read_drafts(access):
            raise PostNotFoundError(f'Post not found: {post_id}')
        return post

    def update_post(
        self,
        trip_id: uuid.UUID,
        post_id: uuid.UUID,
        payload: PostUpdateRequest,
        current_user_id: uuid.UUID,
    ) -> Post:
        post = self._get_writable_post(
            trip_id=trip_id,
            post_id=post_id,
            current_user_id=current_user_id,
            permission=TripPermission.UPDATE_POST,
        )

        if payload.body is not None:
            post.body = payload.body
        if payload.title is not None:
            post.title = payload.title
        if payload.location is not None:
            location = self.location_service.create_location_for_trip(
                trip_id=trip_id,
                created_by=current_user_id,
                location_input=payload.location,
            )
            post.location_id = location.id
        if payload.occurred_at is not None:
            post.occurred_at = payload.occurred_at
        if payload.media_ids is not None:
            self._validate_media_ids(
                media_ids=payload.media_ids,
                current_user_id=current_user_id,
            )
            self._replace_post_media(post=post, media_ids=payload.media_ids)

        self.db.commit()
        return self._get_post_for_response(post_id=post_id, trip_id=trip_id)

    def delete_post(
        self,
        trip_id: uuid.UUID,
        post_id: uuid.UUID,
        current_user_id: uuid.UUID,
    ) -> None:
        post = self._get_writable_post(
            trip_id=trip_id,
            post_id=post_id,
            current_user_id=current_user_id,
            permission=TripPermission.DELETE_POST,
        )
        self.db.delete(post)
        self.db.commit()

    def publish_post(
        self,
        trip_id: uuid.UUID,
        post_id: uuid.UUID,
        current_user_id: uuid.UUID,
    ) -> Post:
        post = self._get_writable_post(
            trip_id=trip_id,
            post_id=post_id,
            current_user_id=current_user_id,
            permission=TripPermission.PUBLISH_POST,
        )
        if post.published_at is None:
            post.published_at = utcnow()
        self.db.commit()
        return self._get_post_for_response(post_id=post_id, trip_id=trip_id)

    def unpublish_post(
        self,
        trip_id: uuid.UUID,
        post_id: uuid.UUID,
        current_user_id: uuid.UUID,
    ) -> Post:
        post = self._get_writable_post(
            trip_id=trip_id,
            post_id=post_id,
            current_user_id=current_user_id,
            permission=TripPermission.PUBLISH_POST,
        )
        post.published_at = None
        self.db.commit()
        return self._get_post_for_response(post_id=post_id, trip_id=trip_id)

    def _replace_post_media(self, post: Post, media_ids: list[uuid.UUID]) -> None:
        for link in list(post.media_links):
            self.db.delete(link)
        self.db.flush()

        for sort_order, media_id in enumerate(media_ids):
            self.db.add(
                PostMedia(
                    post_id=post.id,
                    media_id=media_id,
                    sort_order=sort_order,
                )
            )

    def _get_writable_post(
        self,
        trip_id: uuid.UUID,
        post_id: uuid.UUID,
        current_user_id: uuid.UUID,
        permission: TripPermission,
    ) -> Post:
        membership = self._require_trip_permission(
            trip_id=trip_id,
            user_id=current_user_id,
            permission=permission,
        )
        post = self._get_post_for_write(post_id=post_id, trip_id=trip_id)

        if membership.role == TripRole.OWNER:
            return post
        if post.author_user_id == current_user_id:
            return post

        raise PostPermissionError('The user does not have enough privileges')

    def _validate_media_ids(
        self,
        media_ids: list[uuid.UUID],
        current_user_id: uuid.UUID,
    ) -> dict[uuid.UUID, Media]:
        if len(set(media_ids)) != len(media_ids):
            raise DuplicatePostMediaError('Post media ids must be unique')
        if not media_ids:
            return {}

        media = list(
            self.db.execute(select(Media).where(Media.id.in_(media_ids)))
            .scalars()
            .all()
        )
        media_by_id = {item.id: item for item in media}
        for media_id in media_ids:
            item = media_by_id.get(media_id)
            if item is None:
                raise MediaNotFoundError(f'Media not found: {media_id}')
            if item.created_by != current_user_id:
                raise PostMediaOwnershipError(
                    'The selected media is not owned by the user'
                )
        return media_by_id

    def _get_readable_trip_access(
        self,
        trip_id: uuid.UUID,
        current_user_id: uuid.UUID | None,
        share_token: str | None = None,
    ) -> TripReadAccess:
        access = get_trip_read_access(
            self.db,
            trip_id=trip_id,
            current_user_id=current_user_id,
            share_token=share_token,
        )
        if access is None:
            raise TripNotFoundError(f'Trip not found: {trip_id}')
        return access

    def _can_read_drafts(self, access: TripReadAccess) -> bool:
        return access.can_read_drafts

    def _get_membership(
        self,
        trip_id: uuid.UUID,
        user_id: uuid.UUID,
    ) -> TripMember | None:
        return get_membership(self.db, trip_id=trip_id, user_id=user_id)

    def _require_trip_permission(
        self,
        trip_id: uuid.UUID,
        user_id: uuid.UUID,
        permission: TripPermission,
    ) -> TripMember:
        membership = self._get_membership(trip_id=trip_id, user_id=user_id)
        if membership is None:
            if (
                get_trip_read_access(
                    self.db,
                    trip_id=trip_id,
                    current_user_id=user_id,
                )
                is not None
            ):
                raise PostPermissionError('The user does not have enough privileges')
            raise TripNotFoundError(f'Trip not found: {trip_id}')
        if not role_has_permission(membership.role, permission):
            raise PostPermissionError('The user does not have enough privileges')
        return membership

    def _post_response_statement(self):
        return select(Post).options(
            joinedload(Post.author).joinedload(User.profile),
            joinedload(Post.location),
            selectinload(Post.media_links).joinedload(PostMedia.media),
        )

    def _get_post_for_response(self, post_id: uuid.UUID, trip_id: uuid.UUID) -> Post:
        post = self.db.execute(
            self._post_response_statement().where(
                Post.id == post_id,
                Post.trip_id == trip_id,
            )
        ).scalar_one_or_none()
        if post is None:
            raise PostNotFoundError(f'Post not found: {post_id}')
        return post

    def _get_post_for_write(self, post_id: uuid.UUID, trip_id: uuid.UUID) -> Post:
        post = self.db.execute(
            select(Post)
            .options(selectinload(Post.media_links))
            .where(Post.id == post_id, Post.trip_id == trip_id)
        ).scalar_one_or_none()
        if post is None:
            raise PostNotFoundError(f'Post not found: {post_id}')
        return post
