import uuid
from datetime import timedelta
from io import BytesIO
from pathlib import Path

import pytest
from fastapi import BackgroundTasks, UploadFile
from PIL import Image
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from core import security
from factories.locations import create_location
from factories.media import create_media
from factories.places import create_place
from factories.trips import create_trip
from factories.users import create_user
from models.database.base import utcnow
from models.database.locations import Location
from models.database.media import Media, MediaStatus
from models.database.posts import Post, PostComment, PostMedia
from models.database.trips import Trip
from services.app_settings_service import AppSettingsService
from services.media_cleanup_service import MediaCleanupService
from services.media_service import MediaService, process_media
from utils.media.storage import (
    cleanup_staging, register_active, staging_directory, storage_prefix, unregister_active,
)


def headers(user):
    token = security.create_auth_tokens(subject=user.id, email=user.email)['access_token']
    return {'Authorization': f'Bearer {token}'}


def stage_upload(db, user):
    content = BytesIO()
    exif = Image.Exif()
    exif[270] = 'private-location'
    Image.new('RGB', (80, 40), 'red').save(content, format='JPEG', exif=exif)
    content.seek(0)
    service = MediaService(db, BackgroundTasks(), AppSettingsService(db))
    return service.upload_media(UploadFile(file=content, filename='photo.jpg'), user)


@pytest.mark.integration
def test_upload_processing_polling_and_failure_lifecycle(client, db_session, api_prefix, monkeypatch):
    import services.media_service as media_module
    clean_image = media_module.clean_image

    def check_processing(source, destination, content_type):
        # A separate session must observe PROCESSING before any inspection starts.
        with Session(db_session.bind) as observer:
            assert observer.get(Media, media.id).status == MediaStatus.PROCESSING
        clean_image(source, destination, content_type)

    owner = create_user(db_session)
    other = create_user(db_session)
    media = stage_upload(db_session, owner)
    path = Path(media.storage_path)
    assert path.exists()
    assert media.status == MediaStatus.UPLOADED
    assert media.width is None
    for thumbnail in (False, True):
        signed = security.create_media_url_token(media.id)
        response = client.get(f'{api_prefix}/media/{media.id}/content', params={
            'thumbnail': thumbnail, 'media_token': signed,
        }, headers={'Range': 'bytes=0-4'})
        assert response.status_code == 409
        assert response.json() == {'detail': 'Media is not ready'}
    response = client.get(f'{api_prefix}/media/{media.id}', headers=headers(owner))
    assert response.json()['status'] == 'UPLOADED'
    assert response.json()['urls'] == {'content': None, 'thumbnail': None}
    assert response.headers['cache-control'] == 'private, no-store'
    assert client.get(f'{api_prefix}/media/{media.id}', headers=headers(other)).status_code == 404
    with monkeypatch.context() as patch:
        patch.setattr(media_module, 'clean_image', check_processing)
        process_media(media.id)
    db_session.expire_all()
    response = client.get(f'{api_prefix}/media/{media.id}', headers=headers(owner))
    assert response.json()['status'] == 'READY'
    assert response.json()['technical_info'] == {'width': 80, 'height': 40}
    assert not path.exists()
    content = client.get(response.json()['urls']['content'])
    assert content.status_code == 200
    assert b'private-location' not in content.content
    assert Path(media.thumbnail_storage_path).exists()

    broken = stage_upload(db_session, owner)
    Path(broken.storage_path).write_bytes(b'corrupt image')
    process_media(broken.id)
    db_session.expire_all()
    response = client.get(f'{api_prefix}/media/{broken.id}', headers=headers(owner))
    assert response.json()['status'] == 'FAILED'
    assert response.json()['technical_info'] is None
    assert response.json()['urls'] == {'content': None, 'thumbnail': None}
    assert not staging_directory(broken.id).exists()
    assert not list(storage_prefix(broken.id).parent.glob(str(broken.id) + '.*'))


@pytest.mark.integration
@pytest.mark.parametrize('failure_commit_unavailable', [False, True])
def test_processing_commit_failure_removes_all_files(db_session, monkeypatch, failure_commit_unavailable):
    import services.media_service as media_module
    owner = create_user(db_session)
    media = stage_upload(db_session, owner)

    class FailingSession(Session):
        def commit(self):
            for item in self.dirty:
                if isinstance(item, Media) and (
                    item.status == MediaStatus.READY
                    or (failure_commit_unavailable and item.status == MediaStatus.FAILED)
                ):
                    raise RuntimeError('Database unavailable')
            return super().commit()

    monkeypatch.setattr(media_module, 'Session', FailingSession)
    if failure_commit_unavailable:
        with pytest.raises(RuntimeError, match='Database unavailable'):
            process_media(media.id)
    else:
        process_media(media.id)
    assert not staging_directory(media.id).exists()
    assert not list(storage_prefix(media.id).parent.glob(str(media.id) + '.*'))
    db_session.expire_all()
    assert media.status == (MediaStatus.PROCESSING if failure_commit_unavailable else MediaStatus.FAILED)
    MediaCleanupService(db_session).recover_interrupted()
    assert media.status == MediaStatus.FAILED


