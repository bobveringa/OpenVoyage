import uuid

from sqlalchemy import Float, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base


class Place(Base):
    __tablename__ = 'places'

    id: Mapped[uuid.UUID] = mapped_column(
        primary_key=True,
        default=uuid.uuid4,
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
