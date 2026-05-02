import enum
import uuid
import typing
from datetime import datetime

from sqlalchemy import DateTime, String, Text, func, ForeignKey
from sqlalchemy.orm import mapped_column, Mapped, relationship

from .base import Base, utcnow

if typing.TYPE_CHECKING:
    from .user import User
    from .media import Media


class TripVisibility(str, enum.Enum):
    PUBLIC = 'PUBLIC'
    PRIVATE = 'PRIVATE'


class Trip(Base):
    __tablename__ = 'trips'

    id: Mapped[uuid.UUID] = mapped_column(
        primary_key=True,
        default=uuid.uuid4,
    )
    name: Mapped[str] = mapped_column(
        String(255),
        nullable=False,
    )
    description: Mapped[str] = mapped_column(
        Text,
        nullable=False,
        default='',
        server_default='',
    )
    visibility: Mapped[TripVisibility] = mapped_column(
        String(32),
        nullable=False,
        default=TripVisibility.PRIVATE,
        server_default=TripVisibility.PRIVATE.value,
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
    cover_media_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey(
            'media.id',
            ondelete='set null',
            name='fk_trips_cover_media_id',
        ),
        nullable=True,
        index=True,
        unique=True,
    )

    # Relationships
    members: Mapped[list['TripMember']] = relationship(
        'TripMember',
        back_populates='trip',
        cascade='all, delete-orphan',
    )

    cover_media: Mapped['Media'] = relationship(
        'Media',
    )


class TripRole(str, enum.Enum):
    OWNER = 'OWNER'
    MEMBER = 'MEMBER'
    VIEWER = 'VIEWER'


class TripMember(Base):
    __tablename__ = 'trip_members'

    trip_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey(
            'trips.id',
            name='fk_trip_members_trip_id',
        ),
        primary_key=True,
        nullable=False,
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey(
            'users.id',
            name='fk_trip_members_user_id',
        ),
        primary_key=True,
        nullable=False,
    )
    role: Mapped[TripRole] = mapped_column(
        String(32),
        nullable=False,
    )

    # Relationship
    trip: Mapped['Trip'] = relationship(
        'Trip',
        back_populates='members',
    )
    user: Mapped['User'] = relationship(
        'User',
        back_populates='trip_memberships',
    )
