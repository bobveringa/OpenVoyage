"""Deleting users who own trips or created content in shared trips."""

from __future__ import annotations

import uuid
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import pytest
from psycopg.errors import LockNotAvailable
from sqlalchemy import select, text
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import Session

from core import security
from core.config import settings
from factories.media import create_media
from factories.places import create_place
from factories.trips import add_trip_member, add_trip_viewer, create_trip
from factories.users import create_user
from models.api.admin import AdminUserUpdateRequest
from models.database.gps_tracking import GpsTrackingSession, GpsTrackSample
from models.database.itinerary import ItineraryStop
from models.database.locations import Location
from models.database.media import Media
from models.database.posts import Post, PostComment, PostLike, PostMedia
from models.database.trips import (
    Trip,
    TripMember,
    TripRole,
    TripShareLink,
    TripViewer,
    TripVisibility,
)
from models.database.user import User, UserRole
from services.admin_user_service import (
    AdminUserProtectedActionError,
    AdminUserService,
)
from services.trip_access import hash_share_token
from services.trip_service import TripService

OCCURRED_AT = '2026-06-29T10:30:00+00:00'


def _auth_headers(user: User, *, etag: str | None = None) -> dict[str, str]:
    tokens = security.create_auth_tokens(
        subject=user.id,
        email=user.email,
        auth_version=user.auth_version,
    )
    headers = {'Authorization': f'Bearer {tokens["access_token"]}'}
    if etag is not None:
        headers['If-Match'] = etag
    return headers


def _admin(db_session) -> User:
    return create_user(
        db_session,
        email='admin@example.com',
        role=UserRole.ADMIN,
        username='admin-user',
    )


def _delete(client, api_prefix, admin, user, **params):
    return client.delete(
        f'{api_prefix}/admin/users/{user.id}',
        headers=_auth_headers(admin),
        params=params,
    )


def _membership(db_session, trip_id, user_id) -> TripMember | None:
    return db_session.execute(
        select(TripMember).where(
            TripMember.trip_id == trip_id, TripMember.user_id == user_id
        )
    ).scalar_one_or_none()


def _create_post(client, api_prefix, db_session, *, author, trip, title) -> uuid.UUID:
    response = client.post(
        f'{api_prefix}/trips/{trip.id}/posts',
        headers=_auth_headers(author),
        json={
            'title': title,
            'body': title,
            'location': {'place_id': str(create_place(db_session).id)},
            'occurred_at': OCCURRED_AT,
            'publish': True,
        },
    )
    assert response.status_code == 201
    return uuid.UUID(response.json()['id'])


def _create_photo(db_session, tmp_path: Path, *, owner: User, post_ids=()) -> Media:
    path = tmp_path / f'{uuid.uuid4()}.jpg'
    path.write_bytes(b'photo')
    thumbnail = tmp_path / f'{path.name}.thumb.webp'
    thumbnail.write_bytes(b'thumbnail')
    media = create_media(
        db_session,
        storage_path=str(path),
        thumbnail_storage_path=str(thumbnail),
        created_by=owner.id,
    )
    for post_id in post_ids:
        db_session.add(PostMedia(post_id=post_id, media_id=media.id))
    db_session.commit()
    return media


def _create_track(db_session, *, trip: Trip, recorder: User) -> GpsTrackingSession:
    recorded_at = datetime(2026, 6, 29, 10, 30, tzinfo=timezone.utc)
    session = GpsTrackingSession(
        id=uuid.uuid4(),
        trip_id=trip.id,
        recorded_by_user_id=recorder.id,
        started_at=recorded_at,
        ended_at=recorded_at,
    )
    db_session.add(session)
    db_session.flush()
    db_session.add(
        GpsTrackSample(
            id=uuid.uuid4(),
            trip_id=trip.id,
            session_id=session.id,
            recorded_at=recorded_at,
            latitude=35.0,
            longitude=135.0,
        )
    )
    db_session.commit()
    return session


def _comment(
    db_session, *, post_id: uuid.UUID, author: User, parent: PostComment | None = None
) -> PostComment:
    comment = PostComment(
        post_id=post_id,
        user_id=author.id,
        body='Nice',
        depth=parent.depth + 1 if parent else 0,
        parent_comment_id=parent.id if parent else None,
    )
    db_session.add(comment)
    db_session.commit()
    return comment


def _track_sample_count(db_session, session_id: uuid.UUID) -> int:
    return len(
        db_session.scalars(
            select(GpsTrackSample).where(GpsTrackSample.session_id == session_id)
        ).all()
    )


