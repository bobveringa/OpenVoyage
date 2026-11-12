"""Address search for stays: off by default, only for people who plan the trip,
through our server, and never leaking provider URLs or keys (5, 11.8, 11.9, 11.11).

Providers are never called: ``fetch_json`` is replaced in every test.
"""

from urllib.parse import parse_qs, urlsplit

import pytest

from core import security
from core.app_settings import (
    ADDRESS_SEARCH_GRAPHHOPPER_API_KEY,
    ADDRESS_SEARCH_GRAPHHOPPER_BASE_URL_KEY,
    ADDRESS_SEARCH_NOMINATIM_BASE_URL_KEY,
    ADDRESS_SEARCH_PHOTON_BASE_URL_KEY,
    ADDRESS_SEARCH_PROVIDER_KEY,
)
from factories.trips import add_trip_member, add_trip_viewer, create_trip
from factories.users import create_user
from models.database.user import UserRole
from planning_helpers import planning_body
from services import address_search
from services.address_search import AddressSearchUnavailableError, NominatimProvider

pytestmark = pytest.mark.integration

PHOTON_ANSWER = {'features': [{
    'geometry': {'type': 'Point', 'coordinates': [2.1963, 41.3866]},
    'properties': {'name': 'Hotel Arts Barcelona', 'street': 'Carrer de la Marina',
                   'housenumber': '19-21', 'postcode': '08005', 'city': 'Barcelona',
                   'country': 'Spain'},
}]}
NOMINATIM_ANSWER = [{
    'lat': '41.3866', 'lon': '2.1963', 'name': 'Hotel Arts Barcelona',
    'display_name': 'Hotel Arts Barcelona, 19-21, Carrer de la Marina, Barcelona, Spain',
    'address': {'road': 'Carrer de la Marina', 'house_number': '19-21', 'postcode': '08005',
                'city': 'Barcelona', 'country': 'Spain'},
}]
GRAPHHOPPER_ANSWER = {'hits': [{
    'point': {'lat': 41.3866, 'lng': 2.1963}, 'name': 'Hotel Arts Barcelona',
    'street': 'Carrer de la Marina', 'housenumber': '19-21', 'postcode': '08005',
    'city': 'Barcelona', 'country': 'Spain',
}]}
EXPECTED = {
    'name': 'Hotel Arts Barcelona',
    'address': 'Carrer de la Marina 19-21, 08005 Barcelona, Spain',
    'latitude': 41.3866,
    'longitude': 2.1963,
}


def auth(user):
    token = security.create_auth_tokens(subject=user.id, email=user.email)['access_token']
    return {'Authorization': f'Bearer {token}'}


class Provider:
    """Stands in for every provider: records the URLs and answers from a script."""

    def __init__(self, monkeypatch):
        self.urls: list[str] = []
        self.answer: object = PHOTON_ANSWER
        self.error = False
        monkeypatch.setattr(address_search, 'fetch_json', self.fetch)
        monkeypatch.setattr(NominatimProvider, '_last_public_request', 0.0)

    def fetch(self, url, headers=None):
        self.urls.append(url)
        if self.error:
            raise AddressSearchUnavailableError()
        return self.answer


@pytest.fixture
def provider(monkeypatch):
    return Provider(monkeypatch)


@pytest.fixture
def plan(client, db_session, api_prefix):
    owner = create_user(db_session, password='AddressPass123!')
    member = create_user(db_session, password='AddressPass123!')
    viewer = create_user(db_session, password='AddressPass123!')
    admin = create_user(db_session, password='AddressPass123!', role=UserRole.ADMIN)
    trip = create_trip(db_session, owner_id=owner.id)
    add_trip_member(db_session, trip_id=trip.id, user_id=member.id)
    add_trip_viewer(db_session, trip_id=trip.id, user_id=viewer.id, created_by=owner.id)
    base = f'{api_prefix}/trips/{trip.id}/itinerary/addresses'

    def configure(key, value):
        response = client.patch(f'{api_prefix}/admin/settings/{key}', headers=auth(admin),
                                json={'value': value})
        assert response.status_code == 200, response.text

    return {'owner': owner, 'member': member, 'viewer': viewer, 'trip': trip,
            'base': base, 'configure': configure}


