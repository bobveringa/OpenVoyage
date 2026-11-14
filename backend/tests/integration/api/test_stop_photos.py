"""Stop header photos: members only, fetched once per town, never on view (11.8, 11.10, 11.11).

Wikipedia is never called: a fake client stands in for it.
"""

from datetime import timedelta
from io import BytesIO

import pytest
from PIL import Image

from api.deps import get_wikipedia_client
from core import security
from core.app_settings import PLACES_WIKIPEDIA_PHOTOS_KEY
from factories.places import create_place
from factories.trips import add_trip_member, add_trip_viewer, create_trip
from factories.users import create_user
from main import app
from models.database.places import PlacePhoto
from models.database.settings import AppSetting
from planning_helpers import planning_body
from services.place_photo_service import CommonsFile, PhotoFetchError, place_photo_path

pytestmark = pytest.mark.integration

EINDHOVEN = (51.4416, 5.4697)


def jpeg(width=1200, height=800) -> bytes:
    output = BytesIO()
    Image.new('RGB', (width, height), (40, 120, 200)).save(output, format='JPEG')
    return output.getvalue()


class FakeWikipedia:
    def __init__(self):
        self.calls: list[tuple[str, str]] = []
        self.lead: str | None = 'Eindhoven skyline.jpg'
        self.fail = False

    def lead_image(self, title, deadline):
        self.calls.append(('lead', title))
        if self.fail:
            raise PhotoFetchError('timeout')
        return self.lead

    def commons_file(self, file_name, deadline):
        self.calls.append(('commons', file_name))
        return CommonsFile(
            thumb_url='https://upload.wikimedia.org/thumb/800px-Eindhoven.jpg',
            source_url='https://commons.wikimedia.org/wiki/File:Eindhoven_skyline.jpg',
            credit='Diego Delso',
            license='CC BY-SA 3.0',
        )

    def download(self, url, deadline):
        self.calls.append(('download', url))
        return jpeg()


@pytest.fixture
def wikipedia():
    fake = FakeWikipedia()
    app.dependency_overrides[get_wikipedia_client] = lambda: fake
    yield fake
    app.dependency_overrides.pop(get_wikipedia_client, None)


def auth(user, revision=None):
    token = security.create_auth_tokens(subject=user.id, email=user.email)['access_token']
    headers = {'Authorization': f'Bearer {token}'}
    if revision is not None:
        headers['If-Match'] = f'"{revision}"'
    return headers


class Plan:
    def __init__(self, client, db_session, api_prefix):
        self.client, self.db = client, db_session
        self.owner = create_user(db_session, password='PhotoPass123!')
        self.member = create_user(db_session, password='PhotoPass123!')
        self.trip = create_trip(db_session, owner_id=self.owner.id)
        add_trip_member(db_session, trip_id=self.trip.id, user_id=self.member.id)
        self.base = f'{api_prefix}/trips/{self.trip.id}/itinerary'
        self.api_prefix = api_prefix
        self.revision = 0
        self.town = create_place(db_session, name='Eindhoven', latitude=EINDHOVEN[0],
                                 longitude=EINDHOVEN[1], country_code='NL', population=235_000)
        self.town.wikipedia_title = 'Eindhoven'
        db_session.commit()

    def add_stop(self, location, title='Stop'):
        response = self.client.post(
            self.base + '/stops', headers=auth(self.owner, self.revision),
            json={'location': location, 'title': title, 'planned_nights': 1,
                  'placement': {'after_stop_id': None}},
        )
        assert response.status_code == 201, response.text
        body = planning_body(response)
        self.revision = body['itinerary_revision']
        return next(stop for stop in body['stops'] if stop['title'] == title)

    def photo(self, stop, headers=None):
        return self.client.get(f'{self.base}/stops/{stop["id"]}/photo',
                               headers=auth(self.owner) if headers is None else headers)


@pytest.fixture
def plan(client, db_session, api_prefix):
    return Plan(client, db_session, api_prefix)


