import typing
import uuid
from datetime import datetime

from sqlalchemy import DateTime, String, func, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .base import Base, utcnow

if typing.TYPE_CHECKING:
    from .media import Media
    from .trips import TripMember


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

    password_version: Mapped[str] = mapped_column(
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
        ForeignKey('users.id', ondelete='CASCADE'),
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
    profile_picture_media_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey('media.id', ondelete='SET NULL'),
        nullable=True,
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
