from __future__ import annotations

from pathlib import Path
from urllib.parse import parse_qs, urlsplit, urlunsplit

import pytest

from core import security
from factories.locations import create_location
from factories.media import create_media
from factories.trips import create_trip
from factories.users import create_user
from models.database.base import utcnow
from models.database.media import MediaStatus, MediaType
from models.database.posts import Post, PostMedia
from models.database.trips import TripVisibility
from services.trip_access import SHARE_TOKEN_HEADER


def _auth_headers(user) -> dict[str, str]:
    tokens = security.create_auth_tokens(subject=user.id, email=user.email)
    return {'Authorization': f'Bearer {tokens["access_token"]}'}


def _path_and_query(url: str) -> str:
    parts = urlsplit(url)
    return urlunsplit(('', '', parts.path, parts.query, ''))


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
    user = create_user(db_session, password='MediaPass123!')
    tokens = security.create_auth_tokens(subject=user.id, email=user.email)
    media = create_media(
        db_session,
        storage_path='media/cover.jpg',
        thumbnail_content_type=None,
        created_by=user.id,
    )
    media.status = MediaStatus.UPLOADED
    media.thumbnail_storage_path = None
    db_session.add(media)
    db_session.commit()

    response = client.get(
        f'{api_prefix}/media/{media.id}/content?thumbnail=true',
        headers={'Authorization': f'Bearer {tokens["access_token"]}'},
    )

    assert response.status_code == 409


@pytest.mark.integration
def test_get_video_content_supports_range(
    client, db_session, api_prefix, tmp_path
) -> None:
    user = create_user(db_session, password='MediaPass123!')
    tokens = security.create_auth_tokens(subject=user.id, email=user.email)
    video_path = tmp_path / 'clip.mp4'
    video_path.write_bytes(b'0123456789')
    media = create_media(
        db_session,
        storage_path=str(video_path),
        content_type='video/mp4',
        media_type=MediaType.VIDEO,
        duration=10,
        created_by=user.id,
    )

    response = client.get(
        f'{api_prefix}/media/{media.id}/content',
        headers={
            'Authorization': f'Bearer {tokens["access_token"]}',
            'Range': 'bytes=2-5',
        },
    )

    assert response.status_code == 206
    assert response.content == b'2345'
    assert response.headers['content-range'] == 'bytes 2-5/10'


@pytest.mark.integration
def test_get_unattached_media_requires_owner(
    client, db_session, api_prefix, tmp_path
) -> None:
    user = create_user(db_session, password='MediaPass123!')
    tokens = security.create_auth_tokens(subject=user.id, email=user.email)
    image_path = tmp_path / 'private.jpg'
    image_path.write_bytes(b'private image')
    media = create_media(db_session, storage_path=str(image_path), created_by=user.id)

    anonymous_response = client.get(f'{api_prefix}/media/{media.id}/content')
    owner_response = client.get(
        f'{api_prefix}/media/{media.id}/content',
        headers={'Authorization': f'Bearer {tokens["access_token"]}'},
    )

    assert anonymous_response.status_code == 404
    assert owner_response.status_code == 200
    assert owner_response.content == b'private image'


@pytest.mark.integration
def test_get_profile_picture_media_is_public(
    client, db_session, api_prefix, tmp_path
) -> None:
    user = create_user(db_session, username='traveler')
    image_path = tmp_path / 'avatar.jpg'
    image_path.write_bytes(b'avatar image')
    media = create_media(db_session, storage_path=str(image_path), created_by=user.id)
    user.profile.profile_picture_media_id = media.id
    db_session.add(user.profile)
    db_session.commit()

    response = client.get(f'{api_prefix}/media/{media.id}/content')

    assert response.status_code == 200
    assert response.content == b'avatar image'


@pytest.mark.integration
def test_get_public_trip_cover_media_is_public(
    client, db_session, api_prefix, tmp_path
) -> None:
    owner = create_user(db_session)
    image_path = tmp_path / 'cover.jpg'
    image_path.write_bytes(b'public cover')
    media = create_media(db_session, storage_path=str(image_path), created_by=owner.id)
    trip = create_trip(
        db_session,
        owner_id=owner.id,
        visibility=TripVisibility.PUBLIC,
    )
    trip.cover_media_id = media.id
    db_session.add(trip)
    db_session.commit()

    response = client.get(f'{api_prefix}/media/{media.id}/content')

    assert response.status_code == 200
    assert response.content == b'public cover'


