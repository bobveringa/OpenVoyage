import enum
import uuid
from datetime import datetime

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column

from ..search_names import build_search_names
from .base import Base, utcnow


def _default_search_names(context) -> str:
    return build_search_names([context.get_current_parameters().get('name')])


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
        Index('ix_places_latitude', 'latitude'),
        Index(
            'ix_places_search_names_trgm',
            'search_names',
            postgresql_using='gin',
            postgresql_ops={'search_names': 'gin_trgm_ops'},
        ),
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
    feature_code: Mapped[str | None] = mapped_column(String(10))
    iata_code: Mapped[str | None] = mapped_column(String(3), unique=True)
    icao_code: Mapped[str | None] = mapped_column(String(4), unique=True)
    timezone: Mapped[str | None] = mapped_column(String(64))
    # Every name the place is found by, in search form between | marks.
    search_names: Mapped[str] = mapped_column(
        Text, nullable=False, default=_default_search_names
    )
    # The English Wikipedia article, from GeoNames' alternate names (header photos).
    wikipedia_title: Mapped[str | None] = mapped_column(Text)
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


class PlacePhotoStatus(str, enum.Enum):
    READY = 'READY'
    NONE = 'NONE'
    FAILED = 'FAILED'


class PlacePhoto(Base):
    """One row per place we tried to find a Wikipedia header photo for.

    The image itself lives in storage at ``place-photos/{place_id}.webp``.
    """

    __tablename__ = 'place_photos'
    __table_args__ = (
        CheckConstraint(
            "status IN ('READY', 'NONE', 'FAILED')", name='ck_place_photos_status'
        ),
    )

    place_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey('places.id', ondelete='CASCADE'), primary_key=True
    )
    status: Mapped[str] = mapped_column(String(16), nullable=False)
    source_url: Mapped[str | None] = mapped_column(Text)
    credit: Mapped[str | None] = mapped_column(String(255))
    license: Mapped[str | None] = mapped_column(String(64))
    fetched_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