@pytest.mark.integration
def test_deletion_impact_counts_what_is_deleted(
    client, db_session, api_prefix, tmp_path
) -> None:
    admin = _admin(db_session)
    target = create_user(db_session, email='target@example.com', username='target')
    co_owner = create_user(db_session, email='co@example.com', username='co-owner')
    friend = create_user(db_session, email='friend@example.com', username='friend')
    reader = create_user(db_session, email='reader@example.com', username='reader')
    solo = create_trip(db_session, owner_id=target.id, name='Solo')
    family = create_trip(db_session, owner_id=target.id, name='Family')
    add_trip_member(db_session, trip_id=family.id, user_id=friend.id)
    viewed = create_trip(db_session, owner_id=target.id, name='Viewed')
    add_trip_viewer(db_session, trip_id=viewed.id, user_id=reader.id, created_by=target.id)
    co_owned = create_trip(db_session, owner_id=co_owner.id, name='Co-owned')
    add_trip_member(
        db_session, trip_id=co_owned.id, user_id=target.id, role=TripRole.OWNER
    )
    joined = create_trip(db_session, owner_id=co_owner.id, name='Joined')
    add_trip_member(db_session, trip_id=joined.id, user_id=target.id)
    create_trip(db_session, owner_id=co_owner.id, name='Unrelated')
    solo_post, _, joined_post = (
        _create_post(
            client, api_prefix, db_session, author=target, trip=trip, title=trip.name
        )
        for trip in (solo, co_owned, joined)
    )
    _create_track(db_session, trip=co_owned, recorder=target)
    _create_track(db_session, trip=solo, recorder=target)
    others_post = _create_post(
        client, api_prefix, db_session, author=co_owner, trip=co_owned, title='Theirs'
    )
    # Counted once, although it is in two posts.
    _create_photo(db_session, tmp_path, owner=target, post_ids=[others_post, joined_post])
    _create_photo(db_session, tmp_path, owner=target, post_ids=[joined_post])
    co_owned.cover_media_id = _create_photo(db_session, tmp_path, owner=target).id
    # Goes with its trip either way, so it isn't counted.
    _create_photo(db_session, tmp_path, owner=target, post_ids=[solo_post])
    _create_photo(db_session, tmp_path, owner=co_owner, post_ids=[others_post])

    response = client.get(
        f'{api_prefix}/admin/users/{target.id}/deletion-impact',
        headers=_auth_headers(admin),
    )

    assert response.status_code == 200
    assert response.json() == {
        'user_id': str(target.id),
        'deleted_trip_count': 3,
        'deleted_shared_trip_count': 2,
        'remaining_post_count': 2,
        'comments_on_remaining_posts_count': 0,
        'likes_on_remaining_posts_count': 0,
        'remaining_track_count': 1,
        'remaining_media_count': 3,
        'photos_in_others_posts_count': 1,
        'deleted_comment_count': 0,
        'deleted_reply_count': 0,
    }


@pytest.mark.integration
def test_impact_counts_trips_shared_through_an_active_link(
    client, db_session, api_prefix
) -> None:
    admin = _admin(db_session)
    target = create_user(db_session, email='target@example.com', username='target')
    now = datetime.now(timezone.utc)
    for name, revoked_at, expires_at in (
        ('Active', None, None),
        ('Not expired yet', None, now + timedelta(days=1)),
        ('Revoked', now, None),
        ('Expired', None, now - timedelta(days=1)),
    ):
        trip = create_trip(db_session, owner_id=target.id, name=name)
        db_session.add(
            TripShareLink(
                trip_id=trip.id,
                token_hash=hash_share_token(name),
                created_by=target.id,
                revoked_at=revoked_at,
                expires_at=expires_at,
            )
        )
    db_session.commit()

    impact = client.get(
        f'{api_prefix}/admin/users/{target.id}/deletion-impact',
        headers=_auth_headers(admin),
    ).json()

    assert impact['deleted_trip_count'] == 4
    assert impact['deleted_shared_trip_count'] == 2


@pytest.mark.integration
def test_deletion_is_refused_when_other_trips_would_go_than_confirmed(
    client, db_session, api_prefix
) -> None:
    admin = _admin(db_session)
    target = create_user(db_session, email='target@example.com', username='target')
    co_owner = create_user(db_session, email='co@example.com', username='co-owner')
    trip = create_trip(db_session, owner_id=target.id, name='Co-owned')
    add_trip_member(
        db_session, trip_id=trip.id, user_id=co_owner.id, role=TripRole.OWNER
    )
    target_id, trip_id = target.id, trip.id
    impact = client.get(
        f'{api_prefix}/admin/users/{target_id}/deletion-impact',
        headers=_auth_headers(admin),
    ).json()
    assert impact['deleted_trip_count'] == 0
    # The admin confirmed that the trip stays, but then its other owner leaves.
    db_session.delete(_membership(db_session, trip_id, co_owner.id))
    db_session.commit()

    refused = _delete(
        client, api_prefix, admin, target, expected_deleted_trip_count=0
    )

    assert refused.status_code == 409
    db_session.expire_all()
    assert db_session.get(User, target_id) is not None
    assert db_session.get(Trip, trip_id) is not None

    confirmed = _delete(
        client, api_prefix, admin, target, expected_deleted_trip_count=1
    )

    assert confirmed.status_code == 200
    db_session.expire_all()
    assert db_session.get(User, target_id) is None
    assert db_session.get(Trip, trip_id) is None


