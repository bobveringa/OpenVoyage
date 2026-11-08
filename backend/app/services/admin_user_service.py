import uuid
from dataclasses import dataclass

from sqlalchemy import CTE, Select, delete, func, or_, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, contains_eager, joinedload

from core import security
from models.api.admin import (
    AdminUserCreateRequest,
    AdminUserPasswordSetRequest,
    AdminUserUpdateRequest,
)
from models.api.users import canonicalize_username
from models.database.gps_tracking import GpsTrackingSession
from models.database.media import Media
from models.database.posts import Post, PostComment, PostLike, PostMedia
from models.database.trips import (
    Trip,
    TripMember,
    TripRole,
    TripShareLink,
    TripViewer,
)
from models.database.user import (
    User,
    UserProfile,
    UserRole,
    canonical_username_expression,
)
from services.gps.privacy_zone_service import GpsPrivacyZoneService
from services.gps.tracking_service import GpsTrackingService
from services.post_service import keep_bubble_media_id


class AdminUserNotFoundError(Exception):
    """Raised when an administrator targets a user that does not exist."""


class AdminUserAlreadyExistsError(Exception):
    """Raised when an email address or canonical username is already used."""


class AdminUserProtectedActionError(Exception):
    """Raised when an action would leave the application without an admin."""


@dataclass
class UserDeletionImpact:
    """What deleting a user removes, for confirming the deletion."""

    user_id: uuid.UUID
    deleted_trip_count: int
    deleted_shared_trip_count: int
    remaining_post_count: int
    comments_on_remaining_posts_count: int
    likes_on_remaining_posts_count: int
    remaining_track_count: int
    remaining_media_count: int
    photos_in_others_posts_count: int
    deleted_comment_count: int
    deleted_reply_count: int


