import enum
import uuid
import typing
from datetime import datetime

from sqlalchemy import DateTime, String, Text, func, ForeignKey
from sqlalchemy.orm import mapped_column, Mapped, relationship

from .base import Base, utcnow

if typing.TYPE_CHECKING:
    from .user import User


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

    # Relationships
    members: Mapped[list['TripMember']] = relationship(
        'TripMember',
        back_populates='trip',
        cascade='all, delete-orphan',
    )


class TripRole(str, enum.Enum):
    OWNER = 'OWNER'
    MEMBER = 'MEMBER'
    VIEWER = 'VIEWER'


class TripMember(Base):
    __tablename__ = 'trip_members'

    trip_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey('trips.id'),
        primary_key=True,
        nullable=False,
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey('users.id'),
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
