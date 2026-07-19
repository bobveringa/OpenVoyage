from __future__ import annotations

import uuid

import pytest
from sqlalchemy import select

from core import security
from factories.media import create_media
from factories.places import create_place
from factories.trips import add_trip_member, create_trip
from factories.users import create_user
from models.database.posts import PostMedia
from models.database.trips import TripRole, TripVisibility

OCCURRED_AT = '2026-06-29T10:30:00+00:00'
OCCURRED_AT_RESPONSE = '2026-06-29T10:30:00Z'


def _auth_headers(user) -> dict[str, str]:
    tokens = security.create_auth_tokens(subject=user.id, email=user.email)
    return {'Authorization': f'Bearer {tokens["access_token"]}'}


def _place_location(place) -> dict[str, str]:
    return {'place_id': str(place.id)}


@pytest.mark.integration
def test_create_post_derives_media_order_from_media_ids(
    client,
    db_session,
    api_prefix,
) -> None:
    user = create_user(db_session, password='PostsPass123!')
    trip = create_trip(
        db_session,
        owner_id=user.id,
        visibility=TripVisibility.PUBLIC,
    )
    place = create_place(db_session)
    first_media = create_media(
        db_session,
        storage_path='media/first.jpg',
        created_by=user.id,
    )
    second_media = create_media(
        db_session,
        storage_path='media/second.jpg',
        created_by=user.id,
    )

    response = client.post(
        f'{api_prefix}/trips/{trip.id}/posts',
        headers=_auth_headers(user),
        json={
            'body': 'Today we reached Kyoto...',
            'location': _place_location(place),
            'occurred_at': OCCURRED_AT,
            'media_ids': [str(second_media.id), str(first_media.id)],
            'publish': False,
        },
    )

    assert response.status_code == 201
    payload = response.json()
    assert payload['body'] == 'Today we reached Kyoto...'
    assert payload['occurred_at'] == OCCURRED_AT_RESPONSE
    assert payload['published_at'] is None
    assert payload['location']['name'] == place.name
    assert payload['location']['latitude'] == place.latitude
    assert payload['location']['longitude'] == place.longitude
    assert [item['id'] for item in payload['media']] == [
        str(second_media.id),
        str(first_media.id),
    ]

    links = list(
        db_session.execute(
            select(PostMedia).where(PostMedia.post_id == uuid.UUID(payload['id']))
        )
        .scalars()
        .all()
    )
    assert {link.media_id: link.sort_order for link in links} == {
        second_media.id: 0,
        first_media.id: 1,
    }


@pytest.mark.integration
def test_list_posts_without_auth_returns_only_published_public_posts(
    client,
    db_session,
    api_prefix,
) -> None:
    user = create_user(db_session, password='PostsPass123!')
    trip = create_trip(
        db_session,
        owner_id=user.id,
        visibility=TripVisibility.PUBLIC,
    )
    place = create_place(db_session)
    headers = _auth_headers(user)

    draft_response = client.post(
        f'{api_prefix}/trips/{trip.id}/posts',
        headers=headers,
        json={
            'body': 'Draft notes',
            'location': _place_location(place),
            'occurred_at': '2026-06-28T09:00:00+00:00',
            'media_ids': [],
        },
    )
    published_response = client.post(
        f'{api_prefix}/trips/{trip.id}/posts',
        headers=headers,
        json={
            'body': 'Published notes',
            'location': _place_location(place),
            'occurred_at': '2026-06-27T09:00:00+00:00',
            'media_ids': [],
            'publish': True,
        },
    )
    list_response = client.get(f'{api_prefix}/trips/{trip.id}/posts')

    assert draft_response.status_code == 201
    assert published_response.status_code == 201
    assert list_response.status_code == 200
    payload = list_response.json()
    assert payload['total'] == 1
    assert [item['body'] for item in payload['items']] == ['Published notes']


@pytest.mark.integration
def test_list_posts_orders_by_occurred_at_by_default(
    client,
    db_session,
    api_prefix,
) -> None:
    user = create_user(db_session, password='PostsPass123!')
    trip = create_trip(
        db_session,
        owner_id=user.id,
        visibility=TripVisibility.PUBLIC,
    )
    place = create_place(db_session)
    headers = _auth_headers(user)

    for body, occurred_at in [
        ('Morning train', '2026-06-28T08:00:00+00:00'),
        ('Late dinner', '2026-06-28T20:00:00+00:00'),
        ('Previous day walk', '2026-06-27T12:00:00+00:00'),
    ]:
        response = client.post(
            f'{api_prefix}/trips/{trip.id}/posts',
            headers=headers,
            json={
                'body': body,
                'location': _place_location(place),
                'occurred_at': occurred_at,
                'media_ids': [],
                'publish': True,
            },
        )
        assert response.status_code == 201

    response = client.get(f'{api_prefix}/trips/{trip.id}/posts')

    assert response.status_code == 200
    assert [item['body'] for item in response.json()['items']] == [
        'Late dinner',
        'Morning train',
        'Previous day walk',
    ]


