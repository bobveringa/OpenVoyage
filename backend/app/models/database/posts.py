import uuid
from datetime import datetime

from sqlalchemy import (
    DateTime,
    ForeignKey,
    Index,
    Integer,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base, utcnow


class Post(Base):
    __tablename__ = 'posts'

    id: Mapped[uuid.UUID] = mapped_column(
        primary_key=True,
        default=uuid.uuid4,
    )
    trip_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey(
            'trips.id',
            ondelete='CASCADE',
            name='fk_posts_trip_id',
        ),
        nullable=False,
    )
    author_user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey(
            'users.id',
            name='fk_posts_author_user_id',
        ),
        nullable=False,
    )
    location_id: Mapped[uuid.UUID] = mapped_column(
        nullable=False,
    )
    body: Mapped[str] = mapped_column(
        Text,
        nullable=False,
    )
    published_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
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


class PostMedia(Base):
    __tablename__ = 'post_media'
    __table_args__ = (
        UniqueConstraint('post_id', 'media_id', name='uq_post_media_post_id_media_id'),
        Index('ix_post_media_post_id_sort_order', 'post_id', 'sort_order'),
        Index('ix_post_media_media_id', 'media_id'),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        primary_key=True,
        default=uuid.uuid4,
    )
    post_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey(
            'posts.id',
            ondelete='CASCADE',
            name='fk_post_media_post_id',
        ),
        nullable=False,
    )
    media_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey(
            'media.id',
            ondelete='CASCADE',
            name='fk_post_media_media_id',
        ),
        nullable=False,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=utcnow,
        server_default=func.now(),
    )
    sort_order: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        default=0,
        server_default='0',
    )
