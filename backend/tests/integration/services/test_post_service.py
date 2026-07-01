from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session

from factories.media import create_media
from factories.places import create_place
from factories.trips import add_trip_member, create_trip
from factories.users import create_user
from models.api.locations import LocationPlaceInput
from models.api.pagination import SortDirection
from models.api.posts import (
    PostCreateRequest,
    PostSortField,
    PostStatusFilter,
    PostUpdateRequest,
)
from models.database.posts import Post
from models.database.trips import TripRole, TripVisibility
from services.location_service import LocationService
from services.place_service import PlaceService
from services.post_service import (
    DuplicatePostMediaError,
    MediaNotFoundError,
    PostMediaOwnershipError,
    PostNotFoundError,
    PostPermissionError,
    PostService,
    TripNotFoundError,
)

OCCURRED_AT = datetime(2026, 6, 29, 10, 30, tzinfo=timezone.utc)


def _post_service(db_session: Session) -> PostService:
    return PostService(
        db=db_session,
        location_service=LocationService(
            db=db_session,
            place_service=PlaceService(db=db_session),
        ),
    )


def _create_payload(
    *,
    place_id: uuid.UUID,
    body: str,
    occurred_at: datetime = OCCURRED_AT,
    publish: bool = False,
    media_ids: list[uuid.UUID] | None = None,
) -> PostCreateRequest:
    return PostCreateRequest(
        body=body,
        location=LocationPlaceInput(place_id=place_id),
        occurred_at=occurred_at,
        publish=publish,
        media_ids=media_ids or [],
    )


def _list_bodies(
    service: PostService,
    *,
    trip_id: uuid.UUID,
    current_user_id: uuid.UUID | None,
    status_filter: PostStatusFilter,
) -> tuple[list[str], int]:
    posts, total = service.list_posts(
        trip_id=trip_id,
        current_user_id=current_user_id,
        offset=0,
        limit=20,
        sort_by=PostSortField.OCCURRED_AT,
        sort_order=SortDirection.DESC,
        status_filter=status_filter,
    )
    return [post.body for post in posts], total


@pytest.mark.integration
def test_list_posts_applies_draft_visibility_by_membership(
    db_session: Session,
) -> None:
    owner = create_user(db_session)
    viewer = create_user(db_session)
    trip = create_trip(
        db_session,
        owner_id=owner.id,
        visibility=TripVisibility.PUBLIC,
    )
    add_trip_member(
        db_session,
        trip_id=trip.id,
        user_id=viewer.id,
        role=TripRole.VIEWER,
    )
    place = create_place(db_session)
    service = _post_service(db_session)

    service.create_post(
        trip_id=trip.id,
        payload=_create_payload(place_id=place.id, body='Draft notes'),
        current_user_id=owner.id,
    )
    service.create_post(
        trip_id=trip.id,
        payload=_create_payload(
            place_id=place.id,
            body='Published notes',
            occurred_at=OCCURRED_AT + timedelta(hours=1),
            publish=True,
        ),
        current_user_id=owner.id,
    )

    anonymous_bodies, anonymous_total = _list_bodies(
        service,
        trip_id=trip.id,
        current_user_id=None,
        status_filter=PostStatusFilter.ALL,
    )
    owner_bodies, owner_total = _list_bodies(
        service,
        trip_id=trip.id,
        current_user_id=owner.id,
        status_filter=PostStatusFilter.ALL,
    )
    viewer_draft_bodies, viewer_draft_total = _list_bodies(
        service,
        trip_id=trip.id,
        current_user_id=viewer.id,
        status_filter=PostStatusFilter.DRAFT,
    )

    assert anonymous_bodies == ['Published notes']
    assert anonymous_total == 1
    assert owner_bodies == ['Published notes', 'Draft notes']
    assert owner_total == 2
    assert viewer_draft_bodies == []
    assert viewer_draft_total == 0


@pytest.mark.integration
def test_private_trip_posts_require_trip_membership(db_session: Session) -> None:
    owner = create_user(db_session)
    viewer = create_user(db_session)
    stranger = create_user(db_session)
    trip = create_trip(
        db_session,
        owner_id=owner.id,
        visibility=TripVisibility.PRIVATE,
    )
    add_trip_member(
        db_session,
        trip_id=trip.id,
        user_id=viewer.id,
        role=TripRole.VIEWER,
    )
    place = create_place(db_session)
    service = _post_service(db_session)
    post = service.create_post(
        trip_id=trip.id,
        payload=_create_payload(
            place_id=place.id,
            body='Private published notes',
            publish=True,
        ),
        current_user_id=owner.id,
    )

    with pytest.raises(TripNotFoundError):
        service.list_posts(
            trip_id=trip.id,
            current_user_id=None,
            offset=0,
            limit=20,
            sort_by=PostSortField.OCCURRED_AT,
            sort_order=SortDirection.DESC,
            status_filter=PostStatusFilter.PUBLISHED,
        )
    with pytest.raises(TripNotFoundError):
        service.get_post(
            trip_id=trip.id,
            post_id=post.id,
            current_user_id=stranger.id,
        )

    viewer_post = service.get_post(
        trip_id=trip.id,
        post_id=post.id,
        current_user_id=viewer.id,
    )
    assert viewer_post.body == 'Private published notes'


