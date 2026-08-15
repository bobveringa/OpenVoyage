import enum
import typing
import uuid
from datetime import date, datetime

from sqlalchemy import (
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    ForeignKeyConstraint,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .base import Base, utcnow
from .travel import TravelMode

if typing.TYPE_CHECKING:
    from .locations import Location
    from .trips import Trip
    from .user import User


class ItineraryTravelRouteStatus(str, enum.Enum):
    READY = 'READY'
    PENDING = 'PENDING'
    FAILED = 'FAILED'


class ItineraryStop(Base):
    __tablename__ = 'itinerary_stops'
    __table_args__ = (
        UniqueConstraint(
            'trip_id',
            'planned_start_date',
            'same_day_position',
            name='uq_itinerary_stops_trip_date_position',
            deferrable=True,
            initially='DEFERRED',
        ),
        UniqueConstraint('trip_id', 'id', name='uq_itinerary_stops_trip_id_id'),
        ForeignKeyConstraint(
            ['trip_id', 'location_id'],
            ['locations.trip_id', 'locations.id'],
            name='fk_itinerary_stops_trip_location_id',
        ),
        CheckConstraint(
            'same_day_position >= 0',
            name='ck_itinerary_stops_same_day_position_nonnegative',
        ),
        CheckConstraint(
            'planned_nights >= 0',
            name='ck_itinerary_stops_planned_nights_nonnegative',
        ),
        Index(
            'ix_itinerary_stops_trip_date_position',
            'trip_id',
            'planned_start_date',
            'same_day_position',
        ),
        Index('ix_itinerary_stops_trip_location_id', 'trip_id', 'location_id'),
        Index('ix_itinerary_stops_created_by', 'created_by'),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        primary_key=True,
        default=uuid.uuid4,
    )
    trip_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey(
            'trips.id',
            ondelete='CASCADE',
            name='fk_itinerary_stops_trip_id',
        ),
        nullable=False,
    )
    location_id: Mapped[uuid.UUID] = mapped_column(
        nullable=False,
    )
    planned_start_date: Mapped[date] = mapped_column(
        Date,
        nullable=False,
    )
    same_day_position: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
    )
    title: Mapped[str] = mapped_column(
        String(255),
        nullable=False,
    )
    notes: Mapped[str] = mapped_column(
        Text,
        nullable=False,
        default='',
        server_default='',
    )
    planned_nights: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
    )
    created_by: Mapped[uuid.UUID] = mapped_column(
        ForeignKey(
            'users.id',
            name='fk_itinerary_stops_created_by',
        ),
        nullable=False,
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

    trip: Mapped['Trip'] = relationship('Trip')
    location: Mapped['Location'] = relationship(
        'Location',
        primaryjoin=(
            'and_(ItineraryStop.trip_id == Location.trip_id, '
            'ItineraryStop.location_id == Location.id)'
        ),
        foreign_keys='[ItineraryStop.trip_id, ItineraryStop.location_id]',
        viewonly=True,
    )
    creator: Mapped['User'] = relationship('User')


class ItineraryTravelLeg(Base):
    __tablename__ = 'itinerary_travel_legs'
    __table_args__ = (
        ForeignKeyConstraint(
            ['trip_id', 'from_stop_id'],
            ['itinerary_stops.trip_id', 'itinerary_stops.id'],
            name='fk_itinerary_travel_legs_trip_from_stop_id',
            ondelete='CASCADE',
        ),
        ForeignKeyConstraint(
            ['trip_id', 'to_stop_id'],
            ['itinerary_stops.trip_id', 'itinerary_stops.id'],
            name='fk_itinerary_travel_legs_trip_to_stop_id',
            ondelete='CASCADE',
        ),
        UniqueConstraint(
            'trip_id',
            'from_stop_id',
            name='uq_itinerary_travel_legs_trip_from_stop_id',
        ),
        UniqueConstraint(
            'trip_id',
            'to_stop_id',
            name='uq_itinerary_travel_legs_trip_to_stop_id',
        ),
        CheckConstraint(
            'from_stop_id <> to_stop_id',
            name='ck_itinerary_travel_legs_distinct_stops',
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        primary_key=True,
        default=uuid.uuid4,
    )
    trip_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey(
            'trips.id',
            ondelete='CASCADE',
            name='fk_itinerary_travel_legs_trip_id',
        ),
        nullable=False,
    )
    from_stop_id: Mapped[uuid.UUID] = mapped_column(
        nullable=False,
    )
    to_stop_id: Mapped[uuid.UUID] = mapped_column(
        nullable=False,
    )
    travel_mode: Mapped[TravelMode] = mapped_column(
        String(32),
        nullable=False,
        default=TravelMode.UNKNOWN,
        server_default=TravelMode.UNKNOWN.value,
    )
    notes: Mapped[str] = mapped_column(
        Text,
        nullable=False,
        default='',
        server_default='',
    )
    operator: Mapped[str | None] = mapped_column(
        String(255),
        nullable=True,
    )
    reference: Mapped[str | None] = mapped_column(
        String(255),
        nullable=True,
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

    trip: Mapped['Trip'] = relationship('Trip')
    from_stop: Mapped['ItineraryStop'] = relationship(
        'ItineraryStop',
        primaryjoin=(
            'and_(ItineraryTravelLeg.trip_id == ItineraryStop.trip_id, '
            'ItineraryTravelLeg.from_stop_id == ItineraryStop.id)'
        ),
        foreign_keys=('[ItineraryTravelLeg.trip_id, ItineraryTravelLeg.from_stop_id]'),
        viewonly=True,
    )
    to_stop: Mapped['ItineraryStop'] = relationship(
        'ItineraryStop',
        primaryjoin=(
            'and_(ItineraryTravelLeg.trip_id == ItineraryStop.trip_id, '
            'ItineraryTravelLeg.to_stop_id == ItineraryStop.id)'
        ),
        foreign_keys='[ItineraryTravelLeg.trip_id, ItineraryTravelLeg.to_stop_id]',
        viewonly=True,
    )
    route: Mapped['ItineraryTravelLegRoute | None'] = relationship(
        'ItineraryTravelLegRoute',
        back_populates='leg',
        cascade='all, delete-orphan',
        passive_deletes=True,
        uselist=False,
    )


class ItineraryTravelLegRoute(Base):
    __tablename__ = 'itinerary_travel_leg_routes'
    __table_args__ = (
        CheckConstraint(
            "status IN ('READY', 'PENDING', 'FAILED')",
            name='ck_itinerary_travel_leg_routes_status',
        ),
        CheckConstraint(
            "status <> 'READY' OR geometry_geojson IS NOT NULL",
            name='ck_itinerary_travel_leg_routes_ready_geometry',
        ),
        CheckConstraint(
            'attempt_count >= 0',
            name='ck_itinerary_travel_leg_routes_attempt_count_nonnegative',
        ),
        CheckConstraint(
            'distance_meters IS NULL OR distance_meters >= 0',
            name='ck_itinerary_travel_leg_routes_distance_nonnegative',
        ),
        CheckConstraint(
            'duration_seconds IS NULL OR duration_seconds >= 0',
            name='ck_itinerary_travel_leg_routes_duration_nonnegative',
        ),
        Index(
            'ix_itinerary_travel_leg_routes_retry',
            'status',
            'next_retry_at',
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey(
            'itinerary_travel_legs.id',
            ondelete='CASCADE',
            name='fk_itinerary_travel_leg_routes_id',
        ),
        primary_key=True,
    )
    status: Mapped[ItineraryTravelRouteStatus] = mapped_column(
        String(32),
        nullable=False,
    )
    geometry_geojson: Mapped[dict | None] = mapped_column(
        JSONB,
        nullable=True,
    )
    provider: Mapped[str] = mapped_column(
        String(64),
        nullable=False,
    )
    distance_meters: Mapped[int | None] = mapped_column(
        Integer,
        nullable=True,
    )
    duration_seconds: Mapped[int | None] = mapped_column(
        Integer,
        nullable=True,
    )
    attempt_count: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        default=0,
        server_default='0',
    )
    next_retry_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )
    error_code: Mapped[str | None] = mapped_column(
        String(64),
        nullable=True,
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

    leg: Mapped[ItineraryTravelLeg] = relationship(
        'ItineraryTravelLeg',
        back_populates='route',
    )
