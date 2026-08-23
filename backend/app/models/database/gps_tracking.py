import typing
import uuid
from datetime import datetime

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    DateTime,
    Double,
    ForeignKey,
    ForeignKeyConstraint,
    Index,
    String,
    UniqueConstraint,
    func,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .base import Base, utcnow
from .travel import TravelMode

if typing.TYPE_CHECKING:
    from .trips import Trip


class GpsTrackingSession(Base):
    """One continuous recording in a trip."""

    __tablename__ = 'gps_tracking_sessions'
    __table_args__ = (
        CheckConstraint(
            'ended_at IS NULL OR ended_at >= started_at',
            name='ck_gps_tracking_sessions_ended_after_started',
        ),
        UniqueConstraint(
            'trip_id',
            'id',
            name='uq_gps_tracking_sessions_trip_id_id',
        ),
        Index(
            'uq_gps_tracking_sessions_trip_open',
            'trip_id',
            unique=True,
            postgresql_where=text('ended_at IS NULL'),
        ),
        Index(
            'ix_gps_tracking_sessions_trip_started_at_id',
            'trip_id',
            'started_at',
            'id',
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True)
    trip_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey(
            'trips.id',
            ondelete='CASCADE',
            name='fk_gps_tracking_sessions_trip_id',
        ),
        nullable=False,
    )
    recorded_by_user_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey(
            'users.id',
            ondelete='SET NULL',
            name='fk_gps_tracking_sessions_recorded_by_user_id',
        ),
        nullable=True,
    )
    started_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
    )
    ended_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
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
    samples: Mapped[list['GpsTrackSample']] = relationship(
        'GpsTrackSample',
        back_populates='session',
        cascade='all, delete-orphan',
    )


class GpsTrackSample(Base):
    """A retained GPS point.

    Only points that survived privacy filtering exist here. ``trip_id`` is
    denormalized from the session so trip-wide timeline reads are one range
    scan instead of a per-session scan and application-side merge.
    """

    __tablename__ = 'gps_track_samples'
    __table_args__ = (
        CheckConstraint(
            'latitude >= -90 AND latitude <= 90',
            name='ck_gps_track_samples_latitude_range',
        ),
        CheckConstraint(
            'longitude >= -180 AND longitude <= 180',
            name='ck_gps_track_samples_longitude_range',
        ),
        CheckConstraint(
            'accuracy_meters IS NULL OR accuracy_meters >= 0',
            name='ck_gps_track_samples_accuracy_nonnegative',
        ),
        CheckConstraint(
            'speed_mps IS NULL OR speed_mps >= 0',
            name='ck_gps_track_samples_speed_nonnegative',
        ),
        CheckConstraint(
            'heading_degrees IS NULL OR (heading_degrees >= 0 AND heading_degrees <= 360)',
            name='ck_gps_track_samples_heading_range',
        ),
        ForeignKeyConstraint(
            ['trip_id', 'session_id'],
            ['gps_tracking_sessions.trip_id', 'gps_tracking_sessions.id'],
            name='fk_gps_track_samples_trip_session_id',
            ondelete='CASCADE',
        ),
        Index(
            'ix_gps_track_samples_trip_recorded_at_id',
            'trip_id',
            'recorded_at',
            'id',
        ),
        Index(
            'ix_gps_track_samples_session_recorded_at_id',
            'session_id',
            'recorded_at',
            'id',
        ),
        # Partial, because both sets are a small fraction of the raw points and
        # every read of them is a chronological trip-wide scan.
        Index(
            'ix_gps_track_samples_trip_post_candidates',
            'trip_id',
            'recorded_at',
            'id',
            postgresql_where=text('is_post_candidate'),
        ),
        Index(
            'ix_gps_track_samples_trip_display_track',
            'trip_id',
            'recorded_at',
            'id',
            postgresql_where=text('is_display_retained'),
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True)
    trip_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey(
            'trips.id',
            ondelete='CASCADE',
            name='fk_gps_track_samples_trip_id',
        ),
        nullable=False,
    )
    session_id: Mapped[uuid.UUID] = mapped_column(nullable=False)
    recorded_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
    )
    latitude: Mapped[float] = mapped_column(
        Double,
        nullable=False,
    )
    longitude: Mapped[float] = mapped_column(
        Double,
        nullable=False,
    )
    accuracy_meters: Mapped[float | None] = mapped_column(
        Double,
        nullable=True,
    )
    speed_mps: Mapped[float | None] = mapped_column(
        Double,
        nullable=True,
    )
    heading_degrees: Mapped[float | None] = mapped_column(
        Double,
        nullable=True,
    )
    altitude_meters: Mapped[float | None] = mapped_column(
        Double,
        nullable=True,
    )
    travel_mode: Mapped[TravelMode] = mapped_column(
        String(32),
        nullable=False,
        default=TravelMode.UNKNOWN,
        server_default=TravelMode.UNKNOWN.value,
    )
    # Derived from the session's own points, and rewritten by
    # ``services.gps.derived_track`` whenever those points change. Reads select
    # on them instead of re-scanning a trip's whole raw history, which is what
    # keeps timeline cost proportional to what is drawn rather than to how long
    # the trip has been recording.
    is_long_stay: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        default=False,
        server_default=text('false'),
    )
    is_post_candidate: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        default=False,
        server_default=text('false'),
    )
    # Implied by either flag above: a marker must never sit somewhere the drawn
    # line does not go, so both are required points of the display track.
    is_display_retained: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        default=False,
        server_default=text('false'),
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

    session: Mapped['GpsTrackingSession'] = relationship(
        'GpsTrackingSession',
        back_populates='samples',
    )
