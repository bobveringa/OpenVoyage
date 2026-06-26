import uuid
from datetime import date, datetime

from sqlalchemy import (
    Date,
    DateTime,
    ForeignKey,
    Integer,
    Text,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base, utcnow


class PlannedStep(Base):
    __tablename__ = 'planned_steps'

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
    step_number: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
    )
    location_id: Mapped[uuid.UUID] = mapped_column(
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