@pytest.mark.integration
def test_get_private_trip_cover_media_requires_member(
    client, db_session, api_prefix, tmp_path
) -> None:
    owner = create_user(db_session, password='MediaPass123!')
    tokens = security.create_auth_tokens(subject=owner.id, email=owner.email)
    image_path = tmp_path / 'cover.jpg'
    image_path.write_bytes(b'private cover')
    media = create_media(db_session, storage_path=str(image_path), created_by=owner.id)
    trip = create_trip(
        db_session,
        owner_id=owner.id,
        visibility=TripVisibility.PRIVATE,
    )
    trip.cover_media_id = media.id
    db_session.add(trip)
    db_session.commit()

    anonymous_response = client.get(f'{api_prefix}/media/{media.id}/content')
    member_response = client.get(
        f'{api_prefix}/media/{media.id}/content',
        headers={'Authorization': f'Bearer {tokens["access_token"]}'},
    )

    assert anonymous_response.status_code == 404
    assert member_response.status_code == 200
    assert member_response.content == b'private cover'


@pytest.mark.integration
def test_trip_list_returns_signed_private_cover_url_that_loads_without_auth(
    client, db_session, api_prefix, tmp_path
) -> None:
    owner = create_user(db_session, password='MediaPass123!')
    image_path = tmp_path / 'signed-cover.jpg'
    image_path.write_bytes(b'signed private cover')
    media = create_media(db_session, storage_path=str(image_path), created_by=owner.id)
    trip = create_trip(
        db_session,
        owner_id=owner.id,
        visibility=TripVisibility.PRIVATE,
    )
    trip.cover_media_id = media.id
    db_session.add(trip)
    db_session.commit()

    list_response = client.get(
        f'{api_prefix}/trips?user_id={owner.id}',
        headers=_auth_headers(owner),
    )
    content_url = list_response.json()['items'][0]['cover_media']['urls']['content']
    query = parse_qs(urlsplit(content_url).query)

    content_response = client.get(_path_and_query(content_url))

    assert list_response.status_code == 200
    assert 'media_token' in query
    assert content_response.status_code == 200
    assert content_response.content == b'signed private cover'


@pytest.mark.integration
def test_signed_private_video_url_supports_range_without_auth(
    client, db_session, api_prefix, tmp_path
) -> None:
    owner = create_user(db_session, password='MediaPass123!')
    video_path = tmp_path / 'signed-clip.mp4'
    video_path.write_bytes(b'0123456789')
    media = create_media(
        db_session,
        storage_path=str(video_path),
        content_type='video/mp4',
        media_type=MediaType.VIDEO,
        duration=10,
        created_by=owner.id,
    )
    trip = create_trip(
        db_session,
        owner_id=owner.id,
        visibility=TripVisibility.PRIVATE,
    )
    trip.cover_media_id = media.id
    db_session.add(trip)
    db_session.commit()

    list_response = client.get(
        f'{api_prefix}/trips?user_id={owner.id}',
        headers=_auth_headers(owner),
    )
    content_url = list_response.json()['items'][0]['cover_media']['urls']['content']
    content_response = client.get(
        _path_and_query(content_url),
        headers={'Range': 'bytes=2-5'},
    )

    assert list_response.status_code == 200
    assert content_response.status_code == 206
    assert content_response.content == b'2345'
    assert content_response.headers['content-range'] == 'bytes 2-5/10'


@pytest.mark.integration
def test_shared_trip_cover_media_url_uses_media_token(
    client, db_session, api_prefix, tmp_path
) -> None:
    owner = create_user(db_session, password='MediaPass123!')
    image_path = tmp_path / 'share-cover.jpg'
    image_path.write_bytes(b'shared cover')
    media = create_media(db_session, storage_path=str(image_path), created_by=owner.id)
    trip = create_trip(
        db_session,
        owner_id=owner.id,
        visibility=TripVisibility.PRIVATE,
    )
    trip.cover_media_id = media.id
    db_session.add(trip)
    db_session.commit()
    link_response = client.post(
        f'{api_prefix}/trips/{trip.id}/share-links',
        headers=_auth_headers(owner),
        json={'label': 'Cover'},
    )
    token = link_response.json()['token']

    trip_response = client.get(
        f'{api_prefix}/trips/{trip.id}',
        headers={SHARE_TOKEN_HEADER: token},
    )
    content_url = trip_response.json()['cover_media']['urls']['content']
    query = parse_qs(urlsplit(content_url).query)

    response = client.get(_path_and_query(content_url))
    direct_share_response = client.get(
        f'{api_prefix}/media/{media.id}/content?share_token={token}'
    )

    assert link_response.status_code == 201
    assert trip_response.status_code == 200
    assert 'media_token' in query
    assert 'share_token' not in query
    assert response.status_code == 200
    assert response.content == b'shared cover'
    assert direct_share_response.status_code == 404