def test_members_get_the_photo_and_its_credit_fetched_once(plan, wikipedia, client):
    stop = plan.add_stop({'place_id': str(plan.town.id)})

    response = plan.photo(stop)
    assert response.status_code == 200, response.text
    body = response.json()
    assert body['credit'] == 'Diego Delso'
    assert body['license'] == 'CC BY-SA 3.0'
    assert body['source_url'] == 'https://commons.wikimedia.org/wiki/File:Eindhoven_skyline.jpg'
    assert f'/places/{plan.town.id}/photo?token=' in body['url']
    assert ('lead', 'Eindhoven') in wikipedia.calls

    # The stored copy is an 800 px WebP without the source metadata.
    image = Image.open(place_photo_path(plan.town.id))
    assert image.format == 'WEBP' and image.width == 800

    file = client.get(body['url'])
    assert file.status_code == 200
    assert file.headers['content-type'] == 'image/webp'

    # Every later card for this town, on any trip, gets our copy.
    wikipedia.calls.clear()
    other_stop = plan.add_stop({'place_id': str(plan.town.id)}, title='Again')
    assert plan.photo(other_stop, auth(plan.member)).json()['credit'] == 'Diego Delso'
    assert wikipedia.calls == []


def test_a_map_click_stop_uses_the_nearest_big_town_within_10_km(plan, wikipedia, db_session):
    create_place(db_session, name='Hamlet', latitude=51.47, longitude=5.50, population=200)
    stop = plan.add_stop({'latitude': 51.47, 'longitude': 5.50})
    location = stop['location']

    assert plan.photo(stop).json()['credit'] == 'Diego Delso'
    # Locations aren't changed for the photo.
    db_session.expire_all()
    from models.database.locations import Location
    assert db_session.get(Location, location['id']).source_place_id is None

    far = plan.add_stop({'latitude': 51.70, 'longitude': 5.90}, title='Far away')
    assert plan.photo(far).json() is None


def test_a_map_click_in_a_city_district_uses_the_city_photo(plan, wikipedia, db_session):
    district = create_place(
        db_session, name='Eindhoven district', latitude=51.45, longitude=5.48,
        country_code='NL', population=50_000,
    )
    # Some districts are imported as populated places, just like their city.
    district.feature_code = 'PPL'
    district.wikipedia_title = 'Eindhoven district'
    db_session.commit()

    stop = plan.add_stop({'latitude': district.latitude, 'longitude': district.longitude})

    assert stop['location']['name'] == 'Eindhoven'
    assert f'/places/{plan.town.id}/photo?' in plan.photo(stop).json()['url']
    assert [title for action, title in wikipedia.calls if action == 'lead'] == ['Eindhoven']


def test_moving_a_map_click_stop_to_another_town_keeps_the_original_photo(plan, wikipedia, db_session):
    neighbour = create_place(
        db_session, name='Veldhoven', latitude=51.418, longitude=5.404,
        country_code='NL', population=45_000,
    )
    neighbour.wikipedia_title = 'Veldhoven'
    db_session.commit()
    stop = plan.add_stop({'latitude': EINDHOVEN[0], 'longitude': EINDHOVEN[1]})

    response = plan.client.patch(
        f'{plan.base}/stops/{stop["id"]}', headers=auth(plan.owner, plan.revision),
        json={'marker': {'latitude': neighbour.latitude, 'longitude': neighbour.longitude}},
    )

    assert response.status_code == 200, response.text
    [moved_stop] = planning_body(response)['stops']
    assert moved_stop['location']['id'] != moved_stop['original_location']['id']
    assert f'/places/{plan.town.id}/photo?' in plan.photo(moved_stop).json()['url']
    assert [title for action, title in wikipedia.calls if action == 'lead'] == ['Eindhoven']


def test_small_places_get_the_designed_header_without_asking_wikipedia(plan, wikipedia, db_session):
    village = create_place(db_session, name='Liempde', latitude=51.57, longitude=5.37, population=4_000)
    village.wikipedia_title = 'Liempde'
    db_session.commit()
    stop = plan.add_stop({'place_id': str(village.id)})

    assert plan.photo(stop).json() is None
    assert wikipedia.calls == []


