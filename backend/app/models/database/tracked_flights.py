"""Retained flight identity and timing facts; geometry belongs to GPS sessions."""

import uuid
from datetime import datetime

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    ForeignKey,
    ForeignKeyConstraint,
    String,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .base import Base
from .gps_tracking import GpsTrackingSession
from .places import Place


class TrackedFlight(Base):
    __tablename__ = 'tracked_flights'
    __table_args__ = (
        UniqueConstraint(
            'trip_id',
            'flight_number',
            'scheduled_departure',
            'departure_airport_place_id',
            name='uq_tracked_flight_identity',
        ),
        ForeignKeyConstraint(
            ['trip_id', 'itinerary_travel_segment_id'],
            ['itinerary_travel_segments.trip_id', 'itinerary_travel_segments.id'],
            name='fk_tracked_flight_segment',
            ondelete='SET NULL (itinerary_travel_segment_id)',
        ),
        ForeignKeyConstraint(
            ['trip_id', 'gps_tracking_session_id'],
            ['gps_tracking_sessions.trip_id', 'gps_tracking_sessions.id'],
            name='fk_tracked_flight_session',
        ),
        CheckConstraint(
            "completion_source IS NULL OR completion_source IN ('PROVIDER', 'OWNER')"
        ),
        CheckConstraint(
            "stop_reason IS NULL OR stop_reason IN ('MANUAL', 'NEXT_FLIGHT_DEPARTED')"
        ),
        CheckConstraint(
            "flight_number = upper(replace(replace(flight_number, ' ', ''), '-', ''))"
        ),
    )
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    trip_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey('trips.id', ondelete='CASCADE'), index=True
    )
    itinerary_travel_segment_id: Mapped[uuid.UUID | None]
    itinerary_connection_id: Mapped[uuid.UUID]
    gps_tracking_session_id: Mapped[uuid.UUID | None] = mapped_column(unique=True)
    flight_number: Mapped[str] = mapped_column(String(16))
    departure_airport_place_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey('places.id', ondelete='RESTRICT')
    )
    arrival_airport_place_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey('places.id', ondelete='RESTRICT')
    )
    airline_name: Mapped[str | None] = mapped_column(String(255))
    status: Mapped[str] = mapped_column(String(32), default='SCHEDULED')
    scheduled_departure: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    scheduled_arrival: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    estimated_departure: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True)
    )
    estimated_arrival: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    actual_departure: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    actual_arrival: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    completion_source: Mapped[str | None] = mapped_column(String(16))
    stop_reason: Mapped[str | None] = mapped_column(String(32))
    checked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    next_check_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), index=True
    )
    last_check_result: Mapped[str] = mapped_column(String(32), default='NOT_CHECKED')
    departure_airport: Mapped[Place] = relationship(
        foreign_keys=[departure_airport_place_id], lazy='joined'
    )
    arrival_airport: Mapped[Place | None] = relationship(
        foreign_keys=[arrival_airport_place_id], lazy='joined'
    )
    session: Mapped[GpsTrackingSession | None] = relationship(
        foreign_keys=[trip_id, gps_tracking_session_id], lazy='joined'
    )
