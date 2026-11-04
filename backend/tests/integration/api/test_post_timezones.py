from __future__ import annotations

import uuid
from pathlib import Path

import pytest
from alembic import command
from alembic.config import Config
from sqlalchemy import inspect, select, text

from core import security
from factories.locations import create_location
from factories.places import create_place
from factories.trips import create_trip
from factories.users import create_user
from models.database.posts import Post
from models.database.trips import TripVisibility

OCCURRED_AT = '2026-03-14T05:05:00+00:00'
REVISION_BEFORE = 'b7d3a9e1f260'


def _auth_headers(user) -> dict[str, str]:
    tokens = security.create_auth_tokens(subject=user.id, email=user.email)
    return {'Authorization': f'Bearer {tokens["access_token"]}'}


def _create_post(client, api_prefix, trip, user, location: dict) -> dict:
    response = client.post(
        f'{api_prefix}/trips/{trip.id}/posts',
        headers=_auth_headers(user),
        json={
            'title': 'Zone',
            'body': 'Zone',
            'location': location,
            'occurred_at': OCCURRED_AT,
            'publish': True,
        },
    )
    assert response.status_code == 201, response.text
    return response.json()


def _stored_zone(db_session, post_id: str) -> str:
    db_session.expire_all()
    return db_session.get(Post, uuid.UUID(post_id)).occurred_timezone


@pytest.mark.integration
def test_create_post_with_place_sets_zone_from_place_coordinates(
    client, db_session, api_prefix
) -> None:
    user = create_user(db_session, password='PostsPass123!')
    trip = create_trip(db_session, owner_id=user.id, visibility=TripVisibility.PUBLIC)
    place = create_place(db_session)  # Kyoto

    created = _create_post(
        client, api_prefix, trip, user, {'place_id': str(place.id)}
    )

    assert created['occurred_timezone'] == 'Asia/Tokyo'
    assert _stored_zone(db_session, created['id']) == 'Asia/Tokyo'
    listed = client.get(f'{api_prefix}/trips/{trip.id}/posts').json()['items']
    assert [item['occurred_timezone'] for item in listed] == ['Asia/Tokyo']
    fetched = client.get(f'{api_prefix}/trips/{trip.id}/posts/{created["id"]}')
    assert fetched.json()['occurred_timezone'] == 'Asia/Tokyo'


@pytest.mark.integration
def test_create_post_with_coordinates_uses_the_point_not_the_nearest_place(
    client, db_session, api_prefix
) -> None:
    user = create_user(db_session, password='PostsPass123!')
    trip = create_trip(db_session, owner_id=user.id)
    # Reverse geocoding names the post after Baarle-Nassau (NL), but the point
    # itself is in a Belgian enclave.
    create_place(
        db_session,
        name='Baarle-Nassau',
        latitude=51.4452,
        longitude=4.9295,
        country_code='NL',
        region='North Brabant',
        full_name='Baarle-Nassau, North Brabant, The Netherlands',
    )

    created = _create_post(
        client, api_prefix, trip, user, {'latitude': 51.4419, 'longitude': 4.9265}
    )

    assert created['location']['name'] == 'Baarle-Nassau'
    assert created['occurred_timezone'] == 'Europe/Brussels'


@pytest.mark.integration
def test_update_post_recomputes_zone_only_when_location_changes(
    client, db_session, api_prefix
) -> None:
    user = create_user(db_session, password='PostsPass123!')
    trip = create_trip(db_session, owner_id=user.id)
    place = create_place(db_session)  # Kyoto
    created = _create_post(
        client, api_prefix, trip, user, {'place_id': str(place.id)}
    )
    post_url = f'{api_prefix}/trips/{trip.id}/posts/{created["id"]}'
    headers = _auth_headers(user)

    unchanged = client.patch(
        post_url,
        headers={**headers, 'If-Match': f'"{created["revision"]}"'},
        json={'title': 'Renamed', 'occurred_at': '2026-03-13T22:00:00+00:00'},
    )
    assert unchanged.status_code == 200, unchanged.text
    assert unchanged.json()['occurred_timezone'] == 'Asia/Tokyo'
    assert _stored_zone(db_session, created['id']) == 'Asia/Tokyo'

    moved = client.patch(
        post_url,
        headers={**headers, 'If-Match': f'"{unchanged.json()["revision"]}"'},
        json={'location': {'latitude': 40.7128, 'longitude': -74.0060}},
    )
    assert moved.status_code == 200, moved.text
    assert moved.json()['occurred_timezone'] == 'America/New_York'
    assert _stored_zone(db_session, created['id']) == 'America/New_York'


@pytest.mark.integration
def test_migration_backfills_zone_from_location_coordinates(
    engine, db_session
) -> None:
    user = create_user(db_session)
    trip = create_trip(db_session, owner_id=user.id)
    locations = {
        'Asia/Tokyo': create_location(
            db_session, trip_id=trip.id, created_by=user.id
        ),
        'Europe/Brussels': create_location(
            db_session,
            trip_id=trip.id,
            created_by=user.id,
            name='Baarle-Hertog',
            latitude=51.4419,
            longitude=4.9265,
        ),
        'Etc/GMT+3': create_location(
            db_session,
            trip_id=trip.id,
            created_by=user.id,
            name='Atlantic',
            latitude=30.0,
            longitude=-40.0,
        ),
    }
    root = Path(__file__).resolve().parents[3]
    config = Config(str(root / 'alembic.ini'))
    config.set_main_option('script_location', str(root / 'app/alembic'))
    config.set_main_option(
        'sqlalchemy.url', engine.url.render_as_string(hide_password=False)
    )
    expected = {location.id: zone for zone, location in locations.items()}
    rows = [(location.id, location.name) for location in locations.values()]
    trip_id, user_id = trip.id, user.id
    db_session.commit()
    db_session.close()

    command.downgrade(config, REVISION_BEFORE)
    with engine.begin() as connection:
        assert 'occurred_timezone' not in {
            column['name'] for column in inspect(connection).get_columns('posts')
        }
        for location_id, name in rows:
            connection.execute(
                text(
                    'INSERT INTO posts (id, trip_id, author_user_id, location_id, '
                    'title, body) VALUES (:id, :trip, :author, :location, '
                    ":title, 'Body')"
                ),
                {
                    'id': uuid.uuid4(),
                    'trip': trip_id,
                    'author': user_id,
                    'location': location_id,
                    'title': name,
                },
            )

    command.upgrade(config, 'head')

    with engine.connect() as connection:
        column = next(
            column
            for column in inspect(connection).get_columns('posts')
            if column['name'] == 'occurred_timezone'
        )
    assert column['nullable'] is False
    assert column['default'] is None
    zones = {
        post.location_id: post.occurred_timezone
        for post in db_session.scalars(select(Post))
    }
    assert zones == expected