@pytest.mark.integration
def test_get_post_hides_drafts_from_users_without_draft_access(
    db_session: Session,
) -> None:
    owner = create_user(db_session)
    viewer = create_user(db_session)
    trip = create_trip(
        db_session,
        owner_id=owner.id,
        visibility=TripVisibility.PUBLIC,
    )
    add_trip_member(
        db_session,
        trip_id=trip.id,
        user_id=viewer.id,
        role=TripRole.VIEWER,
    )
    place = create_place(db_session)
    service = _post_service(db_session)
    draft = service.create_post(
        trip_id=trip.id,
        payload=_create_payload(place_id=place.id, body='Hidden draft'),
        current_user_id=owner.id,
    )

    with pytest.raises(PostNotFoundError):
        service.get_post(
            trip_id=trip.id,
            post_id=draft.id,
            current_user_id=None,
        )
    with pytest.raises(PostNotFoundError):
        service.get_post(
            trip_id=trip.id,
            post_id=draft.id,
            current_user_id=viewer.id,
        )

    owner_post = service.get_post(
        trip_id=trip.id,
        post_id=draft.id,
        current_user_id=owner.id,
    )
    assert owner_post.body == 'Hidden draft'


@pytest.mark.integration
def test_publish_and_unpublish_require_owner_or_author(
    db_session: Session,
) -> None:
    owner = create_user(db_session)
    author = create_user(db_session)
    other_member = create_user(db_session)
    trip = create_trip(db_session, owner_id=owner.id)
    add_trip_member(db_session, trip_id=trip.id, user_id=author.id)
    add_trip_member(db_session, trip_id=trip.id, user_id=other_member.id)
    place = create_place(db_session)
    service = _post_service(db_session)
    draft = service.create_post(
        trip_id=trip.id,
        payload=_create_payload(place_id=place.id, body='Author draft'),
        current_user_id=author.id,
    )

    with pytest.raises(PostPermissionError):
        service.publish_post(
            trip_id=trip.id,
            post_id=draft.id,
            current_user_id=other_member.id,
        )

    published = service.publish_post(
        trip_id=trip.id,
        post_id=draft.id,
        current_user_id=owner.id,
    )
    first_published_at = published.published_at
    republished = service.publish_post(
        trip_id=trip.id,
        post_id=draft.id,
        current_user_id=owner.id,
    )
    republished_at = republished.published_at
    unpublished = service.unpublish_post(
        trip_id=trip.id,
        post_id=draft.id,
        current_user_id=author.id,
    )

    assert first_published_at is not None
    assert republished_at == first_published_at
    assert unpublished.published_at is None


@pytest.mark.integration
def test_delete_post_requires_owner_or_author_and_removes_post(
    db_session: Session,
) -> None:
    owner = create_user(db_session)
    author = create_user(db_session)
    other_member = create_user(db_session)
    trip = create_trip(db_session, owner_id=owner.id)
    add_trip_member(db_session, trip_id=trip.id, user_id=author.id)
    add_trip_member(db_session, trip_id=trip.id, user_id=other_member.id)
    place = create_place(db_session)
    service = _post_service(db_session)
    post = service.create_post(
        trip_id=trip.id,
        payload=_create_payload(place_id=place.id, body='Delete me'),
        current_user_id=author.id,
    )

    with pytest.raises(PostPermissionError):
        service.delete_post(
            trip_id=trip.id,
            post_id=post.id,
            current_user_id=other_member.id,
        )

    service.delete_post(
        trip_id=trip.id,
        post_id=post.id,
        current_user_id=owner.id,
    )

    assert db_session.scalar(select(Post).where(Post.id == post.id)) is None