@pytest.mark.integration
def test_comments_go_with_the_user_and_are_counted_first(
    client, db_session, api_prefix
) -> None:
    admin = _admin(db_session)
    target = create_user(db_session, email='target@example.com', username='target')
    co_owner = create_user(db_session, email='co@example.com', username='co-owner')
    shared = create_trip(db_session, owner_id=co_owner.id, name='Shared')
    add_trip_member(db_session, trip_id=shared.id, user_id=target.id)
    solo = create_trip(db_session, owner_id=target.id, name='Solo')
    post_id = _create_post(
        client, api_prefix, db_session, author=co_owner, trip=shared, title='Theirs'
    )
    solo_post = _create_post(
        client, api_prefix, db_session, author=target, trip=solo, title='Solo'
    )
    root = _comment(db_session, post_id=post_id, author=target)
    # Counted, also when nested deeper and under a reply of the user themselves.
    reply = _comment(db_session, post_id=post_id, author=co_owner, parent=root)
    own_reply = _comment(db_session, post_id=post_id, author=target, parent=reply)
    nested = _comment(db_session, post_id=post_id, author=co_owner, parent=own_reply)
    # Not under a comment of the user, so it stays.
    unrelated = _comment(db_session, post_id=post_id, author=co_owner)
    # Goes with its trip either way, so it isn't counted.
    _comment(db_session, post_id=solo_post, author=target)
    comment_ids = [root.id, reply.id, own_reply.id, nested.id]
    unrelated_id = unrelated.id

    impact = client.get(
        f'{api_prefix}/admin/users/{target.id}/deletion-impact',
        headers=_auth_headers(admin),
    ).json()
    assert impact['deleted_comment_count'] == 2
    assert impact['deleted_reply_count'] == 2

    response = _delete(client, api_prefix, admin, target)

    assert response.status_code == 200
    db_session.expire_all()
    assert db_session.get(Post, post_id) is not None
    assert all(db_session.get(PostComment, item) is None for item in comment_ids)
    assert db_session.get(PostComment, unrelated_id) is not None


@pytest.mark.integration
def test_impact_counts_reactions_of_others_that_go_with_the_posts(
    client, db_session, api_prefix
) -> None:
    admin = _admin(db_session)
    target = create_user(db_session, email='target@example.com', username='target')
    co_owner = create_user(db_session, email='co@example.com', username='co-owner')
    shared = create_trip(db_session, owner_id=co_owner.id, name='Shared')
    add_trip_member(db_session, trip_id=shared.id, user_id=target.id)
    solo = create_trip(db_session, owner_id=target.id, name='Solo')
    post_id = _create_post(
        client, api_prefix, db_session, author=target, trip=shared, title='Theirs'
    )
    solo_post = _create_post(
        client, api_prefix, db_session, author=target, trip=solo, title='Solo'
    )
    others_post = _create_post(
        client, api_prefix, db_session, author=co_owner, trip=shared, title='Other'
    )
    # Counted: gone only because the post goes, also when nested.
    top = _comment(db_session, post_id=post_id, author=co_owner)
    _comment(db_session, post_id=post_id, author=co_owner, parent=top)
    # Not counted here: under the user's own comment, so it goes in any case.
    own = _comment(db_session, post_id=post_id, author=target)
    _comment(db_session, post_id=post_id, author=co_owner, parent=own)
    # Not counted: on a post that stays, or in a trip that goes in any case.
    _comment(db_session, post_id=others_post, author=co_owner)
    _comment(db_session, post_id=solo_post, author=co_owner)
    db_session.add(PostLike(post_id=post_id, user_id=co_owner.id))
    db_session.add(PostLike(post_id=solo_post, user_id=co_owner.id))
    db_session.add(PostLike(post_id=others_post, user_id=target.id))
    db_session.commit()

    impact = client.get(
        f'{api_prefix}/admin/users/{target.id}/deletion-impact',
        headers=_auth_headers(admin),
    ).json()

    assert impact['comments_on_remaining_posts_count'] == 2
    assert impact['likes_on_remaining_posts_count'] == 1
    assert impact['deleted_comment_count'] == 1
    assert impact['deleted_reply_count'] == 1


