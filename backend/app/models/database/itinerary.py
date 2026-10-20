import typing
import uuid
from datetime import date, datetime

from sqlalchemy import (
    BigInteger,
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
    text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .base import Base, utcnow

if typing.TYPE_CHECKING:
    from .locations import Location
    from .trips import Trip
    from .user import User


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
        UniqueConstraint('trip_id', 'id'),
        ForeignKeyConstraint(
            ['trip_id', 'from_stop_id'],
            ['itinerary_stops.trip_id', 'itinerary_stops.id'],
            ondelete='CASCADE',
        ),
        ForeignKeyConstraint(
            ['trip_id', 'to_stop_id'],
            ['itinerary_stops.trip_id', 'itinerary_stops.id'],
            ondelete='CASCADE',
        ),
        UniqueConstraint(
            'trip_id', 'from_stop_id', name='uq_itinerary_travel_legs_trip_from_stop_id'
        ),
        UniqueConstraint(
            'trip_id', 'to_stop_id', name='uq_itinerary_travel_legs_trip_to_stop_id'
        ),
        CheckConstraint(
            'from_stop_id IS NULL OR to_stop_id IS NULL OR from_stop_id <> to_stop_id',
            name='ck_itinerary_travel_legs_distinct_stops',
        ),
        CheckConstraint(
            '(from_stop_id IS NOT NULL) <> (from_location_id IS NOT NULL)',
            name='ck_itinerary_legs_from_endpoint',
        ),
        CheckConstraint(
            '(to_stop_id IS NOT NULL) <> (to_location_id IS NOT NULL)',
            name='ck_itinerary_legs_to_endpoint',
        ),
        CheckConstraint(
            'from_stop_id IS NOT NULL OR to_stop_id IS NOT NULL',
            name='ck_itinerary_legs_stop_endpoint',
        ),
        *(
            ForeignKeyConstraint(
                ['trip_id', key],
                ['locations.trip_id', 'locations.id'],
                name=f'fk_itinerary_legs_trip_{key}',
            )
            for key in ('from_location_id', 'to_location_id')
        ),
        Index(
            'uq_itinerary_legs_departure',
            'trip_id',
            unique=True,
            postgresql_where=text('from_stop_id IS NULL'),
        ),
        Index(
            'uq_itinerary_legs_return',
            'trip_id',
            unique=True,
            postgresql_where=text('to_stop_id IS NULL'),
        ),
    )
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    trip_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey('trips.id', ondelete='CASCADE')
    )
    from_stop_id: Mapped[uuid.UUID | None]
    to_stop_id: Mapped[uuid.UUID | None]
    from_location_id: Mapped[uuid.UUID | None]
    to_location_id: Mapped[uuid.UUID | None]
    notes: Mapped[str] = mapped_column(Text, default='', server_default='')
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utcnow,
        onupdate=utcnow,
        server_default=func.now(),
    )
    from_stop: Mapped['ItineraryStop | None'] = relationship(
        primaryjoin='and_(ItineraryTravelLeg.trip_id == ItineraryStop.trip_id, ItineraryTravelLeg.from_stop_id == ItineraryStop.id)',
        foreign_keys='[ItineraryTravelLeg.trip_id, ItineraryTravelLeg.from_stop_id]',
        viewonly=True,
    )
    to_stop: Mapped['ItineraryStop | None'] = relationship(
        primaryjoin='and_(ItineraryTravelLeg.trip_id == ItineraryStop.trip_id, ItineraryTravelLeg.to_stop_id == ItineraryStop.id)',
        foreign_keys='[ItineraryTravelLeg.trip_id, ItineraryTravelLeg.to_stop_id]',
        viewonly=True,
    )
    from_location: Mapped['Location | None'] = relationship(
        primaryjoin='and_(ItineraryTravelLeg.trip_id == Location.trip_id, ItineraryTravelLeg.from_location_id == Location.id)',
        foreign_keys='[ItineraryTravelLeg.trip_id, ItineraryTravelLeg.from_location_id]',
        viewonly=True,
    )
    to_location: Mapped['Location | None'] = relationship(
        primaryjoin='and_(ItineraryTravelLeg.trip_id == Location.trip_id, ItineraryTravelLeg.to_location_id == Location.id)',
        foreign_keys='[ItineraryTravelLeg.trip_id, ItineraryTravelLeg.to_location_id]',
        viewonly=True,
    )

    @property
    def connection_type(self):
        if self.from_stop_id is None:
            return 'DEPARTURE'
        if self.to_stop_id is None:
            return 'RETURN'
        return 'BETWEEN_STOPS'

    segments: Mapped[list['ItineraryTravelSegment']] = relationship(
        cascade='all, delete-orphan',
        passive_deletes=True,
        order_by='ItineraryTravelSegment.position',
        foreign_keys='[ItineraryTravelSegment.trip_id, ItineraryTravelSegment.leg_id]',
    )


