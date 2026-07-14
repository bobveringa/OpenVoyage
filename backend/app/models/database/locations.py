import uuid
import typing
from datetime import datetime

from sqlalchemy import (
    DateTime,
    Float,
    ForeignKey,
    Index,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .base import Base, utcnow

if typing.TYPE_CHECKING:
    from .trips import Trip
    from .user import User


class Location(Base):
    __tablename__ = 'locations'
    __table_args__ = (
        UniqueConstraint('trip_id', 'id', name='uq_locations_trip_id_id'),
        Index('ix_locations_trip_id', 'trip_id'),
        Index('ix_locations_created_by', 'created_by'),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        primary_key=True,
        default=uuid.uuid4,
    )
    trip_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey(
            'trips.id',
            ondelete='CASCADE',
            name='fk_locations_trip_id',
        ),
        nullable=False,
    )
    name: Mapped[str] = mapped_column(
        String(255),
        nullable=False,
    )
    latitude: Mapped[float] = mapped_column(
        Float(53),
        nullable=False,
    )
    longitude: Mapped[float] = mapped_column(
        Float(53),
        nullable=False,
    )
    country_code: Mapped[str] = mapped_column(
        String(2),
        nullable=False,
    )
    region: Mapped[str] = mapped_column(
        String(255),
        nullable=False,
    )
    full_name: Mapped[str] = mapped_column(
        Text,
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
    created_by: Mapped[uuid.UUID] = mapped_column(
        ForeignKey(
            'users.id',
            name='fk_locations_created_by',
        ),
        nullable=False,
    )

    trip: Mapped['Trip'] = relationship('Trip')
    creator: Mapped['User'] = relationship('User')
