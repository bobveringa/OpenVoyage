from __future__ import annotations

import uuid
from datetime import date
from unittest.mock import Mock

import pytest

from models.api.trips import TripCreateRequest
from models.database.media import Media, MediaStatus, MediaStorageBackend, MediaType
from models.database.trips import Trip, TripMember, TripVisibility
from services.trip_service import (
    CoverMediaAlreadyUsedError,
    CoverMediaOwnershipError,
    TripService,
)


@pytest.mark.unit
def test_create_trip_rejects_media_not_owned_by_user(fake_db: Mock) -> None:
    owner_id = uuid.uuid4()
    another_user_id = uuid.uuid4()
    media_id = uuid.uuid4()

    fake_db.get.return_value = Media(
        id=media_id,
        storage_path='media.jpg',
        thumbnail_storage_path='media.thumb.webp',
        media_type=MediaType.IMAGE,
        content_type='image/jpeg',
        thumbnail_content_type='image/webp',
        caption='',
        status=MediaStatus.READY,
        storage_backend=MediaStorageBackend.LOCAL,
        created_by=owner_id,
        width=100,
        height=100,
        duration=None,
    )

    service = TripService(db=fake_db)
    payload = TripCreateRequest(
        name='Summer',
        description='Summer trip',
        media_id=media_id,
        visibility=TripVisibility.PRIVATE,
        start_date=date(2026, 7, 1),
    )

    with pytest.raises(CoverMediaOwnershipError):
        service.create_trip(payload=payload, current_user_id=another_user_id)


@pytest.mark.unit
def test_create_trip_success_creates_trip_and_owner_membership(fake_db: Mock) -> None:
    user_id = uuid.uuid4()
    media_id = uuid.uuid4()

    fake_db.get.return_value = Media(
        id=media_id,
        storage_path='media.jpg',
        thumbnail_storage_path='media.thumb.webp',
        media_type=MediaType.IMAGE,
        content_type='image/jpeg',
        thumbnail_content_type='image/webp',
        caption='',
        status=MediaStatus.READY,
        storage_backend=MediaStorageBackend.LOCAL,
        created_by=user_id,
        width=100,
        height=100,
        duration=None,
    )
    fake_db.execute.return_value.scalar_one_or_none.return_value = None

    service = TripService(db=fake_db)
    payload = TripCreateRequest(
        name='Summer',
        description='Beach',
        media_id=media_id,
        start_date=date(2026, 7, 1),
    )

    trip = service.create_trip(payload=payload, current_user_id=user_id)

    assert isinstance(trip, Trip)
    assert trip.cover_media_id == media_id
    assert trip.start_date == date(2026, 7, 1)
    assert fake_db.add.call_count == 2
    added_trip, added_member = [args[0][0] for args in fake_db.add.call_args_list]
    assert isinstance(added_trip, Trip)
    assert isinstance(added_member, TripMember)
    assert added_member.user_id == user_id
    fake_db.flush.assert_called_once()
    fake_db.commit.assert_called_once()
    fake_db.refresh.assert_called_once_with(trip)


@pytest.mark.unit
def test_create_trip_rejects_media_already_used_as_cover(fake_db: Mock) -> None:
    user_id = uuid.uuid4()
    media_id = uuid.uuid4()

    fake_db.get.return_value = Media(
        id=media_id,
        storage_path='media.jpg',
        thumbnail_storage_path='media.thumb.webp',
        media_type=MediaType.IMAGE,
        content_type='image/jpeg',
        thumbnail_content_type='image/webp',
        caption='',
        status=MediaStatus.READY,
        storage_backend=MediaStorageBackend.LOCAL,
        created_by=user_id,
        width=100,
        height=100,
        duration=None,
    )
    fake_db.execute.return_value.scalar_one_or_none.return_value = uuid.uuid4()

    service = TripService(db=fake_db)
    payload = TripCreateRequest(
        name='Summer',
        description='Beach',
        media_id=media_id,
        start_date=date(2026, 7, 1),
    )

    with pytest.raises(CoverMediaAlreadyUsedError):
        service.create_trip(payload=payload, current_user_id=user_id)

    fake_db.add.assert_not_called()
