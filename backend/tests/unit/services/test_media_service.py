from __future__ import annotations

from io import BytesIO
import uuid
from unittest.mock import Mock

import pytest
from fastapi import UploadFile

from models.database.media import MediaType
from models.database.user import User
from services.media_service import (
    MediaService,
    MediaTooLargeError,
    copy_upload_file,
    detect_content_type,
)
from services.app_settings_service import AppSettingsService


def _app_settings_service(max_upload_size_mb: int = 1):
    service = Mock(spec=AppSettingsService)
    service.get_value.return_value = max_upload_size_mb
    return service


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
    upload.size = 2_000_000

    app_settings = _app_settings_service(max_upload_size_mb=1)
    service = MediaService(
        db=fake_db,
        background_tasks=fake_background_tasks,
        app_settings_service=app_settings,
    )

    with pytest.raises(MediaTooLargeError):
        service.upload_media(
            upload, User(id=uuid.uuid4(), email='u@example.com', password_hash='x')
        )
    app_settings.get_value.assert_called_once_with('media.max_upload_size_mb')


@pytest.mark.unit
def test_copy_upload_file_rejects_stream_over_limit(tmp_path) -> None:
    upload = UploadFile(filename='huge.jpg', file=BytesIO(b'abcdef'))

    with pytest.raises(MediaTooLargeError):
        copy_upload_file(upload, str(tmp_path / 'huge.jpg'), max_size=3)


@pytest.mark.unit
def test_upload_media_success_schedules_thumbnail(
    fake_db, fake_background_tasks, monkeypatch, tmp_path
) -> None:
    upload = UploadFile(filename='photo.jpg', file=BytesIO(b'test-bytes'))
    upload.size = 9

    import services.media_service as media_service_module

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

    service = MediaService(
        db=fake_db,
        background_tasks=fake_background_tasks,
        app_settings_service=_app_settings_service(),
    )
    user = User(id=uuid.uuid4(), email='u@example.com', password_hash='x')

    media = service.upload_media(upload, user)

    assert media.id == media_id
    assert media.media_type == MediaType.IMAGE
    assert media.width == 640
    assert media.height == 480
    fake_db.add.assert_called()
    fake_db.commit.assert_called_once()
    task, media_arg, path_arg = fake_background_tasks.add_task.call_args.args
    assert task is media_service_module.create_thumbnail
    assert media_arg == media_id
    assert path_arg.endswith('.jpg')
