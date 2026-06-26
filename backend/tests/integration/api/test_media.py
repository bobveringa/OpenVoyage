from __future__ import annotations

from pathlib import Path

import pytest

from core import security
from factories.media import create_media
from factories.users import create_user
from models.database.media import MediaStatus, MediaType


@pytest.mark.integration
def test_upload_media_success(
    client, db_session, api_prefix, monkeypatch, tmp_path: Path
) -> None:
    user = create_user(db_session, password='MediaPass123!')
    tokens = security.create_auth_tokens(subject=user.id, email=user.email)

    from core.config import settings
    from services import media_service

    settings.MEDIA_DIRECTORY = str(tmp_path)
    monkeypatch.setattr(
        media_service, 'detect_content_type', lambda _file: 'image/jpeg'
    )
    monkeypatch.setattr(
        media_service, '_extract_media_info', lambda _path, _kind: (640, 480, None)
    )
    monkeypatch.setattr(media_service, 'create_thumbnail', lambda *_args: None)

    response = client.post(
        f'{api_prefix}/media',
        headers={'Authorization': f'Bearer {tokens["access_token"]}'},
        files={
            'file': (
                'photo.jpg',
                b'not-a-real-jpeg-but-good-enough-for-test',
                'image/jpeg',
            )
        },
    )

    assert response.status_code == 201
    payload = response.json()
    assert 'id' in payload


@pytest.mark.integration
def test_get_media_content_not_found(client, api_prefix) -> None:
    response = client.get(
        f'{api_prefix}/media/00000000-0000-0000-0000-000000000000/content'
    )
    assert response.status_code == 404


@pytest.mark.integration
def test_get_media_thumbnail_not_ready_returns_conflict(
    client, db_session, api_prefix
) -> None:
    media = create_media(
        db_session,
        storage_path='media/cover.jpg',
        thumbnail_content_type=None,
    )
    media.status = MediaStatus.UPLOADED
    media.thumbnail_storage_path = None
    db_session.add(media)
    db_session.commit()

    response = client.get(f'{api_prefix}/media/{media.id}/content?thumbnail=true')

    assert response.status_code == 409


@pytest.mark.integration
def test_get_video_content_supports_range(
    client, db_session, api_prefix, tmp_path
) -> None:
    video_path = tmp_path / 'clip.mp4'
    video_path.write_bytes(b'0123456789')
    media = create_media(
        db_session,
        storage_path=str(video_path),
        content_type='video/mp4',
        media_type=MediaType.VIDEO,
        duration=10,
    )

    response = client.get(
        f'{api_prefix}/media/{media.id}/content',
        headers={'Range': 'bytes=2-5'},
    )

    assert response.status_code == 206
    assert response.content == b'2345'
    assert response.headers['content-range'] == 'bytes 2-5/10'
