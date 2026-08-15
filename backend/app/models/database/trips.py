import enum
import uuid
import typing
from datetime import date, datetime

from sqlalchemy import (
    Boolean,
    Date,
    DateTime,
    ForeignKey,
    Integer,
    String,
    Text,
    func,
)
from sqlalchemy.orm import mapped_column, Mapped, relationship

from .base import Base, utcnow

if typing.TYPE_CHECKING:
    from .user import User
    from .media import Media


class TripVisibility(str, enum.Enum):
    PUBLIC = 'PUBLIC'
    PLATFORM_PUBLIC = 'PLATFORM_PUBLIC'
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
    start_date: Mapped[date] = mapped_column(
        Date,
        nullable=False,
    )
    end_date: Mapped[date | None] = mapped_column(
        Date,
        nullable=True,
    )
    visibility: Mapped[TripVisibility] = mapped_column(
        String(32),
        nullable=False,
        default=TripVisibility.PRIVATE,
        server_default=TripVisibility.PRIVATE.value,
    )
    share_live_location: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        default=False,
        server_default='false',
    )
    itinerary_revision: Mapped[int] = mapped_column(
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
    cover_media_id: Mapped[uuid.UUID | None] = mapped_column(
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
    viewers: Mapped[list['TripViewer']] = relationship(
        'TripViewer',
        back_populates='trip',
        cascade='all, delete-orphan',
    )
    share_links: Mapped[list['TripShareLink']] = relationship(
        'TripShareLink',
        back_populates='trip',
        cascade='all, delete-orphan',
    )

    cover_media: Mapped['Media | None'] = relationship(
        'Media',
        back_populates='covered_trip',
    )


class TripRole(str, enum.Enum):
    OWNER = 'OWNER'
    MEMBER = 'MEMBER'


class TripMember(Base):
    __tablename__ = 'trip_members'

    trip_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey(
            'trips.id',
            ondelete='CASCADE',
            name='fk_trip_members_trip_id',
        ),
        primary_key=True,
        nullable=False,
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey(
            'users.id',
            ondelete='CASCADE',
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


class TripViewer(Base):
    __tablename__ = 'trip_viewers'

    trip_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey(
            'trips.id',
            ondelete='CASCADE',
            name='fk_trip_viewers_trip_id',
        ),
        primary_key=True,
        nullable=False,
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey(
            'users.id',
            ondelete='CASCADE',
            name='fk_trip_viewers_user_id',
        ),
        primary_key=True,
        nullable=False,
    )
    created_by: Mapped[uuid.UUID] = mapped_column(
        ForeignKey(
            'users.id',
            name='fk_trip_viewers_created_by',
        ),
        nullable=False,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=utcnow,
        server_default=func.now(),
    )

    trip: Mapped['Trip'] = relationship(
        'Trip',
        back_populates='viewers',
    )
    user: Mapped['User'] = relationship(
        'User',
        foreign_keys=[user_id],
    )
    creator: Mapped['User'] = relationship(
        'User',
        foreign_keys=[created_by],
    )


class TripShareLink(Base):
    __tablename__ = 'trip_share_links'

    id: Mapped[uuid.UUID] = mapped_column(
        primary_key=True,
        default=uuid.uuid4,
    )
    trip_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey(
            'trips.id',
            ondelete='CASCADE',
            name='fk_trip_share_links_trip_id',
        ),
        nullable=False,
        index=True,
    )
    token_hash: Mapped[str] = mapped_column(
        String(64),
        nullable=False,
        unique=True,
        index=True,
    )
    created_by: Mapped[uuid.UUID] = mapped_column(
        ForeignKey(
            'users.id',
            name='fk_trip_share_links_created_by',
        ),
        nullable=False,
    )
    label: Mapped[str | None] = mapped_column(
        String(255),
        nullable=True,
    )
    expires_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )
    revoked_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=utcnow,
        server_default=func.now(),
    )
    last_used_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )

    trip: Mapped['Trip'] = relationship(
        'Trip',
        back_populates='share_links',
    )
    creator: Mapped['User'] = relationship(
        'User',
        foreign_keys=[created_by],
    )
