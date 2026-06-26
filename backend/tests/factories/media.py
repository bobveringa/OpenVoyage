from __future__ import annotations

import uuid

from models.database.media import Media, MediaStatus, MediaStorageBackend, MediaType
from sqlalchemy.orm import Session


def create_media(
    db_session: Session,
    *,
    storage_path: str,
    has_thumbnail: bool = True,
    thumbnail_storage_path: str | None = None,
    content_type: str = 'image/jpeg',
    thumbnail_content_type: str = 'image/webp',
    media_type: MediaType = MediaType.IMAGE,
    status: MediaStatus = MediaStatus.READY,
    created_by: uuid.UUID | None = None,
    width: int = 1280,
    height: int = 720,
    duration: int | None = None,
) -> Media:
    media = Media(
        id=uuid.uuid4(),
        storage_path=storage_path,
        thumbnail_storage_path=(
            thumbnail_storage_path or f'{storage_path}.thumb.webp'
            if has_thumbnail
            else None
        ),
        content_type=content_type,
        media_type=media_type,
        thumbnail_content_type=thumbnail_content_type,
        caption='',
        status=status,
        storage_backend=MediaStorageBackend.LOCAL,
        created_by=created_by,
        width=width,
        height=height,
        duration=duration,
    )
    db_session.add(media)
    db_session.commit()
    db_session.refresh(media)
    return media
