from __future__ import annotations

from io import BytesIO
import uuid

import pytest
from fastapi import UploadFile

from models.database.media import MediaType
from models.database.user import User
from services.media_service import (
    MediaService,
    MediaTooLargeError,
    detect_content_type,
)


@pytest.mark.unit
def test_detect_content_type_resets_stream(monkeypatch) -> None:
    upload = UploadFile(filename='file.bin', file=BytesIO(b'abcdef'))

    class Match:
        mime_type = 'image/jpeg'

    import services.media_service as media_service_module

    monkeypatch.setattr(
        media_service_module.puremagic, 'magic_stream', lambda _stream: [Match()]
    )

    upload.file.seek(3)
    content_type = detect_content_type(upload)

    assert content_type == 'image/jpeg'
    assert upload.file.tell() == 0


@pytest.mark.unit
def test_upload_media_rejects_large_file(
    fake_db, fake_background_tasks, monkeypatch
) -> None:
    upload = UploadFile(filename='huge.jpg', file=BytesIO(b'data'))
    upload.size = 999

    from core.config import settings

    monkeypatch.setattr(settings, 'MAX_MEDIA_SIZE', 100)

    service = MediaService(db=fake_db, background_tasks=fake_background_tasks)

    with pytest.raises(MediaTooLargeError):
        service.upload_media(
            upload, User(id=uuid.uuid4(), email='u@example.com', password_hash='x')
        )


@pytest.mark.unit
def test_upload_media_success_schedules_thumbnail(
    fake_db, fake_background_tasks, monkeypatch, tmp_path
) -> None:
    upload = UploadFile(filename='photo.jpg', file=BytesIO(b'test-bytes'))
    upload.size = 9

    from core.config import settings
    import services.media_service as media_service_module

    monkeypatch.setattr(settings, 'MAX_MEDIA_SIZE', 100)
    monkeypatch.setattr(
        media_service_module, 'detect_content_type', lambda _f: 'image/jpeg'
    )
    monkeypatch.setattr(
        media_service_module, '_extract_media_info', lambda _p, _t: (640, 480, None)
    )

    media_id = uuid.uuid4()
    monkeypatch.setattr(media_service_module.uuid, 'uuid4', lambda: media_id)
    monkeypatch.setattr(
        media_service_module,
        'get_media_storage_path',
        lambda _media_id: str(tmp_path / 'aa' / 'bb' / _media_id.hex),
    )

    service = MediaService(db=fake_db, background_tasks=fake_background_tasks)
    user = User(id=uuid.uuid4(), email='u@example.com', password_hash='x')

    media = service.upload_media(upload, user)

    assert media.id == media_id
    assert media.media_type == MediaType.IMAGE
    assert media.width == 640
    assert media.height == 480
    fake_db.add.assert_called()
    fake_db.commit.assert_called_once()
    fake_background_tasks.add_task.assert_called_once()
