import uuid

from sqlalchemy import func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, contains_eager, joinedload

from core import security
from models.api.users import (
    PasswordChangeRequest,
    UserProfileUpdateRequest,
    canonicalize_username,
)
from models.database.media import Media, MediaType
from models.database.user import User, UserProfile, canonical_username_expression


class ProfilePictureNotFoundError(Exception):
    """Raised when a requested profile picture media row cannot be found."""


class ProfilePictureOwnershipError(Exception):
    """Raised when a user tries to use media they do not own as an avatar."""


class ProfilePictureMediaTypeError(Exception):
    """Raised when a profile picture media row is not an image."""


class UserNotFoundError(Exception):
    """Raised when a user cannot be found."""


class UsernameAlreadyExistsError(Exception):
    """Raised when a profile username is already used by another user."""


class CurrentPasswordIncorrectError(Exception):
    """Raised when a password change supplies the wrong current password."""


class NewPasswordMatchesCurrentError(Exception):
    """Raised when a password change would keep the existing password."""


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
        """Search users by exact email or partial profile fields.

        Args:
            query: Exact email or case-insensitive partial profile text.
            offset: Number of matching rows to skip.
            limit: Maximum number of users to return.
            exclude_user_id: Optional user id to exclude from the results.

        Returns:
            A tuple containing the current page of users and total match count.
        """
        normalized_query = query.strip()
        if not normalized_query:
            return [], 0

        filters = [
            or_(
                func.lower(User.email) == normalized_query.casefold(),
                UserProfile.username.icontains(normalized_query, autoescape=True),
                UserProfile.first_name.icontains(normalized_query, autoescape=True),
                UserProfile.last_name.icontains(normalized_query, autoescape=True),
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
            .options(
                contains_eager(User.profile).joinedload(UserProfile.profile_picture)
            )
            .where(*filters)
            .order_by(User.email.asc(), User.id.asc())
            .offset(offset)
            .limit(limit)
        )

        total = self.db.execute(total_statement).scalar_one()
        users = list(self.db.execute(statement).scalars().all())

        return users, total

    def get_user_by_id(self, user_id: uuid.UUID) -> User:
        """Return a user by UUID.

        Args:
            user_id: User id.

        Returns:
            The matching user with profile and avatar loaded.

        Raises:
            UserNotFoundError: No user exists for the supplied id.
        """
        user = self._get_user_for_response(user_id)
        if user is None:
            raise UserNotFoundError(f'User not found: {user_id}')
        return user

    def get_user_by_username(self, username: str) -> User:
        """Return a user by canonical username.

        Args:
            username: Profile username. Matching ignores case and separators.

        Returns:
            The matching user with profile and avatar loaded.

        Raises:
            UserNotFoundError: No user exists for the supplied username.
        """
        statement = (
            select(User)
            .join(UserProfile)
            .options(
                contains_eager(User.profile).joinedload(UserProfile.profile_picture)
            )
            .where(
                canonical_username_expression(UserProfile.username)
                == canonicalize_username(username)
            )
        )
        user = self.db.execute(statement).scalar_one_or_none()

        if user is None:
            raise UserNotFoundError(f'User not found: {username}')
        return user

    def is_username_available(
        self,
        *,
        username: str,
        exclude_user_id: uuid.UUID | None = None,
    ) -> bool:
        """Return whether a canonical username is available.

        Args:
            username: Candidate profile username.
            exclude_user_id: Optional user id to ignore, usually the current user.

        Returns:
            True when no other profile has the same canonical username.
        """
        filters = [
            canonical_username_expression(UserProfile.username)
            == canonicalize_username(username)
        ]
        if exclude_user_id is not None:
            filters.append(UserProfile.user_id != exclude_user_id)

        statement = select(UserProfile.user_id).where(*filters).limit(1)
        return self.db.execute(statement).first() is None

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
            UsernameAlreadyExistsError: The requested username is already used.
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

        attempted_username = profile.username
        with self.db.no_autoflush:
            if not self.is_username_available(
                username=attempted_username,
                exclude_user_id=user.id,
            ):
                raise UsernameAlreadyExistsError(
                    f'Username already exists: {attempted_username}'
                )

        try:
            self.db.commit()
        except IntegrityError as exc:
            self.db.rollback()
            if _is_unique_violation(exc, 'ix_user_profiles_username'):
                raise UsernameAlreadyExistsError(
                    f'Username already exists: {attempted_username}'
                ) from exc
            raise

        updated_user = self._get_user_for_response(user.id)
        if updated_user is None:
            raise UserNotFoundError(f'User not found: {user.id}')
        return updated_user

    def change_password(
        self,
        *,
        user_id: uuid.UUID,
        payload: PasswordChangeRequest,
    ) -> User:
        user = self._lock_user(user_id)
        current_is_valid, _ = security.verify_password(
            payload.current_password,
            user.password_hash,
        )
        if not current_is_valid:
            raise CurrentPasswordIncorrectError('Current password is incorrect')

        new_matches_current, _ = security.verify_password(
            payload.new_password,
            user.password_hash,
        )
        if new_matches_current:
            raise NewPasswordMatchesCurrentError(
                'New password must be different from current password'
            )

        user.password_hash = security.get_password_hash(payload.new_password)
        user.password_change_required = False
        user.auth_version += 1
        self.db.commit()
        self.db.refresh(user)
        return user

    def sign_out_all(self, *, user_id: uuid.UUID) -> None:
        user = self._lock_user(user_id)
        user.auth_version += 1
        self.db.commit()

    def _lock_user(self, user_id: uuid.UUID) -> User:
        user = self.db.execute(
            select(User)
            .where(User.id == user_id)
            .with_for_update()
            .execution_options(populate_existing=True)
        ).scalar_one_or_none()
        if user is None:
            raise UserNotFoundError(f'User not found: {user_id}')
        return user

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

    def _get_user_for_response(self, user_id: uuid.UUID) -> User | None:
        return self.db.execute(
            select(User)
            .options(joinedload(User.profile).joinedload(UserProfile.profile_picture))
            .where(User.id == user_id)
        ).scalar_one_or_none()


def _default_username(user: User) -> str:
    return user.email.split('@', maxsplit=1)[0] or f'user-{user.id.hex[:8]}'


def _is_unique_violation(exc: IntegrityError, constraint_name: str) -> bool:
    original = exc.orig
    diagnostics = getattr(original, 'diag', None)
    if getattr(diagnostics, 'constraint_name', None) == constraint_name:
        return True
    return constraint_name in str(original)