@pytest.mark.integration
def test_open_recording_is_closed_so_others_can_record_again(
    client, db_session, api_prefix
) -> None:
    admin = _admin(db_session)
    target = create_user(db_session, email='target@example.com', username='target')
    co_owner = create_user(db_session, email='co@example.com', username='co-owner')
    trip = create_trip(db_session, owner_id=co_owner.id, name='Shared')
    add_trip_member(db_session, trip_id=trip.id, user_id=target.id)
    base = f'{api_prefix}/trips/{trip.id}/tracking/sessions'
    started_at = datetime(2026, 6, 29, 10, 30, tzinfo=timezone.utc)
    open_id = uuid.uuid4()
    started = client.post(
        f'{base}/{open_id}',
        headers=_auth_headers(target),
        json={'started_at': started_at.isoformat()},
    )
    assert started.status_code in (200, 201)

    response = _delete(client, api_prefix, admin, target)

    assert response.status_code == 200
    db_session.expire_all()
    session = db_session.get(GpsTrackingSession, open_id)
    assert session.recorded_by_user_id is None
    assert session.ended_at is not None
    assert session.ended_at >= started_at
    next_recording = client.post(
        f'{base}/{uuid.uuid4()}',
        headers=_auth_headers(co_owner),
        json={'started_at': datetime.now(timezone.utc).isoformat()},
    )
    assert next_recording.status_code in (200, 201)


def _assert_lock_is_required(session: Session, action) -> None:
    """Check that ``action`` runs into a row lock held by another session.

    The timeout makes it give up instead of waiting, and it only lasts for this
    transaction, which ends here with the failed action.
    """
    session.execute(text("SET LOCAL lock_timeout = '100ms'"))
    with pytest.raises(OperationalError) as caught:
        action()
    assert isinstance(caught.value.orig, LockNotAvailable)
    session.rollback()


@pytest.mark.integration
def test_deleting_a_user_waits_for_other_admin_changes(db_session, engine) -> None:
    admin = _admin(db_session)
    other_admin = create_user(
        db_session, email='other@example.com', role=UserRole.ADMIN, username='other'
    )
    target = create_user(db_session, email='target@example.com', username='target')
    admin_id, other_admin_id, target_id = admin.id, other_admin.id, target.id
    db_session.commit()
    db_session.execute(
        select(User.id).where(User.id == other_admin_id).with_for_update()
    ).all()

    with Session(bind=engine) as session:
        _assert_lock_is_required(
            session,
            lambda: AdminUserService(session).delete_user(
                user_id=target_id, actor_id=admin_id
            ),
        )
        _assert_lock_is_required(
            session,
            lambda: AdminUserService(session).update_user(
                user_id=target_id,
                actor_id=admin_id,
                payload=AdminUserUpdateRequest(role=UserRole.USER),
            ),
        )
    db_session.rollback()


@pytest.mark.integration
def test_admins_deleting_each_other_leave_one_admin(
    client, db_session, api_prefix
) -> None:
    admin = _admin(db_session)
    other_admin = create_user(
        db_session, email='other@example.com', role=UserRole.ADMIN, username='other'
    )
    admin_headers = _auth_headers(admin)
    admin_id = admin.id

    first = _delete(client, api_prefix, admin, other_admin)
    assert first.status_code == 200

    # The second request, once it gets the lock, finds no other admin left.
    db_session.expire_all()
    with pytest.raises(AdminUserProtectedActionError):
        AdminUserService(db_session).delete_user(
            user_id=admin_id, actor_id=uuid.uuid4()
        )
    db_session.rollback()
    assert client.get(
        f'{api_prefix}/admin/users', headers=admin_headers
    ).status_code == 200


@pytest.mark.integration
def test_admin_removed_while_waiting_cannot_act_any_more(
    client, db_session, api_prefix
) -> None:
    first = _admin(db_session)
    removed = create_user(
        db_session, email='removed@example.com', role=UserRole.ADMIN, username='removed'
    )
    # A third admin, so the check for the last admin doesn't refuse these.
    create_user(
        db_session, email='third@example.com', role=UserRole.ADMIN, username='third'
    )
    first_id, removed_id = first.id, removed.id
    assert _delete(client, api_prefix, first, removed).status_code == 200
    db_session.expire_all()

    with pytest.raises(AdminUserProtectedActionError, match='access was removed'):
        AdminUserService(db_session).delete_user(
            user_id=first_id, actor_id=removed_id
        )
    db_session.rollback()
    with pytest.raises(AdminUserProtectedActionError, match='access was removed'):
        AdminUserService(db_session).update_user(
            user_id=first_id,
            actor_id=removed_id,
            payload=AdminUserUpdateRequest(role=UserRole.USER),
        )
    db_session.rollback()
    assert db_session.get(User, first_id).role == UserRole.ADMIN


