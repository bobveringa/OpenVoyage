"""Town search ignores accents, knows other names, forgives typos and ranks
districts below their city. Map clicks pick the town, not the hamlet (section 5)."""

import zipfile
from pathlib import Path

import pytest
from alembic import command
from alembic.config import Config
from sqlalchemy import text

from core import security
from factories.places import create_place
from factories.trips import create_trip
from factories.users import create_user
from models.database.base import utcnow
from models.database.places import Place, PlacePhoto
from planning_helpers import planning_body
from services.place_service import GeoNamesDataset, PlaceService

pytestmark = pytest.mark.integration


@pytest.fixture
def client(client, db_session):
    user = create_user(db_session)
    tokens = security.create_auth_tokens(subject=user.id, email=user.email)
    client.headers['Authorization'] = f'Bearer {tokens["access_token"]}'
    return client


def place(db_session, name, latitude, longitude, *, population=0, feature_code='PPL',
          country_code='NL', search_names=None, wikipedia_title=None):
    created = create_place(
        db_session, name=name, latitude=latitude, longitude=longitude,
        country_code=country_code, region='Region', full_name=f'{name}, Region',
        population=population,
    )
    created.feature_code = feature_code
    if search_names is not None:
        created.search_names = search_names
    created.wikipedia_title = wikipedia_title
    db_session.commit()
    return created


def names(response):
    assert response.status_code == 200, response.text
    return [item['name'] for item in response.json()]


def test_new_places_are_searchable_by_their_main_name(db_session):
    created = place(db_session, 'Málaga', 36.72, -4.42)
    assert created.search_names == '|malaga|'


def test_search_ignores_accents_and_folded_letters(client, db_session, api_prefix):
    place(db_session, 'Zürich', 47.37, 8.54, population=400_000, country_code='CH')
    place(db_session, 'Málaga', 36.72, -4.42, population=590_000, country_code='ES')
    place(db_session, 'København', 55.68, 12.57, population=600_000, country_code='DK')

    for query, expected in (('Zurich', 'Zürich'), ('malaga', 'Málaga'), ('Kobenhavn', 'København'),
                            ('Zürich', 'Zürich')):
        assert names(client.get(f'{api_prefix}/places/geocode', params={'query': query}))[0] == expected


def test_search_matches_other_language_names_but_shows_the_place_name(client, db_session, api_prefix):
    place(db_session, 'München', 48.14, 11.58, population=1_500_000, country_code='DE',
          search_names='|munchen|munich|monaco di baviera|')

    for query in ('Munich', 'monaco di', 'Mun'):
        response = client.get(f'{api_prefix}/places/geocode', params={'query': query})
        assert names(response) == ['München'], query


def test_search_forgives_typos_but_keeps_exact_matches_on_top(client, db_session, api_prefix):
    place(db_session, 'Barcelona', 41.39, 2.16, population=1_600_000, country_code='ES')
    place(db_session, 'Barclayville', 4.67, -8.23, population=4_000, country_code='LR')
    place(db_session, 'Barcelonne', 43.0, 0.1, population=300, country_code='FR')

    assert names(client.get(f'{api_prefix}/places/geocode', params={'query': 'Barcleona'}))[0] == 'Barcelona'
    # An exact name always beats a big city with a close spelling.
    assert names(client.get(f'{api_prefix}/places/geocode', params={'query': 'Barcelonne'}))[0] == 'Barcelonne'


def test_neighbourhoods_rank_below_their_city_and_say_where_they_are(client, db_session, api_prefix):
    place(db_session, 'Budapest XIII. kerület', 47.53, 19.07, population=118_000,
          feature_code='PPLX', country_code='HU')
    place(db_session, 'Budapest', 47.50, 19.04, population=1_700_000,
          feature_code='PPLC', country_code='HU')
    place(db_session, 'Budaörs', 47.46, 18.96, population=27_000, country_code='HU')

    response = client.get(f'{api_prefix}/places/geocode', params={'query': 'Budapest'})
    results = response.json()
    assert [item['name'] for item in results][:2] == ['Budapest', 'Budapest XIII. kerület']
    assert results[0]['part_of'] is None
    assert results[1]['part_of'] == 'Budapest'


