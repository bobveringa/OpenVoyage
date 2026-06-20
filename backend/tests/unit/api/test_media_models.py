from __future__ import annotations

from datetime import datetime, timezone
import uuid

import pytest

from models.api.media import MediaResponse
from models.database.media import Media, MediaStatus, MediaStorageBackend, MediaType


@pytest.mark.unit
def test_media_response_from_model_image_excludes_duration() -> None:
    media_id = uuid.uuid4()
    media = Media(
        id=media_id,
        storage_path='media/main.jpg',
        thumbnail_storage_path='media/thumb.webp',
        media_type=MediaType.IMAGE,
        content_type='image/jpeg',
        thumbnail_content_type='image/webp',
        caption='Sunset',
        status=MediaStatus.READY,
        storage_backend=MediaStorageBackend.LOCAL,
        width=1920,
        height=1080,
        duration=None,
        created_at=datetime.now(timezone.utc),
        updated_at=datetime.now(timezone.utc),
        created_by=None,
    )

    response = MediaResponse.from_model(media)

    assert response.id == media_id
    assert response.media_type == 'IMAGE'
    assert response.urls.content == f'/{media_id}'
    assert response.urls.thumbnail == f'/{media_id}?thumbnail=true'
    assert response.metadata.caption == 'Sunset'
    assert response.technical_info.width == 1920
    assert response.technical_info.height == 1080
    assert 'duration' not in response.technical_info.model_dump()


@pytest.mark.unit
def test_media_response_from_model_video_includes_duration() -> None:
    media_id = uuid.uuid4()
    media = Media(
        id=media_id,
        storage_path='media/video.mp4',
        thumbnail_storage_path='media/video-thumb.webp',
        media_type=MediaType.VIDEO,
        content_type='video/mp4',
        thumbnail_content_type=None,
        caption='Waves',
        status=MediaStatus.READY,
        storage_backend=MediaStorageBackend.LOCAL,
        width=1280,
        height=720,
        duration=60,
        created_at=datetime.now(timezone.utc),
        updated_at=datetime.now(timezone.utc),
        created_by=None,
    )

    response = MediaResponse.from_model(media)

    assert response.id == media_id
    assert response.media_type == 'VIDEO'
    assert response.metadata.caption == 'Waves'
    assert response.technical_info.duration == 60
    assert response.urls.thumbnail == f'/{media_id}?thumbnail=true'
