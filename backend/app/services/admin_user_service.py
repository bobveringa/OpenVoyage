import uuid

from sqlalchemy import func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, contains_eager, joinedload

from core import security
from models.api.admin import AdminUserCreateRequest, AdminUserUpdateRequest
from models.api.users import canonicalize_username
from models.database.user import (
    User,
    UserProfile,
    UserRole,
    canonical_username_expression,
)


class AdminUserNotFoundError(Exception):
    """Raised when an administrator targets a user that does not exist."""


class AdminUserAlreadyExistsError(Exception):
    """Raised when an email address or canonical username is already used."""


class AdminUserProtectedActionError(Exception):
    """Raised when an action would leave the application without an admin."""


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

        profile = user.profile
        if profile is None:
            raise AdminUserNotFoundError(f'User profile not found: {user_id}')

        if 'email' in payload.model_fields_set:
            email = str(payload.email).lower() if payload.email is not None else ''
            if self._email_exists(email, exclude_user_id=user.id):
                raise AdminUserAlreadyExistsError('Email already exists')
            user.email = email
        if 'password' in payload.model_fields_set:
            user.password_hash = security.get_password_hash(payload.password or '')
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

    def delete_user(self, *, user_id: uuid.UUID, actor_id: uuid.UUID) -> None:
        user = self._get_user_for_response(user_id)
        if user.id == actor_id:
            raise AdminUserProtectedActionError(
                'Administrators cannot delete their own account'
            )
        if user.role == UserRole.ADMIN and self._admin_count() <= 1:
            raise AdminUserProtectedActionError(
                'The last remaining administrator cannot be deleted'
            )
        self.db.delete(user)
        self.db.commit()

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