@pytest.mark.integration
def test_update_post_validates_replacement_media_ids(
    db_session: Session,
) -> None:
    owner = create_user(db_session)
    other_user = create_user(db_session)
    trip = create_trip(db_session, owner_id=owner.id)
    place = create_place(db_session)
    owned_media = create_media(
        db_session,
        storage_path='media/owned.jpg',
        created_by=owner.id,
    )
    other_user_media = create_media(
        db_session,
        storage_path='media/other-user.jpg',
        created_by=other_user.id,
    )
    service = _post_service(db_session)
    post = service.create_post(
        trip_id=trip.id,
        payload=_create_payload(
            place_id=place.id,
            body='Media validation',
            media_ids=[owned_media.id],
        ),
        current_user_id=owner.id,
    )

    with pytest.raises(DuplicatePostMediaError):
        service.update_post(
            trip_id=trip.id,
            post_id=post.id,
            payload=PostUpdateRequest(media_ids=[owned_media.id, owned_media.id]),
            current_user_id=owner.id,
        )
    with pytest.raises(PostMediaOwnershipError):
        service.update_post(
            trip_id=trip.id,
            post_id=post.id,
            payload=PostUpdateRequest(media_ids=[other_user_media.id]),
            current_user_id=owner.id,
        )
    with pytest.raises(MediaNotFoundError):
        service.update_post(
            trip_id=trip.id,
            post_id=post.id,
            payload=PostUpdateRequest(media_ids=[uuid.uuid4()]),
            current_user_id=owner.id,
        )


@pytest.mark.integration
def test_member_can_list_draft_posts(db_session: Session) -> None:
    owner = create_user(db_session)
    member = create_user(db_session)
    trip = create_trip(db_session, owner_id=owner.id)
    add_trip_member(db_session, trip_id=trip.id, user_id=member.id)
    place = create_place(db_session)
    service = _post_service(db_session)
    service.create_post(
        trip_id=trip.id,
        payload=_create_payload(place_id=place.id, body='Member-visible draft'),
        current_user_id=owner.id,
    )

    bodies, total = _list_bodies(
        service,
        trip_id=trip.id,
        current_user_id=member.id,
        status_filter=PostStatusFilter.DRAFT,
    )

    assert bodies == ['Member-visible draft']
    assert total == 1


@pytest.mark.integration
def test_update_post_replaces_location_and_occurred_at(
    db_session: Session,
) -> None:
    owner = create_user(db_session)
    trip = create_trip(db_session, owner_id=owner.id)
    original_place = create_place(db_session, name='Kyoto')
    new_place = create_place(
        db_session,
        name='Osaka',
        latitude=34.6937,
        longitude=135.5023,
        country_code='JP',
        region='Osaka',
        full_name='Osaka, Osaka, Japan',
    )
    service = _post_service(db_session)
    post = service.create_post(
        trip_id=trip.id,
        payload=_create_payload(place_id=original_place.id, body='Before update'),
        current_user_id=owner.id,
    )
    new_occurred_at = OCCURRED_AT + timedelta(days=1)

    updated = service.update_post(
        trip_id=trip.id,
        post_id=post.id,
        payload=PostUpdateRequest(
            location=LocationPlaceInput(place_id=new_place.id),
            occurred_at=new_occurred_at,
        ),
        current_user_id=owner.id,
    )

    assert updated.location.name == 'Osaka'
    assert updated.location.latitude == 34.6937
    assert updated.occurred_at == new_occurred_at


@pytest.mark.integration
def test_create_post_requires_member_with_create_permission(
    db_session: Session,
) -> None:
    owner = create_user(db_session)
    viewer = create_user(db_session)
    stranger = create_user(db_session)
    trip = create_trip(db_session, owner_id=owner.id)
    add_trip_member(
        db_session,
        trip_id=trip.id,
        user_id=viewer.id,
        role=TripRole.VIEWER,
    )
    place = create_place(db_session)
    service = _post_service(db_session)
    payload = _create_payload(place_id=place.id, body='Not allowed')

    with pytest.raises(PostPermissionError):
        service.create_post(
            trip_id=trip.id,
            payload=payload,
            current_user_id=viewer.id,
        )
    with pytest.raises(TripNotFoundError):
        service.create_post(
            trip_id=trip.id,
            payload=payload,
            current_user_id=stranger.id,
        )


@pytest.mark.integration
def test_missing_post_raises_for_read_and_write_paths(db_session: Session) -> None:
    owner = create_user(db_session)
    trip = create_trip(db_session, owner_id=owner.id)
    service = _post_service(db_session)
    missing_post_id = uuid.uuid4()

    with pytest.raises(PostNotFoundError):
        service.get_post(
            trip_id=trip.id,
            post_id=missing_post_id,
            current_user_id=owner.id,
        )
    with pytest.raises(PostNotFoundError):
        service.update_post(
            trip_id=trip.id,
            post_id=missing_post_id,
            payload=PostUpdateRequest(body='Missing'),
            current_user_id=owner.id,
        )
    with pytest.raises(PostNotFoundError):
        service.delete_post(
            trip_id=trip.id,
            post_id=missing_post_id,
            current_user_id=owner.id,
        )
