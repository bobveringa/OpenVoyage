from __future__ import annotations

import base64
import json
import uuid
from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime

from sqlalchemy import and_, delete, func, or_, select
from sqlalchemy.orm import Session, joinedload

from models.api.pagination import CursorPaginatedResponse
from models.api.posts import (
    PostCommentCreateRequest,
    PostCommentResponse,
    PostSocialSummaryResponse,
    ShareLinkCommentAuthorResponse,
    UserCommentAuthorResponse,
)
from models.api.users import UserDisplaySummaryResponse
from models.api.trips import ShareLinkDisplayNameUpdateRequest
from models.database.posts import Post, PostComment, PostLike
from models.database.trips import TripMember, TripRole, TripShareLink, TripViewer
from models.database.trips import TripVisibility
from models.database.user import User, UserProfile
from services.trip_access import (
    TripAccessSource,
    TripReadAccess,
    get_trip_read_access,
    get_valid_share_link,
)


class SocialNotFoundError(Exception):
    pass


class SocialPermissionError(Exception):
    pass


class SocialNameRequiredError(Exception):
    pass


class SocialProfileLockedError(Exception):
    pass


class InvalidCommentCursorError(Exception):
    pass


@dataclass(frozen=True)
class SocialRequestContext:
    access: TripReadAccess
    user_id: uuid.UUID | None
    presented_share_link: TripShareLink | None

    @property
    def actor_user_id(self) -> uuid.UUID | None:
        return self.user_id

    @property
    def actor_share_link_id(self) -> uuid.UUID | None:
        return (
            self.access.share_link.id
            if self.user_id is None and self.access.share_link
            else None
        )


