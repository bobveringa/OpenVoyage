import uuid

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session, contains_eager, joinedload

from models.api.users import UserProfileUpdateRequest
from models.database.media import Media, MediaType
from models.database.user import User, UserProfile


class ProfilePictureNotFoundError(Exception):
    """Raised when a requested profile picture media row cannot be found."""


class ProfilePictureOwnershipError(Exception):
    """Raised when a user tries to use media they do not own as an avatar."""


class ProfilePictureMediaTypeError(Exception):
    """Raised when a profile picture media row is not an image."""


class UserService:
    """Provides user lookup behavior for authenticated API workflows.

    Args:
        db: SQLAlchemy session used for user/profile queries.
    """

    def __init__(self, db: Session) -> None:
        """Initialize the service.

        Args:
            db: SQLAlchemy session used for database reads.
        """
        self.db = db

    def search_users(
        self,
        *,
        query: str,
        offset: int,
        limit: int,
        exclude_user_id: uuid.UUID | None = None,
    ) -> tuple[list[User], int]:
        """Search users by email/profile fields and return a page plus total.

        Args:
            query: Case-insensitive text matched against email and profile fields.
            offset: Number of matching rows to skip.
            limit: Maximum number of users to return.
            exclude_user_id: Optional user id to exclude from the results.

        Returns:
            A tuple containing the current page of users and total match count.
        """
        search_term = f'%{query}%'
        filters = [
            or_(
                User.email.ilike(search_term),
                UserProfile.username.ilike(search_term),
                UserProfile.first_name.ilike(search_term),
                UserProfile.last_name.ilike(search_term),
            )
        ]
        if exclude_user_id is not None:
            filters.append(User.id != exclude_user_id)

        total_statement = (
            select(func.count())
            .select_from(User)
            .outerjoin(UserProfile)
            .where(*filters)
        )
        statement = (
            select(User)
            .select_from(User)
            .outerjoin(UserProfile)
            .options(contains_eager(User.profile))
            .where(*filters)
            .order_by(User.email.asc(), User.id.asc())
            .offset(offset)
            .limit(limit)
        )

        total = self.db.execute(total_statement).scalar_one()
        users = list(self.db.execute(statement).scalars().all())

        return users, total

    def update_profile(
        self,
        *,
        user: User,
        payload: UserProfileUpdateRequest,
    ) -> User:
        """Update the authenticated user's profile details and avatar.

        Args:
            user: Authenticated user whose profile should be updated.
            payload: Partial profile update payload.

        Returns:
            The updated user with profile and profile picture loaded.

        Raises:
            ProfilePictureNotFoundError: The requested media row does not exist.
            ProfilePictureOwnershipError: The requested media is not owned by user.
            ProfilePictureMediaTypeError: The requested media is not an image.
        """
        profile = user.profile
        if profile is None:
            profile = UserProfile(
                user_id=user.id,
                username=payload.username or _default_username(user),
                first_name=payload.first_name or '',
                last_name=payload.last_name or '',
                profile_picture_media_id=None,
                biography=payload.biography or '',
            )
            self.db.add(profile)

        if payload.username is not None:
            profile.username = payload.username
        if payload.first_name is not None:
            profile.first_name = payload.first_name
        if payload.last_name is not None:
            profile.last_name = payload.last_name
        if payload.biography is not None:
            profile.biography = payload.biography
        if 'profile_picture_media_id' in payload.model_fields_set:
            profile.profile_picture_media_id = self._validate_profile_picture(
                media_id=payload.profile_picture_media_id,
                current_user_id=user.id,
            )

        self.db.commit()
        return self._get_user_for_response(user.id)

    def _validate_profile_picture(
        self,
        *,
        media_id: uuid.UUID | None,
        current_user_id: uuid.UUID,
    ) -> uuid.UUID | None:
        if media_id is None:
            return None

        media = self.db.get(Media, media_id)
        if media is None:
            raise ProfilePictureNotFoundError(f'Media not found: {media_id}')
        if media.created_by != current_user_id:
            raise ProfilePictureOwnershipError(
                'The selected media is not owned by the user'
            )

        media_type = (
            media.media_type.value
            if isinstance(media.media_type, MediaType)
            else str(media.media_type).upper()
        )
        if media_type != MediaType.IMAGE.value:
            raise ProfilePictureMediaTypeError('Profile picture media must be an image')

        return media.id

    def _get_user_for_response(self, user_id: uuid.UUID) -> User:
        return self.db.execute(
            select(User)
            .options(joinedload(User.profile).joinedload(UserProfile.profile_picture))
            .where(User.id == user_id)
        ).scalar_one()


def _default_username(user: User) -> str:
    return user.email.split('@', maxsplit=1)[0] or f'user-{user.id.hex[:8]}'