@pytest.mark.integration
def test_get_public_trip_post_media_requires_published_post(
    client, db_session, api_prefix, tmp_path
) -> None:
    owner = create_user(db_session)
    trip = create_trip(
        db_session,
        owner_id=owner.id,
        visibility=TripVisibility.PUBLIC,
    )
    location = create_location(db_session, trip_id=trip.id, created_by=owner.id)
    image_path = tmp_path / 'post.jpg'
    image_path.write_bytes(b'published post image')
    media = create_media(db_session, storage_path=str(image_path), created_by=owner.id)
    draft_path = tmp_path / 'draft.jpg'
    draft_path.write_bytes(b'draft post image')
    draft_media = create_media(
        db_session,
        storage_path=str(draft_path),
        created_by=owner.id,
    )

    published_post = Post(
        trip_id=trip.id,
        author_user_id=owner.id,
        location_id=location.id,
        body='Published post',
        occurred_at=utcnow(),
        published_at=utcnow(),
    )
    draft_post = Post(
        trip_id=trip.id,
        author_user_id=owner.id,
        location_id=location.id,
        body='Draft post',
        occurred_at=utcnow(),
        published_at=None,
    )
    db_session.add_all([published_post, draft_post])
    db_session.flush()
    db_session.add_all(
        [
            PostMedia(post_id=published_post.id, media_id=media.id, sort_order=0),
            PostMedia(post_id=draft_post.id, media_id=draft_media.id, sort_order=0),
        ]
    )
    db_session.commit()

    published_response = client.get(f'{api_prefix}/media/{media.id}/content')
    draft_response = client.get(f'{api_prefix}/media/{draft_media.id}/content')

    assert published_response.status_code == 200
    assert published_response.content == b'published post image'
    assert draft_response.status_code == 404


@pytest.mark.integration
def test_shared_trip_post_media_url_uses_media_token_for_published_posts(
    client, db_session, api_prefix, tmp_path
) -> None:
    owner = create_user(db_session, password='MediaPass123!')
    trip = create_trip(
        db_session,
        owner_id=owner.id,
        visibility=TripVisibility.PRIVATE,
    )
    location = create_location(db_session, trip_id=trip.id, created_by=owner.id)
    published_path = tmp_path / 'share-post.jpg'
    published_path.write_bytes(b'shared published post image')
    media = create_media(
        db_session,
        storage_path=str(published_path),
        created_by=owner.id,
    )
    draft_path = tmp_path / 'share-draft.jpg'
    draft_path.write_bytes(b'shared draft post image')
    draft_media = create_media(
        db_session,
        storage_path=str(draft_path),
        created_by=owner.id,
    )
    published_post = Post(
        trip_id=trip.id,
        author_user_id=owner.id,
        location_id=location.id,
        body='Published post',
        occurred_at=utcnow(),
        published_at=utcnow(),
    )
    draft_post = Post(
        trip_id=trip.id,
        author_user_id=owner.id,
        location_id=location.id,
        body='Draft post',
        occurred_at=utcnow(),
        published_at=None,
    )
    db_session.add_all([published_post, draft_post])
    db_session.flush()
    db_session.add_all(
        [
            PostMedia(post_id=published_post.id, media_id=media.id, sort_order=0),
            PostMedia(post_id=draft_post.id, media_id=draft_media.id, sort_order=0),
        ]
    )
    db_session.commit()
    link_response = client.post(
        f'{api_prefix}/trips/{trip.id}/share-links',
        headers=_auth_headers(owner),
        json={'label': 'Media'},
    )
    token = link_response.json()['token']

    posts_response = client.get(
        f'{api_prefix}/trips/{trip.id}/posts',
        headers={SHARE_TOKEN_HEADER: token},
    )
    content_url = posts_response.json()['items'][0]['media'][0]['urls']['content']
    query = parse_qs(urlsplit(content_url).query)

    published_response = client.get(_path_and_query(content_url))
    direct_share_response = client.get(
        f'{api_prefix}/media/{media.id}/content?share_token={token}'
    )
    draft_response = client.get(f'{api_prefix}/media/{draft_media.id}/content')

    assert link_response.status_code == 201
    assert posts_response.status_code == 200
    assert posts_response.json()['total'] == 1
    assert 'media_token' in query
    assert 'share_token' not in query
    assert published_response.status_code == 200
    assert published_response.content == b'shared published post image'
    assert direct_share_response.status_code == 404
    assert draft_response.status_code == 404