def search(client, plan, user='owner', **params):
    params = {'query': 'hotel arts', 'near_latitude': 41.391234, 'near_longitude': 2.165678} | params
    return client.get(plan['base'] + '/geocode', headers=auth(plan[user]), params=params)


def test_address_search_is_off_by_default(client, plan, provider):
    for response in (
        search(client, plan),
        client.get(plan['base'] + '/reverse-geocode', headers=auth(plan['owner']),
                   params={'latitude': 41.38, 'longitude': 2.19}),
    ):
        assert response.status_code == 503
        assert response.json()['detail']['code'] == 'ADDRESS_SEARCH_OFF'
    assert provider.urls == []


def test_photon_search_sends_the_text_and_the_rough_area_only(client, plan, provider):
    plan['configure'](ADDRESS_SEARCH_PROVIDER_KEY, 'photon')
    plan['configure'](ADDRESS_SEARCH_PHOTON_BASE_URL_KEY, 'https://photon.internal.example')

    for user in ('owner', 'member'):
        response = search(client, plan, user)
        assert response.status_code == 200, response.text
        assert response.json() == [EXPECTED]
        assert response.headers['cache-control'] == 'private, no-store'

    url = urlsplit(provider.urls[0])
    assert f'{url.scheme}://{url.hostname}{url.path}' == 'https://photon.internal.example/api'
    sent = parse_qs(url.query)
    assert sent['q'] == ['hotel arts']
    # Two decimals: the stop's rough area, not its exact point.
    assert sent['lat'] == ['41.39'] and sent['lon'] == ['2.17']


def test_reverse_geocode_returns_one_address_or_null(client, plan, provider):
    plan['configure'](ADDRESS_SEARCH_PROVIDER_KEY, 'photon')
    url = plan['base'] + '/reverse-geocode'
    params = {'latitude': 41.3866, 'longitude': 2.1963}

    assert client.get(url, headers=auth(plan['owner']), params=params).json() == EXPECTED
    assert urlsplit(provider.urls[0]).path == '/reverse'
    provider.answer = {'features': []}
    assert client.get(url, headers=auth(plan['owner']), params=params).json() is None


def test_nominatim_and_graphhopper_answers_have_the_same_shape(client, plan, provider):
    plan['configure'](ADDRESS_SEARCH_PROVIDER_KEY, 'nominatim')
    plan['configure'](ADDRESS_SEARCH_NOMINATIM_BASE_URL_KEY, 'https://nominatim.internal.example')
    provider.answer = NOMINATIM_ANSWER
    assert search(client, plan).json() == [EXPECTED]
    assert parse_qs(urlsplit(provider.urls[-1]).query)['format'] == ['jsonv2']

    plan['configure'](ADDRESS_SEARCH_PROVIDER_KEY, 'graphhopper')
    plan['configure'](ADDRESS_SEARCH_GRAPHHOPPER_BASE_URL_KEY, 'https://gh.internal.example/api/1')
    # Without its own key, GraphHopper address search is unavailable.
    missing_key = search(client, plan)
    assert missing_key.status_code == 503
    assert missing_key.json()['detail']['code'] == 'ADDRESS_SEARCH_UNAVAILABLE'

    plan['configure'](ADDRESS_SEARCH_GRAPHHOPPER_API_KEY, 'address-key-123')
    provider.answer = GRAPHHOPPER_ANSWER
    assert search(client, plan).json() == [EXPECTED]
    sent = parse_qs(urlsplit(provider.urls[-1]).query)
    assert sent['key'] == ['address-key-123'] and sent['point'] == ['41.39,2.17']


