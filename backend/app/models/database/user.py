import typing
import uuid
from datetime import datetime
from enum import Enum

from sqlalchemy import DateTime, String, func, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .base import Base, utcnow

if typing.TYPE_CHECKING:
    from .media import Media
    from .trips import TripMember


class UserRole(Enum):
    USER = 'USER'
    ADMIN = 'ADMIN'


class User(Base):
    __tablename__ = 'users'

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

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=False),
        nullable=False,
        default=utcnow,
        server_default=func.now(),
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=False),
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


class UserProfile(Base):
    __tablename__ = 'user_profiles'

    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey(
            'users.id',
            ondelete='CASCADE',
            name='fk_user_profiles_user_id',
        ),
        primary_key=True,
        name='fk_user_profiles_user_id',
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
    slug: Mapped[str] = mapped_column(
        String(48),
        nullable=False,
        unique=True,
        index=True,
    )
    profile_picture_media_id: Mapped[uuid.UUID] = mapped_column(
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
        DateTime(timezone=False),
        nullable=False,
        default=utcnow,
        onupdate=utcnow,
        server_default=func.now(),
    )

    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=False),
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
