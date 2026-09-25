import uuid

from sqlalchemy import ForeignKey, Index, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .base import Base


class UserImmichConnection(Base):
    __tablename__ = 'user_immich_connections'

    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey('users.id', ondelete='CASCADE'),
        primary_key=True,
    )
    server_url: Mapped[str] = mapped_column(String(2048), nullable=False)
    immich_user_id: Mapped[uuid.UUID] = mapped_column(nullable=False)
    api_key_encrypted: Mapped[str] = mapped_column(Text, nullable=False)

    user = relationship('User')
    album_links: Mapped[list['TripImmichAlbum']] = relationship(
        'TripImmichAlbum',
        back_populates='connection',
        cascade='all, delete-orphan',
    )


class TripImmichAlbum(Base):
    __tablename__ = 'trip_immich_albums'
    __table_args__ = (
        UniqueConstraint(
            'trip_id',
            'connection_user_id',
            'album_id',
            name='uq_trip_immich_albums_trip_connection_album',
        ),
        Index('ix_trip_immich_albums_connection_user_id', 'connection_user_id'),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    trip_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey('trips.id', ondelete='CASCADE'),
        nullable=False,
    )
    connection_user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey('user_immich_connections.user_id', ondelete='CASCADE'),
        nullable=False,
    )
    album_id: Mapped[uuid.UUID] = mapped_column(nullable=False)

    trip = relationship('Trip')
    connection: Mapped[UserImmichConnection] = relationship(
        'UserImmichConnection',
        back_populates='album_links',
    )
