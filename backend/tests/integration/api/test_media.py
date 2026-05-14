from __future__ import annotations

from pathlib import Path

import pytest

from core import security
from factories.users import create_user


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
    monkeypatch.setattr(
        media_service.MediaService, '_create_thumbnail', lambda *_args, **_kwargs: None
    )

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