@pytest.mark.integration
def test_deleting_a_user_locks_their_trips_before_their_account(
    db_session, engine
) -> None:
    """Writers lock a trip, then reference the user: the reverse could deadlock."""
    admin = _admin(db_session)
    target = create_user(db_session, email='target@example.com', username='target')
    trip = create_trip(db_session, owner_id=target.id, name='Solo')
    admin_id, target_id, trip_id = admin.id, target.id, trip.id
    db_session.commit()
    # What starting a recording holds: the trip, and a share of the user's row.
    db_session.execute(
        select(Trip.id).where(Trip.id == trip_id).with_for_update()
    ).all()
    db_session.execute(
        select(User.id).where(User.id == target_id).with_for_update(read=True, key_share=True)
    ).all()

    with Session(bind=engine) as session:
        session.execute(text("SET LOCAL lock_timeout = '100ms'"))
        with pytest.raises(OperationalError) as caught:
            AdminUserService(session).delete_user(user_id=target_id, actor_id=admin_id)
        assert isinstance(caught.value.orig, LockNotAvailable)
        assert 'FROM trips' in str(caught.value.statement)
        session.rollback()
    db_session.rollback()


@pytest.mark.integration
def test_admin_lock_lets_others_reference_admins(db_session, engine) -> None:
    admin = _admin(db_session)
    trip = create_trip(db_session, owner_id=admin.id, name='Trip')
    admin_id, trip_id = admin.id, trip.id
    db_session.commit()
    AdminUserService(db_session)._lock_admins()

    with Session(bind=engine) as session:
        session.execute(text("SET LOCAL lock_timeout = '100ms'"))
        session.add(
            GpsTrackingSession(
                id=uuid.uuid4(),
                trip_id=trip_id,
                recorded_by_user_id=admin_id,
                started_at=datetime(2026, 6, 29, 10, 30, tzinfo=timezone.utc),
            )
        )
        session.commit()
    db_session.rollback()


@pytest.mark.integration
def test_trip_lock_of_a_deletion_lets_others_reference_the_trip(
    db_session, engine
) -> None:
    """A writer holding a post can finish, so the deletion can't deadlock with it."""
    owner = create_user(db_session, email='owner@example.com', username='owner')
    newcomer = create_user(db_session, email='new@example.com', username='newcomer')
    trip = create_trip(db_session, owner_id=owner.id, name='Trip')
    owner_id, newcomer_id, trip_id = owner.id, newcomer.id, trip.id
    db_session.commit()
    AdminUserService(db_session)._lock_affected_trips(owner_id)

    with Session(bind=engine) as session:
        # Member changes still have to wait for the deletion.
        _assert_lock_is_required(
            session,
            lambda: TripService(session).add_trip_member(
                trip_id, owner_id, newcomer_id, TripRole.MEMBER
            ),
        )
        session.execute(text("SET LOCAL lock_timeout = '100ms'"))
        session.add(
            GpsTrackingSession(
                id=uuid.uuid4(),
                trip_id=trip_id,
                recorded_by_user_id=owner_id,
                started_at=datetime(2026, 6, 29, 10, 30, tzinfo=timezone.utc),
            )
        )
        session.commit()
    db_session.rollback()


@pytest.mark.integration
def test_deleting_an_owner_and_changing_members_share_the_trip_lock(
    db_session, engine
) -> None:
    admin = _admin(db_session)
    owner = create_user(db_session, email='owner@example.com', username='owner')
    member = create_user(db_session, email='member@example.com', username='member')
    newcomer = create_user(db_session, email='new@example.com', username='newcomer')
    target = create_user(db_session, email='target@example.com', username='target')
    trip = create_trip(db_session, owner_id=owner.id, name='Shared')
    add_trip_member(db_session, trip_id=trip.id, user_id=member.id)
    add_trip_member(
        db_session, trip_id=trip.id, user_id=target.id, role=TripRole.OWNER
    )
    admin_id, owner_id, member_id, newcomer_id, target_id, trip_id = (
        admin.id, owner.id, member.id, newcomer.id, target.id, trip.id
    )
    db_session.commit()
    db_session.execute(
        select(Trip.id).where(Trip.id == trip_id).with_for_update()
    ).all()

    with Session(bind=engine) as session:
        service = TripService(session)
        for action in (
            lambda: service.add_trip_member(
                trip_id, owner_id, newcomer_id, TripRole.OWNER
            ),
            lambda: service.update_trip_member(
                trip_id, owner_id, member_id, TripRole.OWNER
            ),
            lambda: service.remove_trip_member(trip_id, owner_id, member_id),
            lambda: AdminUserService(session).delete_user(
                user_id=target_id, actor_id=admin_id
            ),
        ):
            _assert_lock_is_required(session, action)
    db_session.rollback()


