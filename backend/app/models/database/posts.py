import uuid
import typing
from datetime import datetime

from sqlalchemy import (
    DateTime,
    CheckConstraint,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .base import Base, utcnow

if typing.TYPE_CHECKING:
    from .locations import Location
    from .media import Media
    from .trips import Trip
    from .trips import TripShareLink
    from .user import User


class Post(Base):
    __tablename__ = 'posts'
    __table_args__ = (
        Index('ix_posts_trip_id_published_at', 'trip_id', 'published_at'),
        Index('ix_posts_trip_id_occurred_at', 'trip_id', 'occurred_at'),
        Index('ix_posts_author_user_id', 'author_user_id'),
        Index('ix_posts_location_id', 'location_id'),
    )

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
        ForeignKey(
            'locations.id',
            name='fk_posts_location_id',
            ondelete='CASCADE',
        ),
        nullable=False,
    )
    title: Mapped[str] = mapped_column(
        String(255),
        nullable=False,
    )
    body: Mapped[str] = mapped_column(
        Text,
        nullable=False,
    )
    occurred_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=utcnow,
        server_default=func.now(),
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

    trip: Mapped['Trip'] = relationship('Trip')
    author: Mapped['User'] = relationship('User')
    location: Mapped['Location'] = relationship('Location')
    media_links: Mapped[list['PostMedia']] = relationship(
        'PostMedia',
        back_populates='post',
        cascade='all, delete-orphan',
        order_by='PostMedia.sort_order',
    )
    likes: Mapped[list['PostLike']] = relationship(
        'PostLike', cascade='all, delete-orphan'
    )
    comments: Mapped[list['PostComment']] = relationship(
        'PostComment', cascade='all, delete-orphan'
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

    post: Mapped['Post'] = relationship('Post', back_populates='media_links')
    media: Mapped['Media'] = relationship('Media')


class PostLike(Base):
    __tablename__ = 'post_likes'
    __table_args__ = (
        UniqueConstraint('post_id', 'user_id', name='uq_post_likes_post_user'),
        UniqueConstraint('post_id', 'share_link_id', name='uq_post_likes_post_link'),
        Index('ix_post_likes_post_id', 'post_id'),
        CheckConstraint(
            '(user_id IS NULL) <> (share_link_id IS NULL)',
            name='ck_post_likes_one_actor',
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    post_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey('posts.id', ondelete='CASCADE', name='fk_post_likes_post_id'),
        nullable=False,
    )
    user_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey('users.id', ondelete='CASCADE', name='fk_post_likes_user_id'),
        nullable=True,
    )
    share_link_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey(
            'trip_share_links.id',
            ondelete='CASCADE',
            name='fk_post_likes_share_link_id',
        ),
        nullable=True,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=utcnow,
        server_default=func.now(),
    )


class PostComment(Base):
    __tablename__ = 'post_comments'
    __table_args__ = (
        Index('ix_post_comments_post_created_id', 'post_id', 'created_at', 'id'),
        CheckConstraint(
            '(user_id IS NULL) <> (share_link_id IS NULL)',
            name='ck_post_comments_one_actor',
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    post_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey('posts.id', ondelete='CASCADE', name='fk_post_comments_post_id'),
        nullable=False,
    )
    user_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey('users.id', ondelete='CASCADE', name='fk_post_comments_user_id'),
        nullable=True,
    )
    share_link_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey(
            'trip_share_links.id',
            ondelete='CASCADE',
            name='fk_post_comments_share_link_id',
        ),
        nullable=True,
    )
    body: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=utcnow,
        server_default=func.now(),
    )

    user: Mapped['User | None'] = relationship('User', foreign_keys=[user_id])
    share_link: Mapped['TripShareLink | None'] = relationship(
        'TripShareLink', foreign_keys=[share_link_id]
    )
