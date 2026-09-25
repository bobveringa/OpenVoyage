import uuid

import pytest

from factories.trips import add_trip_member, create_trip
from factories.users import create_user
from core.app_settings import IMMICH_ENABLED_KEY
from models.database.settings import AppSetting
from models.database.immich import TripImmichAlbum, UserImmichConnection
from services.app_settings_service import AppSettingsService
from services.immich_client import ImmichIdentity, ImmichInvalidConnectionError
from services.immich_service import ImmichConnectionConflictError, ImmichService
from services.trip_service import TripService


@pytest.mark.integration
def test_removing_member_deletes_only_their_links_for_that_trip(db_session) -> None:
    owner = create_user(db_session)
    member = create_user(db_session)
    other_owner = create_user(db_session)
    trip = create_trip(db_session, owner_id=owner.id)
    other_trip = create_trip(db_session, owner_id=other_owner.id)
    add_trip_member(db_session, trip_id=trip.id, user_id=member.id)
    add_trip_member(db_session, trip_id=other_trip.id, user_id=member.id)
    connection = UserImmichConnection(
        user_id=member.id,
        server_url='https://photos.example.com',
        immich_user_id=uuid.uuid4(),
        api_key_encrypted='v1:test',
    )
    current_link = TripImmichAlbum(
        trip_id=trip.id,
        connection_user_id=member.id,
        album_id=uuid.uuid4(),
    )
    other_link = TripImmichAlbum(
        trip_id=other_trip.id,
        connection_user_id=member.id,
        album_id=uuid.uuid4(),
    )
    db_session.add_all([connection, current_link, other_link])
    db_session.commit()
    current_link_id = current_link.id
    other_link_id = other_link.id

    TripService(db_session).remove_trip_member(
        trip_id=trip.id,
        current_user_id=owner.id,
        target_user_id=member.id,
    )

    assert db_session.get(TripImmichAlbum, current_link_id) is None
    assert db_session.get(TripImmichAlbum, other_link_id) is not None


@pytest.mark.integration
def test_connection_identity_rules_preserve_links_and_failed_saves(
    db_session,
    monkeypatch,
) -> None:
    user = create_user(db_session)
    trip = create_trip(db_session, owner_id=user.id)
    db_session.add(AppSetting(key=IMMICH_ENABLED_KEY, value=True))
    db_session.commit()
    service = ImmichService(db_session, AppSettingsService(db_session))
    first_identity = uuid.uuid4()
    candidate_identity = first_identity
    validated_keys: list[str] = []

    def validate_candidate(_server_url: str, api_key: str) -> ImmichIdentity:
        validated_keys.append(api_key)
        return ImmichIdentity(user_id=candidate_identity)

    monkeypatch.setattr(service, '_validate_candidate', validate_candidate)
    service.save_connection(
        user.id,
        'https://photos.example.com/api',
        'first-key',
    )
    link = TripImmichAlbum(
        trip_id=trip.id,
        connection_user_id=user.id,
        album_id=uuid.uuid4(),
    )
    db_session.add(link)
    db_session.commit()
    link_id = link.id

    updated = service.save_connection(
        user.id,
        'https://new-photos.example.com/',
        'rotated-key',
    )

    assert updated.server_url == 'https://new-photos.example.com'
    assert db_session.get(TripImmichAlbum, link_id) is not None
    service.test_connection(user.id, 'https://new-photos.example.com/api', '')
    assert validated_keys[-1] == 'rotated-key'

    candidate_identity = uuid.uuid4()
    with pytest.raises(ImmichConnectionConflictError):
        service.save_connection(
            user.id,
            'https://other.example.com',
            'other-key',
        )
    db_session.expire_all()
    persisted = db_session.get(UserImmichConnection, user.id)
    assert persisted is not None
    assert persisted.server_url == 'https://new-photos.example.com'

    with pytest.raises(ImmichInvalidConnectionError, match='API key is required'):
        service.save_connection(user.id, 'https://different.example.com', '')

    service.test_connection(user.id, 'https://other.example.com', 'candidate-key')
    db_session.expire_all()
    persisted = db_session.get(UserImmichConnection, user.id)
    assert persisted is not None
    assert persisted.immich_user_id == first_identity