@pytest.mark.integration
def test_processing_failure_diagnostics_do_not_log_source_metadata(db_session, monkeypatch, caplog):
    import services.media_service as media_module
    owner = create_user(db_session)
    media = stage_upload(db_session, owner)

    def fail_cleaning(*args):
        raise ValueError('private-camera-location-52.37-4.90')

    monkeypatch.setattr(media_module, 'clean_image', fail_cleaning)
    process_media(media.id)
    assert 'media_processing_failed' in caplog.text
    assert f'media_id={media.id} stage=clean reason=ValueError' in caplog.text
    assert 'private-camera-location' not in caplog.text
    db_session.expire_all()
    assert media.status == MediaStatus.FAILED


@pytest.mark.integration
def test_startup_recovers_waiting_active_and_unrecorded_files(db_session):
    owner = create_user(db_session)
    waiting = stage_upload(db_session, owner)
    active = stage_upload(db_session, owner)
    failed = stage_upload(db_session, owner)
    active.status = MediaStatus.PROCESSING
    failed.status = MediaStatus.FAILED
    db_session.commit()
    for media in (waiting, active, failed):
        unregister_active(media.id)  # Simulate loss of process-local state on crash.
    prefix = storage_prefix(active.id)
    prefix.parent.mkdir(parents=True, exist_ok=True)
    promoted = prefix.with_suffix('.jpg')
    promoted.write_bytes(b'clean output before READY commit')
    lost_id = uuid.uuid4()
    directory = staging_directory(lost_id)
    directory.mkdir(parents=True)
    (directory / 'download').write_bytes(b'unclean Immich download without a media row')
    MediaCleanupService(db_session).recover_interrupted()
    assert waiting.status == active.status == failed.status == MediaStatus.FAILED
    assert not promoted.exists()
    assert not any(staging_directory(media_id).exists() for media_id in (waiting.id, active.id, failed.id, lost_id))


@pytest.mark.integration
def test_runtime_cleanup_preserves_work_without_records():
    media_id = uuid.uuid4()
    register_active(media_id)
    directory = staging_directory(media_id)
    directory.mkdir(parents=True)
    (directory / 'download').write_bytes(b'active download')
    try:
        assert cleanup_staging(cutoff=utcnow() + timedelta(days=1)) == 0
        assert directory.exists()
    finally:
        unregister_active(media_id)
    assert cleanup_staging(cutoff=utcnow() + timedelta(days=1)) == 1
    assert not directory.exists()


@pytest.mark.integration
@pytest.mark.parametrize('media_status', [MediaStatus.UPLOADED, MediaStatus.PROCESSING, MediaStatus.FAILED])
@pytest.mark.parametrize('endpoint', ['create_post', 'update_post', 'publish', 'comment', 'create_trip', 'update_trip', 'profile'])
def test_all_attachment_endpoints_reject_nonready_without_writes(
    client, db_session, api_prefix, media_status, endpoint,
):
    owner = create_user(db_session, username='traveller')
    trip = create_trip(db_session, owner_id=owner.id)
    location = create_location(db_session, trip_id=trip.id, created_by=owner.id)
    post = Post(trip_id=trip.id, author_user_id=owner.id, location_id=location.id,
                title='Original', body='Original', published_at=utcnow() if endpoint == 'comment' else None)
    db_session.add(post)
    db_session.commit()
    media = create_media(db_session, storage_path='unused.jpg', created_by=owner.id, status=media_status)
    place = create_place(db_session)
    if endpoint == 'publish':
        db_session.add(PostMedia(post_id=post.id, media_id=media.id, sort_order=0))
        db_session.commit()
    before = {model: db_session.scalar(select(func.count()).select_from(model))
              for model in (Post, Location, PostComment, Trip)}
    post_path = f'{api_prefix}/trips/{trip.id}/posts'
    request_headers = {**headers(owner), 'If-Match': f'"{post.revision}"'}
    requests = {
        'create_post': ('POST', post_path, {'title': 'Changed', 'body': 'Changed',
            'location': {'place_id': str(place.id)}, 'occurred_at': utcnow().isoformat(),
            'media_ids': [str(media.id)], 'publish': False}),
        'update_post': ('PATCH', f'{post_path}/{post.id}', {'title': 'Changed', 'media_ids': [str(media.id)]}),
        'publish': ('POST', f'{post_path}/{post.id}/publish', None),
        'comment': ('POST', f'{post_path}/{post.id}/comments', {'body': 'Changed', 'media_id': str(media.id)}),
        'create_trip': ('POST', f'{api_prefix}/trips', {'name': 'Changed', 'media_id': str(media.id),
            'visibility': 'PRIVATE', 'start_date': '2026-10-07'}),
        'update_trip': ('PATCH', f'{api_prefix}/trips/{trip.id}', {'name': 'Changed', 'media_id': str(media.id)}),
        'profile': ('PATCH', f'{api_prefix}/users/me', {'first_name': 'Changed', 'profile_picture_media_id': str(media.id)}),
    }
    method, path, payload = requests[endpoint]
    response = client.request(method, path, headers=request_headers, json=payload)
    assert response.status_code == 409, response.text
    assert response.json() == {'detail': {'code': 'MEDIA_NOT_READY', 'media_ids': [str(media.id)]}}
    assert not db_session.new and not db_session.dirty
    assert post.title == 'Original'
    assert trip.name == 'Trip'
    assert owner.profile.first_name != 'Changed'
    for model, count in before.items():
        assert db_session.scalar(select(func.count()).select_from(model)) == count
