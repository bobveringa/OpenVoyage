import uuid
import typing
from datetime import date, datetime

from sqlalchemy import (
    BigInteger,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Text,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .base import Base, utcnow

if typing.TYPE_CHECKING:
    from .locations import Location
    from .trips import Trip


class PlannedStep(Base):
    __tablename__ = 'planned_steps'
    __table_args__ = (
        Index('ix_planned_steps_trip_id_position', 'trip_id', 'position', unique=True),
        Index('ix_planned_steps_location_id', 'location_id'),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        primary_key=True,
        default=uuid.uuid4,
    )
    trip_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey(
            'trips.id',
            ondelete='CASCADE',
            name='fk_planned_steps_trip_id',
        ),
        nullable=False,
    )
    position: Mapped[int] = mapped_column(
        BigInteger,
        nullable=False,
    )
    location_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey(
            'locations.id',
            ondelete='CASCADE',
            name='fk_planned_steps_location_id',
        ),
        nullable=False,
    )
    arrival_date: Mapped[date] = mapped_column(
        Date,
        nullable=False,
    )
    departure_date: Mapped[date] = mapped_column(
        Date,
        nullable=False,
    )
    notes: Mapped[str] = mapped_column(
        Text,
        nullable=False,
        default='',
        server_default='',
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
    location: Mapped['Location'] = relationship('Location')