@pytest.mark.integration
def test_create_post_with_coordinates_preserves_coordinates_and_uses_place_metadata(
    client,
    db_session,
    api_prefix,
) -> None:
    user = create_user(db_session, password='PostsPass123!')
    trip = create_trip(db_session, owner_id=user.id)
    place = create_place(
        db_session,
        name='Eindhoven',
        latitude=51.44164,
        longitude=5.46972,
        country_code='NL',
        region='North Brabant',
        full_name='Eindhoven, North Brabant, The Netherlands',
    )

    response = client.post(
        f'{api_prefix}/trips/{trip.id}/posts',
        headers=_auth_headers(user),
        json={
            'body': 'Close to Eindhoven',
            'location': {
                'latitude': 51.44,
                'longitude': 5.47,
            },
            'occurred_at': OCCURRED_AT,
            'media_ids': [],
        },
    )

    assert response.status_code == 201
    location = response.json()['location']
    assert location['name'] == place.name
    assert location['latitude'] == 51.44
    assert location['longitude'] == 5.47
    assert location['country_code'] == 'NL'
    assert location['region'] == 'North Brabant'
    assert location['full_name'] == 'Eindhoven, North Brabant, The Netherlands'


@pytest.mark.integration
def test_create_post_with_coordinates_uses_unknown_location_when_no_place_matches(
    client,
    db_session,
    api_prefix,
) -> None:
    user = create_user(db_session, password='PostsPass123!')
    trip = create_trip(db_session, owner_id=user.id)

    response = client.post(
        f'{api_prefix}/trips/{trip.id}/posts',
        headers=_auth_headers(user),
        json={
            'body': 'Middle of nowhere',
            'location': {
                'latitude': 0.1,
                'longitude': 0.2,
            },
            'occurred_at': OCCURRED_AT,
            'media_ids': [],
        },
    )

    assert response.status_code == 201
    location = response.json()['location']
    assert location['name'] == 'Unknown location'
    assert location['latitude'] == 0.1
    assert location['longitude'] == 0.2
    assert location['country_code'] == 'ZZ'
    assert location['region'] == 'Unknown'
    assert location['full_name'] == 'Unknown location'


@pytest.mark.integration
def test_update_post_replaces_and_reorders_media_ids(
    client,
    db_session,
    api_prefix,
) -> None:
    user = create_user(db_session, password='PostsPass123!')
    trip = create_trip(db_session, owner_id=user.id)
    place = create_place(db_session)
    first_media = create_media(
        db_session,
        storage_path='media/update-first.jpg',
        created_by=user.id,
    )
    second_media = create_media(
        db_session,
        storage_path='media/update-second.jpg',
        created_by=user.id,
    )
    third_media = create_media(
        db_session,
        storage_path='media/update-third.jpg',
        created_by=user.id,
    )
    headers = _auth_headers(user)

    create_response = client.post(
        f'{api_prefix}/trips/{trip.id}/posts',
        headers=headers,
        json={
            'body': 'Before',
            'location': _place_location(place),
            'occurred_at': OCCURRED_AT,
            'media_ids': [str(first_media.id), str(second_media.id)],
        },
    )
    post_id = create_response.json()['id']

    update_response = client.patch(
        f'{api_prefix}/trips/{trip.id}/posts/{post_id}',
        headers=headers,
        json={
            'body': 'After',
            'occurred_at': '2026-06-30T08:15:00+00:00',
            'media_ids': [str(third_media.id), str(first_media.id)],
        },
    )

    assert create_response.status_code == 201
    assert update_response.status_code == 200
    payload = update_response.json()
    assert payload['body'] == 'After'
    assert payload['occurred_at'] == '2026-06-30T08:15:00Z'
    assert [item['id'] for item in payload['media']] == [
        str(third_media.id),
        str(first_media.id),
    ]