class AdminUserService:
    """Performs privileged user-account administration."""

    def __init__(self, db: Session) -> None:
        self.db = db

    def create_user(self, payload: AdminUserCreateRequest) -> User:
        email = str(payload.email).lower()
        if self._email_exists(email) or self._username_exists(payload.username):
            raise AdminUserAlreadyExistsError('Email or username already exists')

        user = User(
            email=email,
            password_hash=security.get_password_hash(payload.password),
            password_change_required=payload.require_password_change,
            role=payload.role,
        )
        user.profile = UserProfile(
            username=payload.username,
            first_name=payload.first_name,
            last_name=payload.last_name,
            biography='',
        )
        self.db.add(user)
        self._commit_or_raise_duplicate()
        return self._get_user_for_response(user.id)

    def list_users(
        self,
        *,
        offset: int,
        limit: int,
        query: str | None = None,
        role: UserRole | None = None,
    ) -> tuple[list[User], int]:
        filters = []
        if query:
            search_term = f'%{query}%'
            filters.append(
                or_(
                    User.email.ilike(search_term),
                    UserProfile.username.ilike(search_term),
                    UserProfile.first_name.ilike(search_term),
                    UserProfile.last_name.ilike(search_term),
                )
            )
        if role is not None:
            filters.append(User.role == role)

        total = self.db.execute(
            select(func.count())
            .select_from(User)
            .outerjoin(UserProfile)
            .where(*filters)
        ).scalar_one()
        users = list(
            self.db.execute(
                select(User)
                .outerjoin(UserProfile)
                .options(contains_eager(User.profile))
                .where(*filters)
                .order_by(User.email.asc(), User.id.asc())
                .offset(offset)
                .limit(limit)
            )
            .scalars()
            .all()
        )
        return users, total

    def get_user(self, user_id: uuid.UUID) -> User:
        return self._get_user_for_response(user_id)

    def update_user(
        self,
        *,
        user_id: uuid.UUID,
        actor_id: uuid.UUID,
        payload: AdminUserUpdateRequest,
    ) -> User:
        if 'role' in payload.model_fields_set:
            self._lock_admins()
        user = self._get_user_for_response(user_id)
        if 'role' in payload.model_fields_set and payload.role != user.role:
            if user.id == actor_id:
                raise AdminUserProtectedActionError(
                    'Administrators cannot change their own role'
                )
            if (
                user.role == UserRole.ADMIN
                and payload.role != UserRole.ADMIN
                and self._admin_count() <= 1
            ):
                raise AdminUserProtectedActionError(
                    'The last remaining administrator cannot be demoted'
                )
            self._require_actor_is_still_admin(actor_id)

        profile = user.profile
        if profile is None:
            raise AdminUserNotFoundError(f'User profile not found: {user_id}')

        if 'email' in payload.model_fields_set:
            email = str(payload.email).lower() if payload.email is not None else ''
            if self._email_exists(email, exclude_user_id=user.id):
                raise AdminUserAlreadyExistsError('Email already exists')
            user.email = email
        if 'username' in payload.model_fields_set:
            username = payload.username or ''
            if self._username_exists(username, exclude_user_id=user.id):
                raise AdminUserAlreadyExistsError('Username already exists')
            profile.username = username
        if 'first_name' in payload.model_fields_set:
            profile.first_name = payload.first_name or ''
        if 'last_name' in payload.model_fields_set:
            profile.last_name = payload.last_name or ''
        if 'role' in payload.model_fields_set:
            user.role = payload.role or UserRole.USER

        self._commit_or_raise_duplicate()
        return self._get_user_for_response(user.id)

    def set_password(
        self,
        *,
        user_id: uuid.UUID,
        actor_id: uuid.UUID,
        payload: AdminUserPasswordSetRequest,
    ) -> None:
        if user_id == actor_id:
            raise AdminUserProtectedActionError(
                'Use account security to change your own password'
            )

        user = self.db.execute(
            select(User)
            .where(User.id == user_id)
            .with_for_update()
            .execution_options(populate_existing=True)
        ).scalar_one_or_none()
        if user is None:
            raise AdminUserNotFoundError('User not found')

        user.password_hash = security.get_password_hash(payload.password)
        user.password_change_required = payload.require_password_change
        user.auth_version += 1
        self.db.commit()

    def get_deletion_impact(self, user_id: uuid.UUID) -> UserDeletionImpact:
        """Count what deleting ``user_id`` removes, all at the same moment."""
        self._get_user_for_response(user_id)
        deleted_trip_ids = self._trips_deleted_with(user_id).cte('deleted_trips')
        deleted_trips = select(deleted_trip_ids.c.trip_id)
        has_other_people = or_(
            select(TripMember.trip_id)
            .where(TripMember.trip_id == Trip.id, TripMember.user_id != user_id)
            .exists(),
            select(TripViewer.trip_id)
            .where(TripViewer.trip_id == Trip.id, TripViewer.user_id != user_id)
            .exists(),
            select(TripShareLink.id)
            .where(
                TripShareLink.trip_id == Trip.id,
                TripShareLink.revoked_at.is_(None),
                or_(
                    TripShareLink.expires_at.is_(None),
                    TripShareLink.expires_at > func.now(),
                ),
            )
            .exists(),
        )
        comment_threads = self._comment_threads_of(user_id, deleted_trips)
        counts = self._count_together(
            deleted_trip_count=deleted_trips,
            deleted_shared_trip_count=select(Trip.id).where(
                Trip.id.in_(deleted_trips), has_other_people
            ),
            remaining_post_count=select(Post.id).where(
                Post.author_user_id == user_id, Post.trip_id.not_in(deleted_trips)
            ),
            comments_on_remaining_posts_count=select(PostComment.id)
            .join(Post, Post.id == PostComment.post_id)
            .where(
                Post.author_user_id == user_id,
                Post.trip_id.not_in(deleted_trips),
                PostComment.user_id.is_distinct_from(user_id),
                PostComment.id.not_in(select(comment_threads.c.id)),
            ),
            likes_on_remaining_posts_count=select(PostLike.id)
            .join(Post, Post.id == PostLike.post_id)
            .where(
                Post.author_user_id == user_id,
                Post.trip_id.not_in(deleted_trips),
                PostLike.user_id.is_distinct_from(user_id),
            ),
            remaining_track_count=select(GpsTrackingSession.id).where(
                GpsTrackingSession.recorded_by_user_id == user_id,
                GpsTrackingSession.deleted_at.is_(None),
                GpsTrackingSession.trip_id.not_in(deleted_trips),
            ),
            # Uploads in deleted trips go anyway, so only these depend on the choice.
            remaining_media_count=select(Media.id).where(
                Media.created_by == user_id,
                or_(
                    select(PostMedia.id)
                    .join(Post, Post.id == PostMedia.post_id)
                    .where(
                        PostMedia.media_id == Media.id,
                        Post.trip_id.not_in(deleted_trips),
                    )
                    .exists(),
                    select(Trip.id)
                    .where(
                        Trip.cover_media_id == Media.id,
                        Trip.id.not_in(deleted_trips),
                    )
                    .exists(),
                ),
            ),
            photos_in_others_posts_count=select(Media.id)
            .distinct()
            .join(PostMedia, PostMedia.media_id == Media.id)
            .join(Post, Post.id == PostMedia.post_id)
            .where(
                Media.created_by == user_id,
                Post.author_user_id.is_distinct_from(user_id),
                Post.trip_id.not_in(deleted_trips),
            ),
            deleted_comment_count=select(PostComment.id)
            .join(Post, Post.id == PostComment.post_id)
            .where(
                PostComment.user_id == user_id,
                Post.trip_id.not_in(deleted_trips),
            ),
            deleted_reply_count=select(PostComment.id).where(
                PostComment.id.in_(select(comment_threads.c.id)),
                PostComment.user_id.is_distinct_from(user_id),
            ),
        )
        return UserDeletionImpact(user_id=user_id, **counts)

    def delete_user(
        self,
        *,
        user_id: uuid.UUID,
        actor_id: uuid.UUID,
        delete_content: bool = False,
        expected_deleted_trip_count: int | None = None,
    ) -> list[uuid.UUID]:
        """Delete a user and every trip that has no other owner.

        Trips with another owner stay without the user. Posts, photos and GPS
        tracks the user added there are kept with a null creator, unless
        ``delete_content`` asks to delete them as well. Recordings still open
        are closed, since nobody else can finish them. Comments always go,
        together with every reply under them, including other people's.

        Returns:
            The media the user uploaded. Files can't be rolled back, so the
            caller removes them after this has committed, skipping what is
            still used in a trip that stays.

        Raises:
            AdminUserNotFoundError: The user does not exist.
            AdminUserProtectedActionError: The deletion would remove the
                actor's own account or the last administrator, the actor
                lost administrator access while waiting for the lock, or it
                would delete another number of trips than
                ``expected_deleted_trip_count``.
        """
        # Admins first, always in id order, so two admins deleting each other
        # wait for one another and the second sees the first one's result.
        self._lock_admins()
        user = self.db.execute(
            select(User)
            .where(User.id == user_id)
            .execution_options(populate_existing=True)
        ).scalar_one_or_none()
        if user is None:
            raise AdminUserNotFoundError('User not found')
        if user.id == actor_id:
            raise AdminUserProtectedActionError(
                'Administrators cannot delete their own account'
            )
        if user.role == UserRole.ADMIN and self._admin_count() <= 1:
            raise AdminUserProtectedActionError(
                'The last remaining administrator cannot be deleted'
            )
        self._require_actor_is_still_admin(actor_id)

        # Nobody can become a co-owner of a trip while it is being deleted.
        # Trips before the user: other writers lock a trip and then reference
        # the user, so the opposite order could deadlock with them.
        self._lock_affected_trips(user_id)
        self.db.execute(
            select(User.id).where(User.id == user_id).with_for_update()
        ).scalar_one()
        uploaded_media_ids = list(
            self.db.scalars(select(Media.id).where(Media.created_by == user_id))
        )
        trips = self.db.scalars(
            select(Trip).where(Trip.id.in_(self._trips_deleted_with(user_id)))
        ).all()
        if (
            expected_deleted_trip_count is not None
            and expected_deleted_trip_count != len(trips)
        ):
            raise AdminUserProtectedActionError(
                'The trips that go with this user have changed. '
                'Check them again before deleting.'
            )
        for trip in trips:
            self.db.delete(trip)
        self.db.flush()
        if delete_content:
            self._delete_content(user_id, uploaded_media_ids)
        else:
            GpsTrackingService(
                self.db, GpsPrivacyZoneService(self.db)
            ).close_open_sessions_of_recorder(user_id)

        from services.planning_cleanup import clear_account_flight_snapshots
        clear_account_flight_snapshots(self.db, user_id)
        self.db.delete(user)
        self.db.commit()
        return uploaded_media_ids

    @staticmethod
    def _trips_deleted_with(user_id: uuid.UUID) -> Select[tuple[uuid.UUID]]:
        """Trips the user owns without another owner to keep them."""
        other_owners = select(TripMember.trip_id).where(
            TripMember.role == TripRole.OWNER, TripMember.user_id != user_id
        )
        return select(TripMember.trip_id).where(
            TripMember.user_id == user_id,
            TripMember.role == TripRole.OWNER,
            TripMember.trip_id.not_in(other_owners),
        )

    @staticmethod
    def _comment_threads_of(user_id: uuid.UUID, deleted_trips: Select) -> CTE:
        """The user's comments in trips that stay, and every reply under them."""
        threads = (
            select(PostComment.id)
            .join(Post, Post.id == PostComment.post_id)
            .where(PostComment.user_id == user_id, Post.trip_id.not_in(deleted_trips))
            .cte(name='deleted_comment_threads', recursive=True)
        )
        return threads.union_all(
            select(PostComment.id).join(
                threads, PostComment.parent_comment_id == threads.c.id
            )
        )

    def _delete_content(
        self, user_id: uuid.UUID, uploaded_media_ids: list[uuid.UUID]
    ) -> None:
        """Delete what the user added to trips that stay.

        Itinerary stops stay, because they are shared plans and removing one
        leaves a gap in other people's trips. Deleting a post takes the comments
        and likes on it along, including other people's. The caller removes the
        uploaded media themselves after committing.
        """
        posts = self.db.scalars(
            select(Post).where(Post.author_user_id == user_id)
        ).all()
        for post in posts:
            self.db.delete(post)
        self.db.flush()
        self._remove_from_other_posts(uploaded_media_ids)
        self.db.execute(
            update(Trip)
            .where(Trip.cover_media_id.in_(uploaded_media_ids))
            .values(cover_media_id=None)
        )

        self.db.execute(
            delete(GpsTrackingSession).where(
                GpsTrackingSession.recorded_by_user_id == user_id
            )
        )
        self.db.flush()

    def _remove_from_other_posts(self, media_ids: list[uuid.UUID]) -> None:
        """Take these media out of the posts of other people."""
        posts = self.db.scalars(
            select(Post)
            .where(
                Post.id.in_(
                    select(PostMedia.post_id).where(PostMedia.media_id.in_(media_ids))
                )
            )
            .with_for_update()
        ).all()
        removed = set(media_ids)
        for post in posts:
            kept = [
                link.media_id for link in post.media_links if link.media_id not in removed
            ]
            post.bubble_media_id = keep_bubble_media_id(kept, post.bubble_media_id)
            for link in post.media_links:
                if link.media_id in removed:
                    self.db.delete(link)
            post.revision += 1
        self.db.flush()

    def _count_together(self, **statements: Select) -> dict[str, int]:
        """Count the rows of each statement in one query, by keyword name."""
        counts = [
            select(func.count())
            .select_from(statement.subquery())
            .scalar_subquery()
            .label(name)
            for name, statement in statements.items()
        ]
        return self.db.execute(select(*counts)).one()._asdict()

    def _lock_admins(self) -> None:
        """Lock administrators, so a check of how many remain stays true.

        This uses ``FOR NO KEY UPDATE``, which still makes these checks wait for
        each other but lets other requests insert rows referencing an admin.
        """
        self.db.execute(
            select(User.id)
            .where(User.role == UserRole.ADMIN)
            .order_by(User.id)
            .with_for_update(key_share=True)
        ).all()

    def _require_actor_is_still_admin(self, actor_id: uuid.UUID) -> None:
        """Refuse a request whose actor was removed or demoted while it waited.

        The caller holds the admin locks.
        """
        role = self.db.scalar(select(User.role).where(User.id == actor_id))
        if role != UserRole.ADMIN:
            raise AdminUserProtectedActionError(
                'Your administrator access was removed'
            )

    def _lock_affected_trips(self, user_id: uuid.UUID) -> None:
        """Lock the trips the user is in or recorded in.

        Member changes and sample uploads wait for this lock, so neither can
        slip in between deciding what to delete and deleting it. That includes
        trips the user has left, which can still hold their recordings.

        This uses ``FOR NO KEY UPDATE``, so a request that holds a post can still
        insert rows referencing its trip and finish, instead of deadlocking
        with this deletion waiting for that post.
        """
        self.db.execute(
            select(Trip.id)
            .where(
                or_(
                    Trip.id.in_(
                        select(TripMember.trip_id).where(TripMember.user_id == user_id)
                    ),
                    Trip.id.in_(
                        select(GpsTrackingSession.trip_id).where(
                            GpsTrackingSession.recorded_by_user_id == user_id
                        )
                    ),
                )
            )
            .order_by(Trip.id)
            .with_for_update(key_share=True)
        ).all()

    def _get_user_for_response(self, user_id: uuid.UUID) -> User:
        user = self.db.execute(
            select(User).options(joinedload(User.profile)).where(User.id == user_id)
        ).scalar_one_or_none()
        if user is None:
            raise AdminUserNotFoundError('User not found')
        return user

    def _admin_count(self) -> int:
        return self.db.execute(
            select(func.count()).select_from(User).where(User.role == UserRole.ADMIN)
        ).scalar_one()

    def _email_exists(
        self, email: str, *, exclude_user_id: uuid.UUID | None = None
    ) -> bool:
        statement = select(User.id).where(User.email == email)
        if exclude_user_id is not None:
            statement = statement.where(User.id != exclude_user_id)
        return self.db.execute(statement.limit(1)).first() is not None

    def _username_exists(
        self,
        username: str,
        *,
        exclude_user_id: uuid.UUID | None = None,
    ) -> bool:
        statement = select(UserProfile.user_id).where(
            canonical_username_expression(UserProfile.username)
            == canonicalize_username(username)
        )
        if exclude_user_id is not None:
            statement = statement.where(UserProfile.user_id != exclude_user_id)
        return self.db.execute(statement.limit(1)).first() is not None

    def _commit_or_raise_duplicate(self) -> None:
        try:
            self.db.commit()
        except IntegrityError as exc:
            self.db.rollback()
            raise AdminUserAlreadyExistsError(
                'Email or username already exists'
            ) from exc