def test_a_failing_provider_is_unavailable(client, plan, provider):
    plan['configure'](ADDRESS_SEARCH_PROVIDER_KEY, 'photon')
    provider.error = True
    response = search(client, plan)
    assert response.status_code == 503
    assert response.json()['detail']['code'] == 'ADDRESS_SEARCH_UNAVAILABLE'

    provider.error = False
    provider.answer = {'unexpected': True}
    assert search(client, plan).json()['detail']['code'] == 'ADDRESS_SEARCH_UNAVAILABLE'


def test_public_nominatim_gets_at_most_one_request_a_second(client, plan, provider):
    plan['configure'](ADDRESS_SEARCH_PROVIDER_KEY, 'nominatim')
    provider.answer = NOMINATIM_ANSWER

    assert search(client, plan).status_code == 200
    too_soon = search(client, plan)
    # Answered straight away instead of queueing.
    assert too_soon.status_code == 503
    assert too_soon.json()['detail'] == {
        **too_soon.json()['detail'],
        'code': 'ADDRESS_SEARCH_UNAVAILABLE',
        'message': 'Try again in a moment.',
    }
    assert too_soon.headers['retry-after'] == '1'
    assert len(provider.urls) == 1


def test_viewers_share_links_and_outsiders_cannot_search(client, db_session, plan, provider, api_prefix):
    plan['configure'](ADDRESS_SEARCH_PROVIDER_KEY, 'photon')
    outsider = create_user(db_session, password='AddressPass123!')
    link = client.post(f'{api_prefix}/trips/{plan["trip"].id}/share-links',
                       headers=auth(plan['owner']), json={})
    share = {'X-Trip-Share-Token': planning_body(link)['token']}

    for name, headers in {'viewer': auth(plan['viewer']), 'outsider': auth(outsider),
                          'share': share, 'anonymous': {}}.items():
        for path, params in (('/geocode', {'query': 'hotel'}),
                             ('/reverse-geocode', {'latitude': 41.38, 'longitude': 2.19})):
            response = client.get(plan['base'] + path, headers=headers, params=params)
            assert response.status_code in (401, 403, 404), (name, path, response.text)
    assert provider.urls == []


def test_public_settings_only_show_the_provider_name(client, plan, api_prefix):
    plan['configure'](ADDRESS_SEARCH_PROVIDER_KEY, 'graphhopper')
    plan['configure'](ADDRESS_SEARCH_GRAPHHOPPER_BASE_URL_KEY, 'https://gh.secret-host.example/api/1')
    plan['configure'](ADDRESS_SEARCH_PHOTON_BASE_URL_KEY, 'https://photon.secret-host.example')
    plan['configure'](ADDRESS_SEARCH_NOMINATIM_BASE_URL_KEY, 'https://nominatim.secret-host.example')
    plan['configure'](ADDRESS_SEARCH_GRAPHHOPPER_API_KEY, 'address-key-secret')

    public = client.get(f'{api_prefix}/settings/public')
    settings = public.json()['settings']
    assert settings[ADDRESS_SEARCH_PROVIDER_KEY] == 'graphhopper'
    assert not [key for key in settings if key.startswith('address_search.') and key != ADDRESS_SEARCH_PROVIDER_KEY]
    assert 'secret-host' not in public.text
    assert 'address-key-secret' not in public.text


def test_results_near_the_stop_come_first(client, plan, provider):
    plan['configure'](ADDRESS_SEARCH_PROVIDER_KEY, 'photon')
    far = {
        'geometry': {'type': 'Point', 'coordinates': [-114.0655, 51.0409]},
        'properties': {'name': 'Hotel Arts Gallery', 'city': 'Calgary', 'country': 'Canada'},
    }
    provider.answer = {'features': [far, PHOTON_ANSWER['features'][0]]}

    names = [item['name'] for item in search(client, plan).json()]
    assert names == ['Hotel Arts Barcelona', 'Hotel Arts Gallery']