@pytest.mark.integration
def test_deletion_impact_requires_an_admin(client, db_session, api_prefix) -> None:
    user = create_user(db_session, email='user@example.com', username='plain-user')
    target = create_user(db_session, email='target@example.com', username='target')

    response = client.get(
        f'{api_prefix}/admin/users/{target.id}/deletion-impact',
        headers=_auth_headers(user),
    )
    missing = client.get(
        f'{api_prefix}/admin/users/{uuid.uuid4()}/deletion-impact',
        headers=_auth_headers(_admin(db_session)),
    )

    assert response.status_code == 403
    assert missing.status_code == 404


@pytest.mark.integration
def test_deleting_a_user_deletes_every_trip_without_another_owner(
    client, db_session, api_prefix
) -> None:
    admin = _admin(db_session)
    target = create_user(db_session, email='target@example.com', username='target')
    co_owner = create_user(db_session, email='co@example.com', username='co-owner')
    friend = create_user(db_session, email='friend@example.com', username='friend')
    reader = create_user(db_session, email='reader@example.com', username='reader')
    family = create_trip(
        db_session,
        owner_id=target.id,
        name='Family',
        visibility=TripVisibility.PRIVATE,
    )
    add_trip_member(db_session, trip_id=family.id, user_id=friend.id)
    add_trip_viewer(db_session, trip_id=family.id, user_id=reader.id, created_by=target.id)
    co_owned = create_trip(db_session, owner_id=co_owner.id, name='Co-owned')
    add_trip_member(
        db_session, trip_id=co_owned.id, user_id=target.id, role=TripRole.OWNER
    )
    joined = create_trip(db_session, owner_id=co_owner.id, name='Joined')
    add_trip_member(db_session, trip_id=joined.id, user_id=target.id)
    post_id = _create_post(
        client, api_prefix, db_session, author=friend, trip=family, title='By friend'
    )
    link = client.post(
        f'{api_prefix}/trips/{family.id}/share-links',
        headers=_auth_headers(target),
        json={'label': 'Family'},
    )
    assert link.status_code == 201

    response = _delete(client, api_prefix, admin, target)

    assert response.status_code == 200
    db_session.expire_all()
    assert db_session.get(User, target.id) is None
    # Other members lose the trip too: it has nobody left to own it.
    assert db_session.get(Trip, family.id) is None
    assert db_session.get(Post, post_id) is None
    assert db_session.scalars(
        select(TripShareLink).where(TripShareLink.trip_id == family.id)
    ).all() == []
    shared_read = client.get(
        f'{api_prefix}/trips/{family.id}',
        headers={'X-Trip-Share-Token': link.json()['token']},
    )
    assert shared_read.status_code == 404
    for trip in (co_owned, joined):
        assert db_session.get(Trip, trip.id) is not None
        assert _membership(db_session, trip.id, target.id) is None
        assert _membership(db_session, trip.id, co_owner.id).role == TripRole.OWNER


