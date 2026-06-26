import uuid
from datetime import datetime
from enum import Enum
from typing import Optional
import typing

from sqlalchemy import String, DateTime, func, ForeignKey, Integer
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .base import Base, utcnow

if typing.TYPE_CHECKING:
    from .trips import Trip
    from .user import User


class MediaType(str, Enum):
    IMAGE = 'IMAGE'
    VIDEO = 'VIDEO'


class MediaStatus(str, Enum):
    UPLOADED = 'UPLOADED'
    READY = 'READY'
    FAILED = 'FAILED'


class MediaStorageBackend(str, Enum):
    LOCAL = 'LOCAL'


class Media(Base):
    __tablename__ = 'media'

    id: Mapped[uuid.UUID] = mapped_column(
        primary_key=True,
        default=uuid.uuid4,
    )
    storage_path: Mapped[str] = mapped_column(
        String(2048),
        nullable=False,
    )
    thumbnail_storage_path: Mapped[Optional[str]] = mapped_column(
        String(2048),
        nullable=True,
    )
    media_type: Mapped[MediaType] = mapped_column(
        String(32),
        nullable=False,
    )
    content_type: Mapped[str] = mapped_column(
        String(255),
        nullable=False,
    )
    thumbnail_content_type: Mapped[Optional[str]] = mapped_column(
        String(255),
        nullable=True,
    )
    caption: Mapped[str] = mapped_column(
        String(2048),
        nullable=False,
    )
    status: Mapped[MediaStatus] = mapped_column(
        String(32),
        nullable=False,
    )
    storage_backend: Mapped[MediaStorageBackend] = mapped_column(
        String(32),
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
        server_default=func.now(),
        onupdate=utcnow,
    )
    created_by: Mapped[Optional[uuid.UUID]] = mapped_column(
        ForeignKey(
            'users.id',
            ondelete='set null',
            name='fk_media_created_by',
        ),
        nullable=True,
    )

    width: Mapped[Optional[int]] = mapped_column(
        Integer,
        nullable=True,
        comment='Applicable for images and videos, represents the width in pixels',
    )
    height: Mapped[Optional[int]] = mapped_column(
        Integer,
        nullable=True,
        comment='Applicable for images and videos, represents the height in pixels',
    )
    duration: Mapped[Optional[int]] = mapped_column(
        Integer,
        nullable=True,
        comment='Duration in seconds, applicable for videos',
    )

    # Relationships
    creator: Mapped[Optional['User']] = relationship('User', back_populates='media')
    covered_trip: Mapped[Optional['Trip']] = relationship(
        'Trip', back_populates='cover_media'
    )
