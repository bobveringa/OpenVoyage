import typing
import uuid
from datetime import date, datetime, time

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
    Time,
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
            'position',
            name='uq_itinerary_stops_trip_position',
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
            'position >= 0',
            name='ck_itinerary_stops_position_nonnegative',
        ),
        CheckConstraint(
            'planned_nights >= 0',
            name='ck_itinerary_stops_planned_nights_nonnegative',
        ),
        ForeignKeyConstraint(
            ['trip_id', 'original_location_id'],
            ['locations.trip_id', 'locations.id'],
            name='fk_itinerary_stops_trip_original_location_id',
        ),
        Index('ix_itinerary_stops_trip_location_id', 'trip_id', 'location_id'),
        Index(
            'ix_itinerary_stops_trip_original_location_id',
            'trip_id',
            'original_location_id',
        ),
        Index('ix_itinerary_stops_created_by', 'created_by'),
        Index('ix_itinerary_stops_notes_updated_by', 'notes_updated_by'),
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
    # Where the marker is shown. Differs from original_location_id once moved.
    location_id: Mapped[uuid.UUID] = mapped_column(
        nullable=False,
    )
    # The place the stop was created for; the marker may move 25 km from it.
    original_location_id: Mapped[uuid.UUID] = mapped_column(
        nullable=False,
        default=lambda context: context.get_current_parameters()['location_id'],
    )
    planned_start_date: Mapped[date] = mapped_column(
        Date,
        nullable=False,
    )
    # The stop's place in the trip, from 0. Stops are always sorted by it.
    position: Mapped[int] = mapped_column(
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
    # Set only by the notes route, which saves without the itinerary revision.
    notes_updated_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )
    notes_updated_by: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey(
            'users.id',
            ondelete='SET NULL',
            name='fk_itinerary_stops_notes_updated_by',
        ),
        nullable=True,
    )
    planned_nights: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
    )
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey(
            'users.id',
            ondelete='SET NULL',
            name='fk_itinerary_stops_created_by',
        ),
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
    location: Mapped['Location'] = relationship(
        'Location',
        primaryjoin=(
            'and_(ItineraryStop.trip_id == Location.trip_id, '
            'ItineraryStop.location_id == Location.id)'
        ),
        foreign_keys='[ItineraryStop.trip_id, ItineraryStop.location_id]',
        viewonly=True,
    )
    original_location: Mapped['Location'] = relationship(
        'Location',
        primaryjoin=(
            'and_(ItineraryStop.trip_id == Location.trip_id, '
            'ItineraryStop.original_location_id == Location.id)'
        ),
        foreign_keys='[ItineraryStop.trip_id, ItineraryStop.original_location_id]',
        viewonly=True,
    )
    creator: Mapped['User | None'] = relationship(
        'User', foreign_keys='ItineraryStop.created_by'
    )
    stays: Mapped[list['ItineraryStay']] = relationship(
        cascade='all, delete-orphan',
        passive_deletes=True,
        order_by='[ItineraryStay.check_in_date, ItineraryStay.name, ItineraryStay.created_at]',
        foreign_keys='[ItineraryStay.trip_id, ItineraryStay.stop_id]',
    )


STAY_TYPES = ('HOTEL', 'RENTAL', 'HOSTEL', 'CAMPING', 'FRIENDS', 'OVERNIGHT_TRAVEL', 'OTHER')
# Stays you don't book have no status and always count as covered.
STAY_TYPES_WITHOUT_BOOKING = ('FRIENDS', 'OVERNIGHT_TRAVEL')


class ItineraryStay(Base):
    """Where trip members sleep for some of a stop's nights. Members only."""

    __tablename__ = 'itinerary_stays'
    __table_args__ = (
        CheckConstraint(
            "stay_type IN ('HOTEL', 'RENTAL', 'HOSTEL', 'CAMPING', 'FRIENDS', "
            "'OVERNIGHT_TRAVEL', 'OTHER')",
            name='ck_itinerary_stays_stay_type',
        ),
        CheckConstraint(
            "(stay_type IN ('FRIENDS', 'OVERNIGHT_TRAVEL')) = (status IS NULL)",
            name='ck_itinerary_stays_status_needs_booking',
        ),
        CheckConstraint(
            "status IS NULL OR status IN ('IDEA', 'BOOKED')",
            name='ck_itinerary_stays_status',
        ),
        CheckConstraint('check_out_date > check_in_date', name='ck_itinerary_stays_dates'),
        ForeignKeyConstraint(
            ['trip_id', 'stop_id'],
            ['itinerary_stops.trip_id', 'itinerary_stops.id'],
            name='fk_itinerary_stays_trip_stop_id',
            ondelete='CASCADE',
        ),
        ForeignKeyConstraint(
            ['trip_id', 'location_id'],
            ['locations.trip_id', 'locations.id'],
            name='fk_itinerary_stays_trip_location_id',
        ),
        Index('ix_itinerary_stays_trip_stop_id', 'trip_id', 'stop_id'),
        Index('ix_itinerary_stays_trip_location_id', 'trip_id', 'location_id'),
        Index('ix_itinerary_stays_created_by', 'created_by'),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    trip_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey('trips.id', ondelete='CASCADE', name='fk_itinerary_stays_trip_id'),
        nullable=False,
    )
    stop_id: Mapped[uuid.UUID] = mapped_column(nullable=False)
    stay_type: Mapped[str] = mapped_column(String(32), nullable=False)
    status: Mapped[str | None] = mapped_column(String(16), nullable=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    address: Mapped[str | None] = mapped_column(Text, nullable=True)
    location_id: Mapped[uuid.UUID | None] = mapped_column(nullable=True)
    check_in_date: Mapped[date] = mapped_column(Date, nullable=False)
    check_out_date: Mapped[date] = mapped_column(Date, nullable=False)
    check_in_time: Mapped[time | None] = mapped_column(Time, nullable=True)
    check_out_time: Mapped[time | None] = mapped_column(Time, nullable=True)
    booking_reference: Mapped[str | None] = mapped_column(String(255), nullable=True)
    booking_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    contact_phone: Mapped[str | None] = mapped_column(String(64), nullable=True)
    contact_email: Mapped[str | None] = mapped_column(String(255), nullable=True)
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey('users.id', ondelete='SET NULL', name='fk_itinerary_stays_created_by'),
        nullable=True,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utcnow, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=utcnow,
        onupdate=utcnow,
        server_default=func.now(),
    )

    location: Mapped['Location | None'] = relationship(
        'Location',
        primaryjoin=(
            'and_(ItineraryStay.trip_id == Location.trip_id, '
            'ItineraryStay.location_id == Location.id)'
        ),
        foreign_keys='[ItineraryStay.trip_id, ItineraryStay.location_id]',
        viewonly=True,
    )