@pytest.mark.integration
def test_content_in_shared_trips_survives_as_a_deleted_user(
    client, db_session, api_prefix
) -> None:
    admin = _admin(db_session)
    target = create_user(db_session, email='target@example.com', username='target')
    co_owner = create_user(db_session, email='co@example.com', username='co-owner')
    viewer = create_user(db_session, email='viewer@example.com', username='viewer')
    trip = create_trip(
        db_session,
        owner_id=co_owner.id,
        name='Shared',
        visibility=TripVisibility.PUBLIC,
        start_date=date(2026, 1, 1),
    )
    add_trip_member(
        db_session, trip_id=trip.id, user_id=target.id, role=TripRole.OWNER
    )
    add_trip_viewer(
        db_session, trip_id=trip.id, user_id=viewer.id, created_by=target.id
    )
    place = create_place(db_session)
    post = client.post(
        f'{api_prefix}/trips/{trip.id}/posts',
        headers=_auth_headers(target),
        json={
            'title': 'Written by target',
            'body': 'Written by target',
            'location': {'place_id': str(place.id)},
            'occurred_at': OCCURRED_AT,
            'publish': True,
        },
    )
    stop = client.post(
        f'{api_prefix}/trips/{trip.id}/itinerary/stops',
        headers=_auth_headers(target, etag='"0"'),
        json={
            'location': {'place_id': str(place.id)},
            'title': 'Stop by target',
            'planned_nights': 0,
            'planned_start_date': '2026-08-14', 'placement': {'after_stop_id': None},
            'incoming_connection': None,
            'outgoing_connection': None,
        },
    )
    link = client.post(
        f'{api_prefix}/trips/{trip.id}/share-links',
        headers=_auth_headers(target),
        json={'label': 'Created by target', 'display_name': 'Guest reader'},
    )
    assert post.status_code == 201
    assert stop.status_code == 201
    assert link.status_code == 201
    post_id = uuid.UUID(post.json()['id'])

    impact = client.get(
        f'{api_prefix}/admin/users/{target.id}/deletion-impact',
        headers=_auth_headers(admin),
    ).json()
    assert impact['deleted_trip_count'] == 0
    assert impact['remaining_post_count'] == 1

    response = _delete(client, api_prefix, admin, target)

    assert response.status_code == 200
    db_session.expire_all()
    assert db_session.get(User, target.id) is None
    stored_post = db_session.get(Post, post_id)
    assert stored_post is not None
    assert stored_post.author_user_id is None
    assert db_session.get(Location, stored_post.location_id).created_by is None
    assert [
        stored_stop.created_by
        for stored_stop in db_session.scalars(
            select(ItineraryStop).where(ItineraryStop.trip_id == trip.id)
        )
    ] == [None]
    assert db_session.get(TripViewer, (trip.id, viewer.id)).created_by is None
    assert _membership(db_session, trip.id, co_owner.id).role == TripRole.OWNER

    public_post = client.get(f'{api_prefix}/trips/{trip.id}/posts/{post_id}')
    assert public_post.status_code == 200
    assert public_post.json()['author'] is None

    itinerary = client.get(
        f'{api_prefix}/trips/{trip.id}/itinerary', headers=_auth_headers(co_owner)
    )
    assert itinerary.status_code == 200
    assert [item['created_by'] for item in itinerary.json()['stops']] == [None]

    viewers = client.get(
        f'{api_prefix}/trips/{trip.id}/viewers', headers=_auth_headers(co_owner)
    )
    assert viewers.status_code == 200
    assert [item['created_by'] for item in viewers.json()] == [None]

    share_headers = {'X-Trip-Share-Token': link.json()['token']}
    shared_read = client.get(f'{api_prefix}/trips/{trip.id}', headers=share_headers)
    assert shared_read.status_code == 200
    guest_like = client.put(
        f'{api_prefix}/trips/{trip.id}/posts/{post_id}/like', headers=share_headers
    )
    assert guest_like.status_code == 200


