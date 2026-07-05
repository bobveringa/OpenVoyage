import enum
import uuid
import typing
from datetime import datetime

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    ForeignKey,
    ForeignKeyConstraint,
    Index,
    String,
    Text,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .base import Base, utcnow

if typing.TYPE_CHECKING:
    from .planned_steps import PlannedStep
    from .trips import Trip


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
    __table_args__ = (
        CheckConstraint(
            'from_planned_step_id <> to_planned_step_id',
            name='ck_planned_travel_distinct_steps',
        ),
        ForeignKeyConstraint(
            ['trip_id', 'from_planned_step_id'],
            ['planned_steps.trip_id', 'planned_steps.id'],
            ondelete='CASCADE',
            name='fk_planned_travel_trip_from_planned_step_id',
        ),
        ForeignKeyConstraint(
            ['trip_id', 'to_planned_step_id'],
            ['planned_steps.trip_id', 'planned_steps.id'],
            ondelete='CASCADE',
            name='fk_planned_travel_trip_to_planned_step_id',
        ),
        Index(
            'ix_planned_travel_trip_from_to',
            'trip_id',
            'from_planned_step_id',
            'to_planned_step_id',
            unique=True,
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

    trip: Mapped['Trip'] = relationship('Trip')
    from_planned_step: Mapped['PlannedStep'] = relationship(
        'PlannedStep',
        primaryjoin=(
            'and_(PlannedTravel.trip_id == PlannedStep.trip_id, '
            'PlannedTravel.from_planned_step_id == PlannedStep.id)'
        ),
        foreign_keys=[trip_id, from_planned_step_id],
        viewonly=True,
    )
    to_planned_step: Mapped['PlannedStep'] = relationship(
        'PlannedStep',
        primaryjoin=(
            'and_(PlannedTravel.trip_id == PlannedStep.trip_id, '
            'PlannedTravel.to_planned_step_id == PlannedStep.id)'
        ),
        foreign_keys=[trip_id, to_planned_step_id],
        viewonly=True,
    )