def test_map_click_picks_the_town_over_a_closer_hamlet(client, db_session, api_prefix):
    place(db_session, 'Eindhoven', 51.4416, 5.4697, population=235_000)
    place(db_session, 'Hamlet', 51.4500, 5.4800, population=150)
    place(db_session, 'Villapark', 51.4510, 5.4810, population=2_000, feature_code='PPLX')

    response = client.get(f'{api_prefix}/places/reverse-geocode',
                          params={'latitude': 51.4505, 'longitude': 5.4805, 'limit': 3})
    assert [item['place']['name'] for item in response.json()] == ['Eindhoven', 'Villapark', 'Hamlet']


def test_map_click_keeps_a_neighbouring_town_apart_from_the_city(client, db_session, api_prefix):
    place(db_session, 'Eindhoven', 51.4416, 5.4697, population=235_000)
    place(db_session, 'Veldhoven', 51.4180, 5.4040, population=45_000)

    response = client.get(f'{api_prefix}/places/reverse-geocode',
                          params={'latitude': 51.4185, 'longitude': 5.4045})
    assert response.json()[0]['place']['name'] == 'Veldhoven'


def test_map_click_skips_districts_unless_nothing_else_is_near(client, db_session, api_prefix):
    place(db_session, 'Oud-Zuid', 52.35, 4.87, population=1_000, feature_code='PPLX')
    place(db_session, 'Village', 52.39, 4.87, population=100)

    near_village = client.get(f'{api_prefix}/places/reverse-geocode',
                              params={'latitude': 52.351, 'longitude': 4.871})
    assert near_village.json()[0]['place']['name'] == 'Village'

    db_session.query(Place).filter(Place.name == 'Village').delete()
    db_session.commit()
    only_district = client.get(f'{api_prefix}/places/reverse-geocode',
                               params={'latitude': 52.351, 'longitude': 4.871})
    assert only_district.json()[0]['place']['name'] == 'Oud-Zuid'


def test_map_click_in_the_countryside_falls_back_to_the_nearest_place(client, db_session, api_prefix):
    place(db_session, 'Far town', 52.0, 5.0, population=50_000)
    place(db_session, 'Farm', 52.30, 5.30, population=0)

    response = client.get(f'{api_prefix}/places/reverse-geocode',
                          params={'latitude': 52.32, 'longitude': 5.32})
    assert response.json()[0]['place']['name'] == 'Farm'


def test_stops_placed_on_the_map_get_the_town_name(client, db_session, api_prefix):
    """The shared lookup is behind map-click locations for stops, posts and photos."""
    owner = create_user(db_session)
    trip = create_trip(db_session, owner_id=owner.id)
    place(db_session, 'Eindhoven', 51.4416, 5.4697, population=235_000)
    place(db_session, 'Hamlet', 51.4500, 5.4800, population=150)
    token = security.create_auth_tokens(subject=owner.id, email=owner.email)['access_token']
    response = client.post(
        f'{api_prefix}/trips/{trip.id}/itinerary/stops',
        headers={'Authorization': f'Bearer {token}', 'If-Match': '"0"'},
        json={'location': {'latitude': 51.4502, 'longitude': 5.4802}, 'title': 'Clicked',
              'planned_nights': 1, 'placement': {'after_stop_id': None}},
    )
    assert response.status_code == 201, response.text
    assert planning_body(response)['stops'][0]['location']['name'] == 'Eindhoven'


def _write_zip(path, member, rows):
    with zipfile.ZipFile(path, 'w') as archive:
        archive.writestr(member, ''.join('\t'.join(row) + '\n' for row in rows))
    return path


def _geonames_row(geoname_id, name, ascii_name, latitude, longitude, population):
    return [geoname_id, name, ascii_name, '', latitude, longitude, 'P', 'PPLA', 'DE', '',
            '02', '', '', '', population, '', '', 'Europe/Berlin', '2026-10-20']


