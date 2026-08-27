import typing
import uuid
from datetime import datetime
from enum import Enum

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    false,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .base import Base, utcnow

if typing.TYPE_CHECKING:
    from .media import Media
    from .trips import TripMember
    from .user_preferences import UserPreferences


USER_PROFILE_USERNAME_INDEX_NAME = 'ix_user_profiles_username'


def canonical_username_expression(username_column):
    return func.lower(func.regexp_replace(username_column, '[-._]', '', 'g'))


class UserRole(str, Enum):
    USER = 'USER'
    COMPANION = 'COMPANION'
    ADMIN = 'ADMIN'


class User(Base):
    __tablename__ = 'users'
    __table_args__ = (
        CheckConstraint('auth_version >= 0', name='ck_users_auth_version_nonnegative'),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        primary_key=True,
        default=uuid.uuid4,
    )

    email: Mapped[str] = mapped_column(
        String(320),
        unique=True,
        index=True,
        nullable=False,
    )

    password_hash: Mapped[str] = mapped_column(
        String(255),
        nullable=False,
    )

    password_change_required: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        default=False,
        server_default=false(),
    )

    auth_version: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        default=0,
        server_default='0',
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=utcnow,
        server_default=func.now(),
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=utcnow,
        onupdate=utcnow,
        server_default=func.now(),
    )
    role: Mapped[UserRole] = mapped_column(
        String(255),
        nullable=False,
        default=UserRole.USER,
        server_default=UserRole.USER.value,
    )

    # Relationships
    profile: Mapped['UserProfile'] = relationship(
        'UserProfile',
        back_populates='user',
        cascade='all, delete-orphan',
        uselist=False,
    )
    trip_memberships: Mapped[list['TripMember']] = relationship(
        'TripMember',
        back_populates='user',
        cascade='all, delete-orphan',
    )
    media: Mapped[list['Media']] = relationship(
        'Media',
        back_populates='creator',
    )
    preferences: Mapped['UserPreferences | None'] = relationship(
        'UserPreferences',
        back_populates='user',
        cascade='all, delete-orphan',
        uselist=False,
    )


class UserProfile(Base):
    __tablename__ = 'user_profiles'

    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey(
            'users.id',
            ondelete='CASCADE',
            name='fk_user_profiles_user_id',
        ),
        primary_key=True,
    )
    username: Mapped[str] = mapped_column(
        String(255),
        nullable=False,
    )
    first_name: Mapped[str] = mapped_column(
        String(255),
        nullable=False,
    )
    last_name: Mapped[str] = mapped_column(
        String(255),
        nullable=False,
    )
    profile_picture_media_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey(
            'media.id',
            ondelete='SET NULL',
            name='fk_user_profiles_profile_picture_media_id',
        ),
        nullable=True,
        index=True,
    )
    biography: Mapped[str] = mapped_column(
        String(2048),
        nullable=False,
        default='',
        server_default='',
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=utcnow,
        onupdate=utcnow,
        server_default=func.now(),
    )

    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=utcnow,
        onupdate=utcnow,
        server_default=func.now(),
    )

    # Relationships
    user: Mapped['User'] = relationship(
        'User',
        back_populates='profile',
    )
    profile_picture: Mapped['Media'] = relationship(
        'Media',
    )


user_profile_username_index = Index(
    USER_PROFILE_USERNAME_INDEX_NAME,
    canonical_username_expression(UserProfile.username),
    unique=True,
)