class PostSocialService:
    def __init__(self, db: Session) -> None:
        self.db = db

    def get_context(
        self,
        *,
        trip_id: uuid.UUID,
        current_user_id: uuid.UUID | None,
        share_token: str | None,
    ) -> SocialRequestContext:
        access = get_trip_read_access(
            self.db,
            trip_id=trip_id,
            current_user_id=current_user_id,
            share_token=share_token,
        )
        if access is None:
            raise SocialNotFoundError(f'Trip not found: {trip_id}')
        # A presented valid link remains relevant for delete rights even where
        # a signed-in identity was preferred for read/create authorization.
        presented_link = get_valid_share_link(
            self.db, trip_id=trip_id, share_token=share_token
        )
        return SocialRequestContext(access, current_user_id, presented_link)

    def get_summaries(
        self,
        *,
        trip_id: uuid.UUID,
        post_ids: list[uuid.UUID],
        current_user_id: uuid.UUID | None,
        share_token: str | None,
        context: SocialRequestContext | None = None,
    ) -> dict[uuid.UUID, PostSocialSummaryResponse]:
        if not post_ids:
            return {}
        context = context or self.get_context(
            trip_id=trip_id, current_user_id=current_user_id, share_token=share_token
        )
        like_counts = dict(
            self.db.execute(
                select(PostLike.post_id, func.count(PostLike.id))
                .where(PostLike.post_id.in_(post_ids))
                .group_by(PostLike.post_id)
            ).all()
        )
        comment_counts = dict(
            self.db.execute(
                select(PostComment.post_id, func.count(PostComment.id))
                .where(PostComment.post_id.in_(post_ids))
                .group_by(PostComment.post_id)
            ).all()
        )
        actor_condition = self._actor_like_condition(context)
        liked_ids: set[uuid.UUID] = set()
        if actor_condition is not None:
            liked_ids = set(
                self.db.execute(
                    select(PostLike.post_id).where(
                        PostLike.post_id.in_(post_ids), actor_condition
                    )
                ).scalars()
            )
        post_details = {
            post_id: (author_user_id, published_at)
            for post_id, author_user_id, published_at in self.db.execute(
                select(Post.id, Post.author_user_id, Post.published_at).where(
                    Post.id.in_(post_ids),
                    Post.trip_id == trip_id,
                )
            ).all()
        }
        can_interact = self._can_create(context)
        can_start_like = self._can_start_like(context)
        summaries: dict[uuid.UUID, PostSocialSummaryResponse] = {}
        for post_id in post_ids:
            author_user_id, published_at = post_details.get(post_id, (None, None))
            is_published = published_at is not None
            is_own_post = (
                context.actor_user_id is not None
                and context.actor_user_id == author_user_id
            )
            summaries[post_id] = PostSocialSummaryResponse(
                like_count=like_counts.get(post_id, 0),
                comment_count=comment_counts.get(post_id, 0),
                viewer_has_liked=post_id in liked_ids and not is_own_post,
                can_interact=can_interact and is_published,
                can_like=can_start_like and is_published and not is_own_post,
            )
        return summaries

    def get_summary(
        self,
        *,
        trip_id: uuid.UUID,
        post_id: uuid.UUID,
        current_user_id: uuid.UUID | None,
        share_token: str | None,
        context: SocialRequestContext | None = None,
    ) -> PostSocialSummaryResponse:
        return self.get_summaries(
            trip_id=trip_id,
            post_ids=[post_id],
            current_user_id=current_user_id,
            share_token=share_token,
            context=context,
        )[post_id]

    def like(
        self,
        *,
        trip_id: uuid.UUID,
        post_id: uuid.UUID,
        current_user_id: uuid.UUID | None,
        share_token: str | None,
    ) -> PostSocialSummaryResponse:
        context, post = self._get_mutable_post(
            trip_id=trip_id,
            post_id=post_id,
            current_user_id=current_user_id,
            share_token=share_token,
            creation=True,
        )
        if context.actor_user_id == post.author_user_id:
            raise SocialPermissionError('You cannot like your own post.')
        condition = self._actor_like_condition(context)
        assert condition is not None
        existing = self.db.execute(
            select(PostLike.id).where(PostLike.post_id == post.id, condition)
        ).scalar_one_or_none()
        if existing is None:
            self.db.add(
                PostLike(
                    post_id=post.id,
                    user_id=context.actor_user_id,
                    share_link_id=context.actor_share_link_id,
                )
            )
            self.db.commit()
        return self.get_summary(
            trip_id=trip_id,
            post_id=post_id,
            current_user_id=current_user_id,
            share_token=share_token,
            context=context,
        )

    def unlike(
        self,
        *,
        trip_id: uuid.UUID,
        post_id: uuid.UUID,
        current_user_id: uuid.UUID | None,
        share_token: str | None,
    ) -> PostSocialSummaryResponse:
        context, post = self._get_mutable_post(
            trip_id=trip_id,
            post_id=post_id,
            current_user_id=current_user_id,
            share_token=share_token,
            creation=False,
        )
        condition = self._actor_like_condition(context)
        if condition is None:
            raise SocialPermissionError('An interaction identity is required')
        self.db.execute(delete(PostLike).where(PostLike.post_id == post.id, condition))
        self.db.commit()
        return self.get_summary(
            trip_id=trip_id,
            post_id=post_id,
            current_user_id=current_user_id,
            share_token=share_token,
            context=context,
        )

    def list_comments(
        self,
        *,
        trip_id: uuid.UUID,
        post_id: uuid.UUID,
        current_user_id: uuid.UUID | None,
        share_token: str | None,
        cursor: str | None,
        page_size: int,
        media_base_url: str,
        media_token_factory: Callable[[uuid.UUID], str | None] | None,
    ) -> CursorPaginatedResponse[PostCommentResponse]:
        context, post = self._get_readable_post(
            trip_id=trip_id,
            post_id=post_id,
            current_user_id=current_user_id,
            share_token=share_token,
        )
        statement = (
            select(PostComment)
            .options(
                joinedload(PostComment.user)
                .joinedload(User.profile)
                .joinedload(UserProfile.profile_picture),
                joinedload(PostComment.share_link),
            )
            .where(PostComment.post_id == post.id)
            .order_by(PostComment.created_at.desc(), PostComment.id.desc())
        )
        if cursor:
            created_at, comment_id = self._decode_cursor(cursor)
            statement = statement.where(
                or_(
                    PostComment.created_at < created_at,
                    and_(
                        PostComment.created_at == created_at,
                        PostComment.id < comment_id,
                    ),
                )
            )
        comments = list(self.db.execute(statement.limit(page_size + 1)).scalars())
        page = comments[:page_size]
        next_cursor = (
            self._encode_cursor(page[-1])
            if len(comments) > page_size and page
            else None
        )
        return CursorPaginatedResponse(
            items=[
                self._comment_response(
                    comment,
                    context,
                    post.published_at is not None,
                    media_base_url,
                    media_token_factory,
                )
                for comment in page
            ],
            next_cursor=next_cursor,
        )

    def create_comment(
        self,
        *,
        trip_id: uuid.UUID,
        post_id: uuid.UUID,
        payload: PostCommentCreateRequest,
        current_user_id: uuid.UUID | None,
        share_token: str | None,
        media_base_url: str,
        media_token_factory: Callable[[uuid.UUID], str | None] | None,
    ) -> PostCommentResponse:
        context, post = self._get_mutable_post(
            trip_id=trip_id,
            post_id=post_id,
            current_user_id=current_user_id,
            share_token=share_token,
            creation=True,
        )
        comment = PostComment(
            post_id=post.id,
            body=payload.body,
            user_id=context.actor_user_id,
            share_link_id=context.actor_share_link_id,
        )
        self.db.add(comment)
        self.db.commit()
        self.db.refresh(comment)
        if comment.user_id:
            comment.user = self.db.execute(
                select(User)
                .options(
                    joinedload(User.profile).joinedload(UserProfile.profile_picture)
                )
                .where(User.id == comment.user_id)
            ).scalar_one()
        if comment.share_link_id:
            comment.share_link = self.db.get(TripShareLink, comment.share_link_id)
        return self._comment_response(
            comment, context, True, media_base_url, media_token_factory
        )

    def delete_comment(
        self,
        *,
        trip_id: uuid.UUID,
        post_id: uuid.UUID,
        comment_id: uuid.UUID,
        current_user_id: uuid.UUID | None,
        share_token: str | None,
    ) -> None:
        context, post = self._get_readable_post(
            trip_id=trip_id,
            post_id=post_id,
            current_user_id=current_user_id,
            share_token=share_token,
        )
        if post.published_at is None:
            raise SocialPermissionError('Only published posts accept interactions')
        comment = self.db.execute(
            select(PostComment).where(
                PostComment.id == comment_id, PostComment.post_id == post.id
            )
        ).scalar_one_or_none()
        if comment is None:
            raise SocialNotFoundError(f'Comment not found: {comment_id}')
        is_owner = (
            context.access.membership is not None
            and context.access.membership.role == TripRole.OWNER
        )
        if not (
            is_owner
            or (context.user_id is not None and comment.user_id == context.user_id)
            or (
                context.presented_share_link is not None
                and comment.share_link_id == context.presented_share_link.id
            )
        ):
            raise SocialPermissionError('The actor cannot delete this comment')
        self.db.delete(comment)
        self.db.commit()

    def get_share_link_profile(
        self, *, trip_id: uuid.UUID, share_token: str | None
    ) -> TripShareLink:
        link = get_valid_share_link(self.db, trip_id=trip_id, share_token=share_token)
        if link is None:
            raise SocialNotFoundError(f'Share link not found for trip: {trip_id}')
        return link

    def update_share_link_profile(
        self,
        *,
        trip_id: uuid.UUID,
        share_token: str | None,
        payload: ShareLinkDisplayNameUpdateRequest,
    ) -> TripShareLink:
        link = self.get_share_link_profile(trip_id=trip_id, share_token=share_token)
        if link.display_name_locked:
            raise SocialProfileLockedError('The share-link display name is locked')
        link.display_name = payload.display_name
        self.db.commit()
        self.db.refresh(link)
        return link

    def _get_readable_post(
        self,
        *,
        trip_id: uuid.UUID,
        post_id: uuid.UUID,
        current_user_id: uuid.UUID | None,
        share_token: str | None,
    ) -> tuple[SocialRequestContext, Post]:
        context = self.get_context(
            trip_id=trip_id, current_user_id=current_user_id, share_token=share_token
        )
        post = self.db.execute(
            select(Post).where(Post.id == post_id, Post.trip_id == trip_id)
        ).scalar_one_or_none()
        if post is None or (
            post.published_at is None and not context.access.can_read_drafts
        ):
            raise SocialNotFoundError(f'Post not found: {post_id}')
        return context, post

    def _get_mutable_post(
        self,
        *,
        trip_id: uuid.UUID,
        post_id: uuid.UUID,
        current_user_id: uuid.UUID | None,
        share_token: str | None,
        creation: bool,
    ) -> tuple[SocialRequestContext, Post]:
        context, post = self._get_readable_post(
            trip_id=trip_id,
            post_id=post_id,
            current_user_id=current_user_id,
            share_token=share_token,
        )
        if post.published_at is None:
            raise SocialPermissionError('Only published posts accept interactions')
        if creation and not self._can_create(context):
            if (
                context.actor_share_link_id is not None
                and context.access.share_link
                and context.access.share_link.display_name is None
            ):
                raise SocialNameRequiredError('A share-link display name is required')
            raise SocialPermissionError('The actor cannot create interactions')
        return context, post

    def _can_create(self, context: SocialRequestContext) -> bool:
        if context.user_id is not None:
            if context.access.source != TripAccessSource.SHARE_LINK:
                return True
            if context.access.share_link.interactions_enabled:
                return True
            # Authentication chooses the author identity, but a disabled link
            # must not take away a user's separate read grant.
            trip = context.access.trip
            if trip.visibility in {
                TripVisibility.PUBLIC,
                TripVisibility.PLATFORM_PUBLIC,
            }:
                return True
            return (
                self.db.execute(
                    select(func.count())
                    .select_from(TripMember)
                    .where(
                        TripMember.trip_id == trip.id,
                        TripMember.user_id == context.user_id,
                    )
                ).scalar_one()
                > 0
                or self.db.execute(
                    select(func.count())
                    .select_from(TripViewer)
                    .where(
                        TripViewer.trip_id == trip.id,
                        TripViewer.user_id == context.user_id,
                    )
                ).scalar_one()
                > 0
            )
        link = context.access.share_link
        return bool(
            link and link.interactions_enabled and link.display_name is not None
        )

    def _can_start_like(self, context: SocialRequestContext) -> bool:
        if context.actor_user_id is not None:
            return self._can_create(context)
        link = context.access.share_link
        return bool(link and link.interactions_enabled)

    @staticmethod
    def _actor_like_condition(context: SocialRequestContext):
        if context.actor_user_id is not None:
            return PostLike.user_id == context.actor_user_id
        if context.actor_share_link_id is not None:
            return PostLike.share_link_id == context.actor_share_link_id
        return None

    def _comment_response(
        self,
        comment: PostComment,
        context: SocialRequestContext,
        is_published: bool,
        media_base_url: str,
        media_token_factory: Callable[[uuid.UUID], str | None] | None,
    ) -> PostCommentResponse:
        if comment.user_id is not None:
            assert comment.user is not None
            media = (
                comment.user.profile.profile_picture if comment.user.profile else None
            )
            author = UserCommentAuthorResponse(
                user=UserDisplaySummaryResponse.from_model(
                    comment.user,
                    media_base_url,
                    media_token=media_token_factory(media.id)
                    if media and media_token_factory
                    else None,
                )
            )
        else:
            author = ShareLinkCommentAuthorResponse(
                display_name=(
                    comment.share_link.display_name
                    if comment.share_link and comment.share_link.display_name
                    else 'Guest'
                )
            )
        can_delete = is_published and (
            (context.user_id is not None and context.user_id == comment.user_id)
            or (
                context.presented_share_link is not None
                and context.presented_share_link.id == comment.share_link_id
            )
            or (
                context.access.membership is not None
                and context.access.membership.role == TripRole.OWNER
            )
        )
        return PostCommentResponse(
            id=comment.id,
            post_id=comment.post_id,
            author=author,
            body=comment.body,
            created_at=comment.created_at,
            can_delete=can_delete,
        )

    @staticmethod
    def _encode_cursor(comment: PostComment) -> str:
        payload = json.dumps(
            {'created_at': comment.created_at.isoformat(), 'id': str(comment.id)}
        ).encode()
        return base64.urlsafe_b64encode(payload).decode().rstrip('=')

    @staticmethod
    def _decode_cursor(cursor: str) -> tuple[datetime, uuid.UUID]:
        try:
            raw = base64.urlsafe_b64decode(cursor + '=' * (-len(cursor) % 4))
            data = json.loads(raw)
            return datetime.fromisoformat(data['created_at']), uuid.UUID(data['id'])
        except (KeyError, TypeError, ValueError, json.JSONDecodeError) as exc:
            raise InvalidCommentCursorError('Invalid comment cursor') from exc
