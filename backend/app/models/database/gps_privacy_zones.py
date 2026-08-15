import typing
import uuid
from datetime import datetime

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    Double,
    ForeignKey,
    Index,
    Integer,
    String,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .base import Base, utcnow

if typing.TYPE_CHECKING:
    from .user import User


class GpsPrivacyZone(Base):
    """Account-wide circular area whose coordinates are never retained.

    A zone belongs to a user, not to a trip or a session. It filters uploads in
    every trip where its owner is currently an owner or member, and its
    configuration never leaves the owning account.
    """

    __tablename__ = 'gps_privacy_zones'
    __table_args__ = (
        CheckConstraint(
            'latitude >= -90 AND latitude <= 90',
            name='ck_gps_privacy_zones_latitude_range',
        ),
        CheckConstraint(
            'longitude >= -180 AND longitude <= 180',
            name='ck_gps_privacy_zones_longitude_range',
        ),
        CheckConstraint(
            'radius_meters > 0',
            name='ck_gps_privacy_zones_radius_positive',
        ),
        Index('ix_gps_privacy_zones_user_id_id', 'user_id', 'id'),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        primary_key=True,
        default=uuid.uuid4,
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey(
            'users.id',
            ondelete='CASCADE',
            name='fk_gps_privacy_zones_user_id',
        ),
        nullable=False,
    )
    name: Mapped[str] = mapped_column(
        String(100),
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
    radius_meters: Mapped[int] = mapped_column(
        Integer,
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

    user: Mapped['User'] = relationship('User')