def test_place_import_adds_alternate_names_and_wikipedia_titles(db_session, tmp_path):
    cities = _write_zip(tmp_path / 'cities500.zip', 'cities500.txt', [
        _geonames_row('2867714', 'München', 'Muenchen', '48.137', '11.575', '1500000'),
        _geonames_row('2950159', 'Berlin', 'Berlin', '52.52', '13.40', '3400000'),
    ])
    aliases = _write_zip(tmp_path / 'alternateNamesV2.zip', 'alternateNamesV2.txt', [
        # id, geonameid, language, name, preferred, short, colloquial, historic
        ['1', '2867714', 'en', 'Munich', '1', '', '', ''],
        ['2', '2867714', 'it', 'Monaco di Baviera', '1', '', '', ''],
        ['3', '2867714', 'fr', 'Munich-sur-Isar', '', '', '', ''],      # not preferred: skipped
        ['4', '2867714', 'de', 'Munichen', '', '', '', '1'],            # historic: skipped
        ['5', '2867714', 'post', '80331', '1', '', '', ''],             # a code, not a name
        ['6', '2867714', 'link', 'https://en.wikipedia.org/wiki/Munich', '', '', '', ''],
        ['7', '2867714', 'link', 'https://de.wikipedia.org/wiki/M%C3%BCnchen', '', '', '', ''],
        ['8', '2950159', 'link', 'https://en.wikipedia.org/wiki/Berlin_%28city%29', '', '', '', ''],
        ['9', '9999999', 'en', 'Not imported', '1', '', '', ''],
    ])

    # Opened before the import, without a title: "no photo" was remembered.
    PlaceService(db_session).import_geonames_zip(cities, GeoNamesDataset.CITIES_500)
    berlin = db_session.query(Place).filter_by(external_id='2950159').one()
    db_session.add(PlacePhoto(place_id=berlin.id, status='NONE', fetched_at=utcnow()))
    db_session.commit()

    PlaceService(db_session).import_geonames_zip(
        cities, GeoNamesDataset.CITIES_500, alternate_names_path=aliases
    )

    # With titles now known, it may be asked once more.
    assert db_session.get(PlacePhoto, berlin.id) is None
    munich = db_session.query(Place).filter_by(external_id='2867714').one()
    assert munich.search_names == '|munchen|muenchen|munich|monaco di baviera|'
    assert munich.wikipedia_title == 'Munich'
    berlin = db_session.query(Place).filter_by(external_id='2950159').one()
    assert berlin.search_names == '|berlin|'
    assert berlin.wikipedia_title == 'Berlin (city)'

    # A later import without the link clears the title again.
    aliases = _write_zip(tmp_path / 'alternateNamesV2.zip', 'alternateNamesV2.txt', [
        ['1', '2867714', 'en', 'Munich', '1', '', '', ''],
    ])
    PlaceService(db_session).import_geonames_zip(
        cities, GeoNamesDataset.CITIES_500, alternate_names_path=aliases
    )
    db_session.expire_all()
    assert db_session.query(Place).filter_by(external_id='2867714').one().wikipedia_title is None


def test_migration_fills_search_names_from_the_main_name_and_downgrades(engine, db_session):
    place(db_session, 'Zürich', 47.37, 8.54, country_code='CH')
    db_session.close()
    root = Path(__file__).resolve().parents[3]
    config = Config(str(root / 'alembic.ini'))
    config.set_main_option('script_location', str(root / 'app/alembic'))
    config.set_main_option('sqlalchemy.url', engine.url.render_as_string(hide_password=False))

    command.downgrade(config, 'd3e5a7c9f124')
    with engine.connect() as connection:
        columns = connection.execute(text(
            "SELECT column_name FROM information_schema.columns WHERE table_name = 'places'"
        )).scalars().all()
        assert 'search_names' not in columns and 'wikipedia_title' not in columns
        assert connection.execute(text("SELECT to_regclass('place_photos')")).scalar() is None

    command.upgrade(config, 'head')
    with engine.connect() as connection:
        assert connection.execute(
            text("SELECT search_names FROM places WHERE name = 'Zürich'")
        ).scalar() == '|zurich|'