def test_no_photo_is_remembered(plan, wikipedia, db_session):
    wikipedia.lead = None
    stop = plan.add_stop({'place_id': str(plan.town.id)})

    assert plan.photo(stop).json() is None
    assert db_session.get(PlacePhoto, plan.town.id).status == 'NONE'
    wikipedia.calls.clear()
    assert plan.photo(stop).json() is None
    assert wikipedia.calls == []


def test_a_town_without_a_wikipedia_title_is_none_without_asking(plan, wikipedia, db_session):
    plan.town.wikipedia_title = None
    db_session.commit()
    stop = plan.add_stop({'place_id': str(plan.town.id)})

    assert plan.photo(stop).json() is None
    assert wikipedia.calls == []
    assert db_session.get(PlacePhoto, plan.town.id).status == 'NONE'


def test_a_failed_fetch_is_retried_after_an_hour_at_most(plan, wikipedia, db_session):
    wikipedia.fail = True
    stop = plan.add_stop({'place_id': str(plan.town.id)})

    assert plan.photo(stop).json() is None
    row = db_session.get(PlacePhoto, plan.town.id)
    assert row.status == 'FAILED'

    wikipedia.calls.clear()
    wikipedia.fail = False
    assert plan.photo(stop).json() is None
    assert wikipedia.calls == []

    row.fetched_at = row.fetched_at - timedelta(hours=1, minutes=1)
    db_session.commit()
    assert plan.photo(stop).json()['credit'] == 'Diego Delso'


def test_photos_switched_off_give_every_stop_the_designed_header(plan, wikipedia, db_session):
    db_session.add(AppSetting(key=PLACES_WIKIPEDIA_PHOTOS_KEY, value=False))
    db_session.commit()
    stop = plan.add_stop({'place_id': str(plan.town.id)})

    assert plan.photo(stop).json() is None
    assert wikipedia.calls == []


def test_viewers_and_share_links_are_refused_and_viewing_never_contacts_wikipedia(
    plan, wikipedia, client, db_session, api_prefix
):
    stop = plan.add_stop({'place_id': str(plan.town.id)})
    viewer = create_user(db_session, password='PhotoPass123!')
    outsider = create_user(db_session, password='PhotoPass123!')
    add_trip_viewer(db_session, trip_id=plan.trip.id, user_id=viewer.id, created_by=plan.owner.id)
    link = client.post(f'{api_prefix}/trips/{plan.trip.id}/share-links', headers=auth(plan.owner), json={})
    share = {'X-Trip-Share-Token': planning_body(link)['token']}

    for name, headers in {'viewer': auth(viewer), 'share': share, 'outsider': auth(outsider),
                          'anonymous': {}}.items():
        response = plan.photo(stop, headers)
        assert response.status_code in (401, 403, 404), name
        assert 'token=' not in response.text

    # Opening the trip, its overview and a stop never asks Wikipedia.
    for path in ('', '/overview', f'/stops/{stop["id"]}'):
        assert client.get(plan.base + path, headers=auth(plan.owner)).status_code == 200
    assert wikipedia.calls == []


def test_the_photo_file_needs_its_own_valid_token(plan, wikipedia, client, api_prefix):
    stop = plan.add_stop({'place_id': str(plan.town.id)})
    url = plan.photo(stop).json()['url']
    assert client.get(url).status_code == 200

    file_url = f'{api_prefix}/places/{plan.town.id}/photo'
    other_place = create_place(plan.db, name='Elsewhere')
    expired = security.create_token(
        subject=plan.town.id, token_type=security.TOKEN_TYPE_PLACE_PHOTO,
        expires_delta=timedelta(seconds=-5),
    )
    for token in (None, 'not-a-token', expired,
                  security.create_place_photo_url_token(other_place.id),
                  security.create_media_url_token(plan.town.id)):
        params = {} if token is None else {'token': token}
        assert client.get(file_url, params=params).status_code == 404, token
    # A signed-in member without a token is refused too: the token is the key.
    assert client.get(file_url, headers=auth(plan.owner)).status_code == 404
