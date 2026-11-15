"""Stop notes save on their own route: members only, last save wins."""

from pathlib import Path

import pytest
from alembic import command
from alembic.config import Config
from sqlalchemy import text

from core import security
from factories.places import create_place
from factories.trips import add_trip_member, add_trip_viewer, create_trip
from factories.users import create_user
from planning_helpers import planning_body

pytestmark = pytest.mark.integration


def auth(user, revision=None):
    token = security.create_auth_tokens(subject=user.id, email=user.email)['access_token']
    headers = {'Authorization': f'Bearer {token}'}
    if revision is not None:
        headers['If-Match'] = f'"{revision}"'
    return headers


@pytest.fixture
def trip(client, db_session, api_prefix):
    owner = create_user(db_session, password='NotesPass123!', first_name='Anna')
    member = create_user(db_session, password='NotesPass123!', first_name='Bob')
    trip = create_trip(db_session, owner_id=owner.id)
    add_trip_member(db_session, trip_id=trip.id, user_id=member.id)
    place = create_place(db_session, name='Barcelona', latitude=41.39, longitude=2.16)
    base = f'{api_prefix}/trips/{trip.id}/itinerary'
    created = client.post(
        base + '/stops',
        headers=auth(owner, 0),
        json={
            'location': {'place_id': str(place.id)},
            'title': 'Barcelona',
            'planned_nights': 2,
            'placement': {'after_stop_id': None},
        },
    )
    assert created.status_code == 201, created.text
    stop = planning_body(created)['stops'][0]
    return {
        'owner': owner,
        'member': member,
        'trip': trip,
        'base': base,
        'stop': stop,
        'notes_url': f'{base}/stops/{stop["id"]}/notes',
    }


def test_new_stops_start_with_empty_notes_and_carry_a_timezone(trip):
    stop = trip['stop']
    assert stop['notes'] == ''
    assert stop['notes_updated_at'] is None
    assert stop['location']['timezone'] == 'Europe/Madrid'


def test_notes_save_without_if_match_and_keep_the_revision(client, trip):
    saved = client.put(
        trip['notes_url'],
        headers=auth(trip['owner']),
        json={'notes': 'Sagrada Família at 10:00', 'based_on': None},
    )
    assert saved.status_code == 200, saved.text
    body = saved.json()
    assert body['notes'] == 'Sagrada Família at 10:00'
    assert body['notes_updated_at'] is not None
    assert body['replaced_change_by'] is None

    itinerary = client.get(trip['base'], headers=auth(trip['owner']))
    assert itinerary.headers['etag'] == '"1"'
    stop = planning_body(itinerary)['stops'][0]
    assert stop['notes'] == 'Sagrada Família at 10:00'
    assert stop['notes_updated_at'] == body['notes_updated_at']


def test_last_save_wins_and_names_the_other_user_it_replaced(client, trip):
    first = client.put(
        trip['notes_url'],
        headers=auth(trip['owner']),
        json={'notes': 'Anna first', 'based_on': None},
    ).json()
    # Bob saves on top of Anna's version.
    bob = client.put(
        trip['notes_url'],
        headers=auth(trip['member']),
        json={'notes': 'Bob was here', 'based_on': first['notes_updated_at']},
    ).json()
    assert bob['replaced_change_by'] is None
    # Anna still edits from her old version: her save wins, with a notice.
    anna = client.put(
        trip['notes_url'],
        headers=auth(trip['owner']),
        json={'notes': 'Anna again', 'based_on': first['notes_updated_at']},
    )
    assert anna.status_code == 200
    assert anna.json()['notes'] == 'Anna again'
    assert anna.json()['replaced_change_by']['id'] == str(trip['member'].id)
    assert anna.json()['replaced_change_by']['first_name'] == 'Bob'


def test_your_own_earlier_saves_never_count_as_replaced(client, trip):
    first = client.put(
        trip['notes_url'],
        headers=auth(trip['owner']),
        json={'notes': 'From tab one', 'based_on': None},
    ).json()
    client.put(
        trip['notes_url'],
        headers=auth(trip['owner']),
        json={'notes': 'From tab two', 'based_on': first['notes_updated_at']},
    )
    again = client.put(
        trip['notes_url'],
        headers=auth(trip['owner']),
        json={'notes': 'Back in tab one', 'based_on': first['notes_updated_at']},
    )
    assert again.json()['replaced_change_by'] is None


def test_only_members_can_save_notes(client, db_session, api_prefix, trip):
    viewer = create_user(db_session, password='NotesPass123!')
    outsider = create_user(db_session, password='NotesPass123!')
    add_trip_viewer(
        db_session, trip_id=trip['trip'].id, user_id=viewer.id, created_by=trip['owner'].id
    )
    link = client.post(
        f'{api_prefix}/trips/{trip["trip"].id}/share-links',
        headers=auth(trip['owner']),
        json={},
    )
    share = {'X-Trip-Share-Token': planning_body(link)['token']}
    body = {'notes': 'Not allowed', 'based_on': None}

    assert client.put(trip['notes_url'], headers=auth(viewer), json=body).status_code == 403
    assert client.put(trip['notes_url'], headers=auth(outsider), json=body).status_code == 404
    assert client.put(trip['notes_url'], headers=share, json=body).status_code == 401
    assert client.put(trip['notes_url'], json=body).status_code == 401
    stop = planning_body(client.get(trip['base'], headers=auth(trip['owner'])))['stops'][0]
    assert stop['notes'] == ''


def test_notes_have_a_length_limit_and_left_the_stop_bodies(client, trip):
    too_long = client.put(
        trip['notes_url'],
        headers=auth(trip['owner']),
        json={'notes': 'x' * 20_001, 'based_on': None},
    )
    assert too_long.status_code == 422
    patch = client.patch(
        f'{trip["base"]}/stops/{trip["stop"]["id"]}',
        headers=auth(trip['owner'], 1),
        json={'notes': 'Old way'},
    )
    assert patch.status_code == 422


def test_migration_backfills_notes_updated_at(engine, db_session, trip):
    stop_id = trip['stop']['id']
    db_session.commit()
    db_session.close()
    root = Path(__file__).resolve().parents[3]
    config = Config(str(root / 'alembic.ini'))
    config.set_main_option('script_location', str(root / 'app/alembic'))
    config.set_main_option(
        'sqlalchemy.url', engine.url.render_as_string(hide_password=False)
    )
    command.downgrade(config, 'b1c3e5a7d902')
    with engine.begin() as connection:
        connection.execute(
            text("UPDATE itinerary_stops SET notes = 'Old notes' WHERE id = :id"),
            {'id': stop_id},
        )
    command.upgrade(config, 'head')
    with engine.connect() as connection:
        row = connection.execute(
            text(
                'SELECT notes_updated_at = updated_at, notes_updated_by '
                'FROM itinerary_stops WHERE id = :id'
            ),
            {'id': stop_id},
        ).one()
    assert tuple(row) == (True, None)