class ItineraryConnection(Base):
    __tablename__ = 'itinerary_connections'
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
            'trip_id', 'from_stop_id', name='uq_itinerary_connections_trip_from_stop_id'
        ),
        UniqueConstraint(
            'trip_id', 'to_stop_id', name='uq_itinerary_connections_trip_to_stop_id'
        ),
        CheckConstraint(
            'from_stop_id IS NULL OR to_stop_id IS NULL OR from_stop_id <> to_stop_id',
            name='ck_itinerary_connections_distinct_stops',
        ),
        CheckConstraint(
            '(from_stop_id IS NOT NULL) <> (from_location_id IS NOT NULL)',
            name='ck_itinerary_connections_from_endpoint',
        ),
        CheckConstraint(
            '(to_stop_id IS NOT NULL) <> (to_location_id IS NOT NULL)',
            name='ck_itinerary_connections_to_endpoint',
        ),
        CheckConstraint(
            'from_stop_id IS NOT NULL OR to_stop_id IS NOT NULL',
            name='ck_itinerary_connections_stop_endpoint',
        ),
        *(
            ForeignKeyConstraint(
                ['trip_id', key],
                ['locations.trip_id', 'locations.id'],
                name=f'fk_itinerary_connections_trip_{key}',
            )
            for key in ('from_location_id', 'to_location_id')
        ),
        Index(
            'uq_itinerary_connections_departure',
            'trip_id',
            unique=True,
            postgresql_where=text('from_stop_id IS NULL'),
        ),
        Index(
            'uq_itinerary_connections_return',
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
        primaryjoin='and_(ItineraryConnection.trip_id == ItineraryStop.trip_id, ItineraryConnection.from_stop_id == ItineraryStop.id)',
        foreign_keys='[ItineraryConnection.trip_id, ItineraryConnection.from_stop_id]',
        viewonly=True,
    )
    to_stop: Mapped['ItineraryStop | None'] = relationship(
        primaryjoin='and_(ItineraryConnection.trip_id == ItineraryStop.trip_id, ItineraryConnection.to_stop_id == ItineraryStop.id)',
        foreign_keys='[ItineraryConnection.trip_id, ItineraryConnection.to_stop_id]',
        viewonly=True,
    )
    from_location: Mapped['Location | None'] = relationship(
        primaryjoin='and_(ItineraryConnection.trip_id == Location.trip_id, ItineraryConnection.from_location_id == Location.id)',
        foreign_keys='[ItineraryConnection.trip_id, ItineraryConnection.from_location_id]',
        viewonly=True,
    )
    to_location: Mapped['Location | None'] = relationship(
        primaryjoin='and_(ItineraryConnection.trip_id == Location.trip_id, ItineraryConnection.to_location_id == Location.id)',
        foreign_keys='[ItineraryConnection.trip_id, ItineraryConnection.to_location_id]',
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
        foreign_keys='[ItineraryTravelSegment.trip_id, ItineraryTravelSegment.connection_id]',
    )


class ItineraryTravelSegment(Base):
    __tablename__ = 'itinerary_travel_segments'
    __table_args__ = (
        UniqueConstraint('trip_id', 'id'),
        UniqueConstraint('connection_id', 'position', deferrable=True, initially='DEFERRED'),
        ForeignKeyConstraint(
            ['trip_id', 'connection_id'],
            ['itinerary_connections.trip_id', 'itinerary_connections.id'],
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
    connection_id: Mapped[uuid.UUID] = mapped_column(index=True)
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
            ['trip_id', 'connection_id'],
            ['itinerary_connections.trip_id', 'itinerary_connections.id'],
            ondelete='CASCADE',
        ),
        CheckConstraint("kind IN ('FLIGHT_CANDIDATE', 'PREVIEW')"),
        CheckConstraint("(kind = 'PREVIEW') = (itinerary_revision IS NOT NULL)"),
        Index(
            'ix_planning_artifacts_scope',
            'trip_id',
            'created_by_user_id',
            'connection_id',
            'kind',
            'input_hash',
        ),
    )
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    kind: Mapped[str] = mapped_column(String(32))
    trip_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey('trips.id', ondelete='CASCADE')
    )
    connection_id: Mapped[uuid.UUID | None]
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
