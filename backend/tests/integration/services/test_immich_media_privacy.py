import uuid
from contextlib import contextmanager
from io import BytesIO
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi import BackgroundTasks
from PIL import Image

from factories.users import create_user
from services.app_settings_service import AppSettingsService
from services.immich_service import ImmichService
from services.immich_client import ImmichUnavailableError
from services.media_service import MediaService, process_media
from utils.media.storage import staging_directory


def image_bytes():
    source = BytesIO()
    exif = Image.Exif()
    exif[270] = 'private-location'
    Image.new('RGB', (80, 40), 'red').save(source, format='JPEG', exif=exif)
    return source.getvalue()


def service_with_client(db, monkeypatch, client):
    service = ImmichService(db, AppSettingsService(db),
        MediaService(db, BackgroundTasks(), AppSettingsService(db)))
    monkeypatch.setattr(service, '_require_enabled', lambda: None)
    monkeypatch.setattr(service, '_asset_context', lambda *a: (SimpleNamespace(album_id=uuid.uuid4()), client))
    monkeypatch.setattr(service, '_recheck_import_access', lambda *a: None)
    return service


@pytest.mark.integration
def test_picker_previews_are_clean_and_fail_closed(db_session, monkeypatch):
    content = image_bytes()
    client = SimpleNamespace(
        get_asset=lambda *a: SimpleNamespace(media_type='IMAGE'),
        get_media_bytes=lambda *a, **k: (content, 'image/jpeg'),
    )
    service = service_with_client(db_session, monkeypatch, client)
    ids = [uuid.uuid4() for _ in range(4)]
    for display in (False, True):
        result = service.get_asset_media(*ids, display=display)
        assert result.content_type == 'image/jpeg'
        assert b'private-location' not in result.content
        with Image.open(BytesIO(result.content)) as image:
            assert not image.getexif()
    content = b'not an image'
    with pytest.raises(ImmichUnavailableError, match='could not be cleaned'):
        service.get_asset_media(*ids, display=True)


@pytest.mark.integration
def test_import_download_and_original_use_managed_staging(db_session, monkeypatch):
    owner = create_user(db_session)
    content = image_bytes()
    @contextmanager
    def open_media(*a, **k):
        yield BytesIO(content)
    client = SimpleNamespace(
        get_asset=lambda *a: SimpleNamespace(media_type='IMAGE', original_mime_type='image/jpeg'),
        open_media=open_media,
    )
    service = service_with_client(db_session, monkeypatch, client)
    media = service.import_asset(uuid.uuid4(), uuid.uuid4(), uuid.uuid4(), owner)
    assert media.status == 'UPLOADED'
    directory = staging_directory(media.id)
    assert Path(media.storage_path).parent == directory
    assert [file.name for file in directory.iterdir()] == ['original.jpg']
    process_media(media.id)
    db_session.expire_all()
    assert media.status == 'READY'
    assert not directory.exists()
    assert b'private-location' not in Path(media.storage_path).read_bytes()
