from __future__ import annotations

from datetime import datetime, timezone
import uuid

import pytest

from models.api.media import MediaResponse, MediaUploadResponse
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
    assert response.status == 'READY'
    assert response.urls.content == f'/api/v1/media/{media_id}/content'
    assert response.urls.thumbnail == f'/api/v1/media/{media_id}/content?thumbnail=true'
    assert response.metadata.caption == 'Sunset'
    assert response.technical_info is not None
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
    assert response.status == 'READY'
    assert response.metadata.caption == 'Waves'
    assert response.technical_info is not None
    assert response.technical_info.duration == 60
    assert response.urls.thumbnail == f'/api/v1/media/{media_id}/content?thumbnail=true'


@pytest.mark.unit
def test_media_response_from_model_uploaded_media_allows_missing_thumbnail() -> None:
    media_id = uuid.uuid4()
    media = Media(
        id=media_id,
        storage_path='media/pending.jpg',
        thumbnail_storage_path=None,
        media_type=MediaType.IMAGE,
        content_type='image/jpeg',
        thumbnail_content_type=None,
        caption='Pending',
        status=MediaStatus.UPLOADED,
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
    assert response.status == 'UPLOADED'
    assert response.urls.content == f'/api/v1/media/{media_id}/content'
    assert response.urls.thumbnail is None
    assert response.technical_info is not None
    assert response.technical_info.width == 1920


@pytest.mark.unit
def test_media_upload_response_from_model_includes_signed_content_url() -> None:
    media_id = uuid.uuid4()
    media = Media(
        id=media_id,
        storage_path='media/upload.jpg',
        thumbnail_storage_path=None,
        media_type=MediaType.IMAGE,
        content_type='image/jpeg',
        thumbnail_content_type=None,
        caption='',
        status=MediaStatus.UPLOADED,
        storage_backend=MediaStorageBackend.LOCAL,
        width=640,
        height=480,
        duration=None,
        created_at=datetime.now(timezone.utc),
        updated_at=datetime.now(timezone.utc),
        created_by=None,
    )

    response = MediaUploadResponse.from_model(
        media,
        media_base_url='https://example.test',
        media_token='signed-token',
    )

    assert response.id == media_id
    assert response.media_type == 'IMAGE'
    assert response.status == 'UPLOADED'
    assert (
        response.urls.content
        == f'https://example.test/api/v1/media/{media_id}/content?media_token=signed-token'
    )
    assert response.urls.thumbnail is None
    assert response.technical_info is not None
    assert response.technical_info.width == 640
    assert response.technical_info.height == 480