@pytest.mark.integration
def test_post_update_requires_owner_or_author(
    client,
    db_session,
    api_prefix,
) -> None:
    owner = create_user(db_session, password='PostsPass123!')
    author = create_user(db_session, password='PostsPass123!')
    other_member = create_user(db_session, password='PostsPass123!')
    trip = create_trip(db_session, owner_id=owner.id)
    add_trip_member(
        db_session,
        trip_id=trip.id,
        user_id=author.id,
        role=TripRole.MEMBER,
    )
    add_trip_member(
        db_session,
        trip_id=trip.id,
        user_id=other_member.id,
        role=TripRole.MEMBER,
    )
    place = create_place(db_session)

    create_response = client.post(
        f'{api_prefix}/trips/{trip.id}/posts',
        headers=_auth_headers(author),
        json={
            'body': 'Author draft',
            'location': _place_location(place),
            'occurred_at': OCCURRED_AT,
            'media_ids': [],
        },
    )
    post_id = create_response.json()['id']

    other_member_response = client.patch(
        f'{api_prefix}/trips/{trip.id}/posts/{post_id}',
        headers=_auth_headers(other_member),
        json={'body': 'Other member edit'},
    )
    owner_response = client.patch(
        f'{api_prefix}/trips/{trip.id}/posts/{post_id}',
        headers=_auth_headers(owner),
        json={'body': 'Owner edit'},
    )

    assert create_response.status_code == 201
    assert other_member_response.status_code == 403
    assert owner_response.status_code == 200
    assert owner_response.json()['body'] == 'Owner edit'


@pytest.mark.integration
def test_create_post_validates_media_ids(
    client,
    db_session,
    api_prefix,
) -> None:
    user = create_user(db_session, password='PostsPass123!')
    another_user = create_user(db_session, password='PostsPass123!')
    trip = create_trip(db_session, owner_id=user.id)
    place = create_place(db_session)
    owned_media = create_media(
        db_session,
        storage_path='media/owned.jpg',
        created_by=user.id,
    )
    other_user_media = create_media(
        db_session,
        storage_path='media/other-user.jpg',
        created_by=another_user.id,
    )
    headers = _auth_headers(user)

    duplicate_response = client.post(
        f'{api_prefix}/trips/{trip.id}/posts',
        headers=headers,
        json={
            'body': 'Duplicate media',
            'location': _place_location(place),
            'occurred_at': OCCURRED_AT,
            'media_ids': [str(owned_media.id), str(owned_media.id)],
        },
    )
    ownership_response = client.post(
        f'{api_prefix}/trips/{trip.id}/posts',
        headers=headers,
        json={
            'body': 'Other media',
            'location': _place_location(place),
            'occurred_at': OCCURRED_AT,
            'media_ids': [str(other_user_media.id)],
        },
    )

    assert duplicate_response.status_code == 400
    assert ownership_response.status_code == 403


@pytest.mark.integration
def test_create_post_returns_not_found_for_missing_media(
    client,
    db_session,
    api_prefix,
) -> None:
    user = create_user(db_session, password='PostsPass123!')
    trip = create_trip(db_session, owner_id=user.id)
    place = create_place(db_session)

    response = client.post(
        f'{api_prefix}/trips/{trip.id}/posts',
        headers=_auth_headers(user),
        json={
            'body': 'Missing media',
            'location': _place_location(place),
            'occurred_at': OCCURRED_AT,
            'media_ids': [str(uuid.uuid4())],
        },
    )

    assert response.status_code == 404


@pytest.mark.integration
def test_private_trip_posts_return_not_found_without_membership(
    client,
    db_session,
    api_prefix,
) -> None:
    owner = create_user(db_session, password='PostsPass123!')
    trip = create_trip(
        db_session,
        owner_id=owner.id,
        visibility=TripVisibility.PRIVATE,
    )
    place = create_place(db_session)
    create_response = client.post(
        f'{api_prefix}/trips/{trip.id}/posts',
        headers=_auth_headers(owner),
        json={
            'body': 'Private post',
            'location': _place_location(place),
            'occurred_at': OCCURRED_AT,
            'publish': True,
        },
    )

    list_response = client.get(f'{api_prefix}/trips/{trip.id}/posts')
    get_response = client.get(
        f'{api_prefix}/trips/{trip.id}/posts/{create_response.json()["id"]}'
    )

    assert create_response.status_code == 201
    assert list_response.status_code == 404
    assert get_response.status_code == 404


@pytest.mark.integration
def test_share_link_reads_private_published_posts_but_not_drafts(
    client,
    db_session,
    api_prefix,
) -> None:
    owner = create_user(db_session, password='PostsPass123!')
    trip = create_trip(
        db_session,
        owner_id=owner.id,
        visibility=TripVisibility.PRIVATE,
    )
    place = create_place(db_session)
    owner_headers = _auth_headers(owner)
    draft_response = client.post(
        f'{api_prefix}/trips/{trip.id}/posts',
        headers=owner_headers,
        json={
            'body': 'Hidden draft',
            'location': _place_location(place),
            'occurred_at': OCCURRED_AT,
        },
    )
    published_response = client.post(
        f'{api_prefix}/trips/{trip.id}/posts',
        headers=owner_headers,
        json={
            'body': 'Shared published post',
            'location': _place_location(place),
            'occurred_at': OCCURRED_AT,
            'publish': True,
        },
    )
    link_response = client.post(
        f'{api_prefix}/trips/{trip.id}/share-links',
        headers=owner_headers,
        json={'label': 'Readers'},
    )
    share_headers = {'X-Trip-Share-Token': link_response.json()['token']}

    list_response = client.get(
        f'{api_prefix}/trips/{trip.id}/posts?status=all',
        headers=share_headers,
    )
    get_published_response = client.get(
        f'{api_prefix}/trips/{trip.id}/posts/{published_response.json()["id"]}',
        headers=share_headers,
    )
    get_draft_response = client.get(
        f'{api_prefix}/trips/{trip.id}/posts/{draft_response.json()["id"]}',
        headers=share_headers,
    )

    assert draft_response.status_code == 201
    assert published_response.status_code == 201
    assert link_response.status_code == 201
    assert list_response.status_code == 200
    assert [item['body'] for item in list_response.json()['items']] == [
        'Shared published post'
    ]
    assert get_published_response.status_code == 200
    assert get_draft_response.status_code == 404