class ItineraryTravelSegment(Base):
    __tablename__ = 'itinerary_travel_segments'
    __table_args__ = (
        UniqueConstraint('trip_id', 'id'),
        UniqueConstraint('leg_id', 'position', deferrable=True, initially='DEFERRED'),
        ForeignKeyConstraint(
            ['trip_id', 'leg_id'],
            ['itinerary_travel_legs.trip_id', 'itinerary_travel_legs.id'],
            ondelete='CASCADE',
        ),
        *(
            ForeignKeyConstraint(
                ['trip_id', key], ['locations.trip_id', 'locations.id']
            )
            for key in ('from_location_id', 'to_location_id', 'via_location_id')
        ),
        CheckConstraint('position >= 0 AND input_version >= 1'),
        CheckConstraint("mode_source IN ('AUTO', 'USER')"),
        CheckConstraint(
            "via_location_id IS NULL OR travel_mode IN ('CAR', 'BIKE', 'WALK')"
        ),
    )
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    trip_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey('trips.id', ondelete='CASCADE')
    )
    leg_id: Mapped[uuid.UUID] = mapped_column(index=True)
    position: Mapped[int]
    travel_mode: Mapped[str] = mapped_column(String(32))
    mode_source: Mapped[str] = mapped_column(String(8), default='USER')
    notes: Mapped[str] = mapped_column(Text, default='')
    service_company: Mapped[str | None] = mapped_column(String(255))
    service_number: Mapped[str | None] = mapped_column(String(255))
    from_location_id: Mapped[uuid.UUID | None] = mapped_column(index=True)
    to_location_id: Mapped[uuid.UUID | None] = mapped_column(index=True)
    via_location_id: Mapped[uuid.UUID | None] = mapped_column(index=True)
    input_version: Mapped[int] = mapped_column(
        BigInteger, default=1, server_default='1'
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utcnow,
        onupdate=utcnow,
        server_default=func.now(),
    )
    flight: Mapped['ItinerarySegmentFlight | None'] = relationship(
        cascade='all, delete-orphan',
        passive_deletes=True,
        foreign_keys='[ItinerarySegmentFlight.trip_id, ItinerarySegmentFlight.segment_id]',
    )
    route: Mapped['ItinerarySegmentRoute | None'] = relationship(
        cascade='all, delete-orphan',
        passive_deletes=True,
        foreign_keys='[ItinerarySegmentRoute.trip_id, ItinerarySegmentRoute.segment_id]',
    )


class ItinerarySegmentFlight(Base):
    __tablename__ = 'itinerary_segment_flights'
    __table_args__ = (
        ForeignKeyConstraint(
            ['trip_id', 'segment_id'],
            ['itinerary_travel_segments.trip_id', 'itinerary_travel_segments.id'],
            ondelete='CASCADE',
        ),
        CheckConstraint('(lookup IS NULL) = (lookup_owner_user_id IS NULL)'),
    )
    segment_id: Mapped[uuid.UUID] = mapped_column(primary_key=True)
    trip_id: Mapped[uuid.UUID]
    flight_number: Mapped[str | None] = mapped_column(String(16))
    departure_date: Mapped[date | None] = mapped_column(Date)
    departure_airport_place_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey('places.id', ondelete='RESTRICT'), index=True
    )
    arrival_airport_place_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey('places.id', ondelete='RESTRICT'), index=True
    )
    airline_name: Mapped[str | None] = mapped_column(String(255))
    lookup_owner_user_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey('users.id', ondelete='RESTRICT'), index=True
    )
    lookup: Mapped[dict | None] = mapped_column(JSONB(none_as_null=True))


class ItinerarySegmentRoute(Base):
    __tablename__ = 'itinerary_segment_routes'
    __table_args__ = (
        ForeignKeyConstraint(
            ['trip_id', 'segment_id'],
            ['itinerary_travel_segments.trip_id', 'itinerary_travel_segments.id'],
            ondelete='CASCADE',
        ),
        CheckConstraint("status IN ('READY', 'FAILED', 'UNSUPPORTED')"),
        CheckConstraint(
            "status <> 'READY' OR (geometry_geojson IS NOT NULL AND provider IS NOT NULL)"
        ),
        CheckConstraint('distance_meters IS NULL OR distance_meters >= 0'),
        CheckConstraint('duration_seconds IS NULL OR duration_seconds >= 0'),
    )
    segment_id: Mapped[uuid.UUID] = mapped_column(primary_key=True)
    trip_id: Mapped[uuid.UUID]
    input_version: Mapped[int] = mapped_column(BigInteger)
    input_hash: Mapped[str] = mapped_column(String(64))
    status: Mapped[str] = mapped_column(String(32))
    provider: Mapped[str | None] = mapped_column(String(64))
    geometry_geojson: Mapped[dict | None] = mapped_column(JSONB)
    distance_meters: Mapped[int | None]
    duration_seconds: Mapped[int | None]
    error_code: Mapped[str | None] = mapped_column(String(64))
    generated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, server_default=func.now()
    )


class ItineraryPlanningArtifact(Base):
    __tablename__ = 'itinerary_planning_artifacts'
    __table_args__ = (
        ForeignKeyConstraint(
            ['trip_id', 'leg_id'],
            ['itinerary_travel_legs.trip_id', 'itinerary_travel_legs.id'],
            ondelete='CASCADE',
        ),
        CheckConstraint("kind IN ('FLIGHT_CANDIDATE', 'PREVIEW')"),
        CheckConstraint("(kind = 'PREVIEW') = (itinerary_revision IS NOT NULL)"),
        Index(
            'ix_planning_artifacts_scope',
            'trip_id',
            'created_by_user_id',
            'leg_id',
            'kind',
            'input_hash',
        ),
    )
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    kind: Mapped[str] = mapped_column(String(32))
    trip_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey('trips.id', ondelete='CASCADE')
    )
    leg_id: Mapped[uuid.UUID]
    created_by_user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey('users.id', ondelete='CASCADE')
    )
    itinerary_revision: Mapped[int | None] = mapped_column(BigInteger)
    input_hash: Mapped[str] = mapped_column(String(64))
    payload: Mapped[dict] = mapped_column(JSONB)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, server_default=func.now()
    )