@pytest.mark.integration
def test_delete_content_removes_what_the_user_added_to_trips_that_stay(
    client, db_session, api_prefix, monkeypatch, tmp_path
) -> None:
    monkeypatch.setattr(settings, 'MEDIA_DIRECTORY', str(tmp_path))
    admin = _admin(db_session)
    target = create_user(db_session, email='target@example.com', username='target')
    co_owner = create_user(db_session, email='co@example.com', username='co-owner')
    shared = create_trip(db_session, owner_id=co_owner.id, name='Shared')
    add_trip_member(db_session, trip_id=shared.id, user_id=target.id)
    left = create_trip(db_session, owner_id=co_owner.id, name='Left')
    add_trip_member(db_session, trip_id=left.id, user_id=target.id)

    own_posts = [
        _create_post(
            client, api_prefix, db_session, author=target, trip=trip, title=trip.name
        )
        for trip in (shared, left)
    ]
    others_post_id = _create_post(
        client, api_prefix, db_session, author=co_owner, trip=shared, title='Theirs'
    )
    # A trip the user left still holds what they posted there.
    db_session.delete(_membership(db_session, left.id, target.id))
    photo = _create_photo(db_session, tmp_path, owner=target, post_ids=own_posts[:1])
    cover = _create_photo(db_session, tmp_path, owner=target)
    in_others_post = _create_photo(
        db_session, tmp_path, owner=target, post_ids=[own_posts[0], others_post_id]
    )
    others_photo = _create_photo(
        db_session, tmp_path, owner=co_owner, post_ids=[others_post_id]
    )
    others_post = db_session.get(Post, others_post_id)
    others_post.bubble_media_id = in_others_post.id
    revision = others_post.revision
    shared.cover_media_id = cover.id
    comment_id = _comment(db_session, post_id=own_posts[0], author=co_owner).id
    tracks = [
        _create_track(db_session, trip=trip, recorder=target).id
        for trip in (shared, left)
    ]
    others_track = _create_track(db_session, trip=shared, recorder=co_owner).id
    stop = client.post(
        f'{api_prefix}/trips/{shared.id}/itinerary/stops',
        headers=_auth_headers(target, etag='"0"'),
        json={
            'location': {'place_id': str(create_place(db_session).id)},
            'title': 'Stop by target',
            'planned_nights': 0,
            'planned_start_date': '2026-08-14', 'placement': {'after_stop_id': None},
            'incoming_connection': None,
            'outgoing_connection': None,
        },
    )
    assert stop.status_code == 201
    uploads = {
        media.id: Path(media.storage_path) for media in (photo, cover, in_others_post)
    }

    response = _delete(client, api_prefix, admin, target, delete_content=True)

    assert response.status_code == 200
    db_session.expire_all()
    assert db_session.get(User, target.id) is None
    assert all(db_session.get(Post, post_id) is None for post_id in own_posts)
    assert db_session.get(PostComment, comment_id) is None
    assert all(db_session.get(GpsTrackingSession, track) is None for track in tracks)
    assert all(_track_sample_count(db_session, track) == 0 for track in tracks)

    # Every upload goes at once, files included, also from other people's posts.
    for media_id, media_path in uploads.items():
        assert db_session.get(Media, media_id) is None
        assert not media_path.exists()
    assert db_session.get(Trip, shared.id).cover_media_id is None
    others_post = db_session.get(Post, others_post_id)
    assert [link.media_id for link in others_post.media_links] == [others_photo.id]
    assert others_post.bubble_media_id == others_photo.id
    assert others_post.revision == revision + 1

    # Other people's content stays, and so do the trips and shared plans.
    assert db_session.get(Media, others_photo.id) is not None
    assert Path(others_photo.storage_path).exists()
    assert _track_sample_count(db_session, others_track) == 1
    assert [
        stored_stop.created_by
        for stored_stop in db_session.scalars(
            select(ItineraryStop).where(ItineraryStop.trip_id == shared.id)
        )
    ] == [None]
    public_post = client.get(
        f'{api_prefix}/trips/{shared.id}/posts/{others_post_id}',
        headers=_auth_headers(co_owner),
    )
    assert public_post.status_code == 200


@pytest.mark.integration
def test_content_is_only_deleted_when_asked_for(
    client, db_session, api_prefix, monkeypatch, tmp_path
) -> None:
    monkeypatch.setattr(settings, 'MEDIA_DIRECTORY', str(tmp_path))
    admin = _admin(db_session)
    target = create_user(db_session, email='target@example.com', username='target')
    co_owner = create_user(db_session, email='co@example.com', username='co-owner')
    shared = create_trip(db_session, owner_id=co_owner.id, name='Shared')
    add_trip_member(db_session, trip_id=shared.id, user_id=target.id)
    post_id = _create_post(
        client, api_prefix, db_session, author=target, trip=shared, title='Stays'
    )
    photo = _create_photo(db_session, tmp_path, owner=target, post_ids=[post_id])
    track = _create_track(db_session, trip=shared, recorder=target).id

    response = _delete(client, api_prefix, admin, target)

    assert response.status_code == 200
    db_session.expire_all()
    assert db_session.get(Post, post_id).author_user_id is None
    assert db_session.get(Media, photo.id).created_by is None
    assert Path(photo.storage_path).exists()
    assert db_session.get(GpsTrackingSession, track).recorded_by_user_id is None
    assert _track_sample_count(db_session, track) == 1


@pytest.mark.integration
def test_uploads_nothing_uses_any_more_go_at_once_without_delete_content(
    client, db_session, api_prefix, monkeypatch, tmp_path
) -> None:
    monkeypatch.setattr(settings, 'MEDIA_DIRECTORY', str(tmp_path))
    admin = _admin(db_session)
    target = create_user(db_session, email='target@example.com', username='target')
    solo = create_trip(db_session, owner_id=target.id, name='Solo')
    post_id = _create_post(
        client, api_prefix, db_session, author=target, trip=solo, title='Solo'
    )
    in_deleted_trip = _create_photo(db_session, tmp_path, owner=target, post_ids=[post_id])
    unused = _create_photo(db_session, tmp_path, owner=target)
    uploads = {
        media.id: Path(media.storage_path) for media in (in_deleted_trip, unused)
    }

    response = _delete(client, api_prefix, admin, target)

    assert response.status_code == 200
    db_session.expire_all()
    for media_id, media_path in uploads.items():
        assert db_session.get(Media, media_id) is None
        assert not media_path.exists()
