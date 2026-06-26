import enum
import uuid
from datetime import datetime

from sqlalchemy import (
    DateTime,
    ForeignKey,
    String,
    Text,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base, utcnow


class PlannedTravelMode(str, enum.Enum):
    FLIGHT = 'FLIGHT'
    TRAIN = 'TRAIN'
    BUS = 'BUS'
    CAR = 'CAR'
    FERRY = 'FERRY'
    WALK = 'WALK'
    BIKE = 'BIKE'
    OTHER = 'OTHER'


class PlannedTravel(Base):
    __tablename__ = 'planned_travel'

    id: Mapped[uuid.UUID] = mapped_column(
        primary_key=True,
        default=uuid.uuid4,
    )
    trip_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey(
            'trips.id',
            ondelete='CASCADE',
            name='fk_planned_travel_trip_id',
        ),
        nullable=False,
    )
    from_planned_step_id: Mapped[uuid.UUID] = mapped_column(
        nullable=False,
    )
    to_planned_step_id: Mapped[uuid.UUID] = mapped_column(
        nullable=False,
    )
    travel_mode: Mapped[PlannedTravelMode] = mapped_column(
        String(32),
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
