import enum
import uuid
from datetime import datetime

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    Float,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base, utcnow


class PlaceFeatureClass(str, enum.Enum):
    ADMINISTRATIVE_BOUNDARY = 'A'
    HYDROGRAPHIC = 'H'
    AREA = 'L'
    POPULATED_PLACE = 'P'
    ROAD_RAILROAD = 'R'
    SPOT = 'S'
    HYPSOGRAPHIC = 'T'
    UNDERSEA = 'U'
    VEGETATION = 'V'


class Place(Base):
    __tablename__ = 'places'
    __table_args__ = (
        UniqueConstraint(
            'external_source',
            'external_id',
            name='uq_places_external_source_external_id',
        ),
        Index('ix_places_country_code_region', 'country_code', 'region'),
        Index('ix_places_population', 'population'),
        CheckConstraint('population >= 0', name='ck_places_population_nonnegative'),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        primary_key=True,
        default=uuid.uuid4,
    )
    external_source: Mapped[str] = mapped_column(
        String(64),
        nullable=False,
    )
    external_id: Mapped[str] = mapped_column(
        String(64),
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
    feature_class: Mapped[PlaceFeatureClass] = mapped_column(
        String(1),
        nullable=False,
    )
    population: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        default=0,
        server_default='0',
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
