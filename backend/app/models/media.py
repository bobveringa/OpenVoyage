import uuid
from datetime import datetime
from enum import Enum

from sqlalchemy import String, DateTime, func
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base, utcnow


class MediaType(str, Enum):
    IMAGE = 'IMAGE'
    VIDEO = 'VIDEO'


class Media(Base):
    __tablename__ = 'media'

    id: Mapped[uuid.UUID] = mapped_column(
        primary_key=True,
        default=uuid.uuid4,
    )
    url: Mapped[str] = mapped_column(
        String(2048),
        nullable=False,
    )
    thumbnail_url: Mapped[str] = mapped_column(
        String(2048),
        nullable=False,
    )
    media_type: Mapped[str] = mapped_column(
        String(32),
        nullable=False,
        default=MediaType.IMAGE.value,
        server_default=MediaType.IMAGE.value,
    )
    caption: Mapped[str] = mapped_column(
        String(2048),
        nullable=False,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=False),
        nullable=False,
        default=utcnow,
        server_default=func.now(),
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=False),
        nullable=False,
        default=utcnow,
        server_default=func.now(),
    )