@pytest.mark.integration
def test_update_post_translates_media_validation_errors(
    client,
    db_session,
    api_prefix,
) -> None:
    user = create_user(db_session, password='PostsPass123!')
    another_user = create_user(db_session, password='PostsPass123!')
    trip = create_trip(db_session, owner_id=user.id)
    place = create_place(db_session)
    owned_media = create_media(
        db_session,
        storage_path='media/update-owned.jpg',
        created_by=user.id,
    )
    other_user_media = create_media(
        db_session,
        storage_path='media/update-other-user.jpg',
        created_by=another_user.id,
    )
    headers = _auth_headers(user)
    create_response = client.post(
        f'{api_prefix}/trips/{trip.id}/posts',
        headers=headers,
        json={
            'body': 'Before media validation',
            'location': _place_location(place),
            'occurred_at': OCCURRED_AT,
        },
    )
    post_id = create_response.json()['id']

    duplicate_response = client.patch(
        f'{api_prefix}/trips/{trip.id}/posts/{post_id}',
        headers=headers,
        json={'media_ids': [str(owned_media.id), str(owned_media.id)]},
    )
    ownership_response = client.patch(
        f'{api_prefix}/trips/{trip.id}/posts/{post_id}',
        headers=headers,
        json={'media_ids': [str(other_user_media.id)]},
    )
    missing_response = client.patch(
        f'{api_prefix}/trips/{trip.id}/posts/{post_id}',
        headers=headers,
        json={'media_ids': [str(uuid.uuid4())]},
    )

    assert create_response.status_code == 201
    assert duplicate_response.status_code == 400
    assert ownership_response.status_code == 403
    assert missing_response.status_code == 404


@pytest.mark.integration
def test_publish_unpublish_and_delete_post_endpoints(
    client,
    db_session,
    api_prefix,
) -> None:
    owner = create_user(db_session, password='PostsPass123!')
    author = create_user(db_session, password='PostsPass123!')
    other_member = create_user(db_session, password='PostsPass123!')
    trip = create_trip(db_session, owner_id=owner.id)
    add_trip_member(db_session, trip_id=trip.id, user_id=author.id)
    add_trip_member(db_session, trip_id=trip.id, user_id=other_member.id)
    place = create_place(db_session)
    create_response = client.post(
        f'{api_prefix}/trips/{trip.id}/posts',
        headers=_auth_headers(author),
        json={
            'body': 'Publish me',
            'location': _place_location(place),
            'occurred_at': OCCURRED_AT,
        },
    )
    post_id = create_response.json()['id']

    forbidden_publish_response = client.post(
        f'{api_prefix}/trips/{trip.id}/posts/{post_id}/publish',
        headers=_auth_headers(other_member),
    )
    publish_response = client.post(
        f'{api_prefix}/trips/{trip.id}/posts/{post_id}/publish',
        headers=_auth_headers(owner),
    )
    unpublish_response = client.post(
        f'{api_prefix}/trips/{trip.id}/posts/{post_id}/unpublish',
        headers=_auth_headers(author),
    )
    forbidden_delete_response = client.delete(
        f'{api_prefix}/trips/{trip.id}/posts/{post_id}',
        headers=_auth_headers(other_member),
    )
    delete_response = client.delete(
        f'{api_prefix}/trips/{trip.id}/posts/{post_id}',
        headers=_auth_headers(owner),
    )
    missing_publish_response = client.post(
        f'{api_prefix}/trips/{trip.id}/posts/{post_id}/publish',
        headers=_auth_headers(owner),
    )

    assert create_response.status_code == 201
    assert forbidden_publish_response.status_code == 403
    assert publish_response.status_code == 200
    assert publish_response.json()['published_at'] is not None
    assert unpublish_response.status_code == 200
    assert unpublish_response.json()['published_at'] is None
    assert forbidden_delete_response.status_code == 403
    assert delete_response.status_code == 204
    assert missing_publish_response.status_code == 404
