"""Overview route lines stop at the edge of privacy zones they end in (11.7, 11.11)."""

from datetime import date

import pytest

from core import security
from factories.places import create_place
from factories.trips import add_trip_member, add_trip_viewer, create_trip
from factories.users import create_user
from models.database.gps_privacy_zones import GpsPrivacyZone
from models.database.trips import TripVisibility
from planning_helpers import planning_body
from services.gps.geometry import haversine_meters

pytestmark = pytest.mark.integration

HOME = (52.067, 5.198)
AMSTERDAM = (52.37, 4.90)
HAARLEM = (52.38, 4.64)
STAY = (52.3600, 4.8800)


def auth(user, revision=None):
    token = security.create_auth_tokens(subject=user.id, email=user.email)['access_token']
    headers = {'Authorization': f'Bearer {token}'}
    if revision is not None:
        headers['If-Match'] = f'"{revision}"'
    return headers


def meters(point, center):
    """Distance of a ``[lon, lat]`` or ``{latitude, longitude}`` point to ``(lat, lon)``."""
    if isinstance(point, dict):
        point = [point['longitude'], point['latitude']]
    return haversine_meters(point[1], point[0], *center)


def all_points(value):
    """Every coordinate anywhere in a response, as ``[lon, lat]``."""
    if isinstance(value, dict):
        if 'latitude' in value and 'longitude' in value:
            yield [value['longitude'], value['latitude']]
        for key, item in value.items():
            if key == 'coordinates':
                yield from (list(pair) for pair in item)
            else:
                yield from all_points(item)
    elif isinstance(value, list):
        for item in value:
            yield from all_points(item)


class Trip:
    """Home in Bunnik, Amsterdam 1–3 Oct, Haarlem 3–5 Oct, then home again."""

    def __init__(self, client, db_session, api_prefix):
        self.client, self.db = client, db_session
        self.owner = create_user(db_session, password='RoutePrivacy123!')
        self.member = create_user(db_session, password='RoutePrivacy123!')
        self.viewer = create_user(db_session, password='RoutePrivacy123!')
        self.trip = create_trip(db_session, owner_id=self.owner.id,
                                start_date=date(2026, 10, 1), visibility=TripVisibility.PUBLIC)
        add_trip_member(db_session, trip_id=self.trip.id, user_id=self.member.id)
        add_trip_viewer(db_session, trip_id=self.trip.id, user_id=self.viewer.id,
                        created_by=self.owner.id)
        self.root = f'{api_prefix}/trips/{self.trip.id}'
        self.base = f'{self.root}/itinerary'
        self.revision = 0
        home = create_place(db_session, name='Bunnik', latitude=HOME[0], longitude=HOME[1],
                            country_code='NL', region='Utrecht Province',
                            full_name='Bunnik, Utrecht Province, Netherlands')
        stops = []
        for name, (lat, lon) in (('Amsterdam', AMSTERDAM), ('Haarlem', HAARLEM)):
            place = create_place(db_session, name=name, latitude=lat, longitude=lon,
                                 country_code='NL', region='North Holland',
                                 full_name=f'{name}, North Holland, Netherlands')
            response = client.post(
                self.base + '/stops', headers=auth(self.owner, self.revision),
                json={'location': {'place_id': str(place.id)}, 'title': f'{name} title',
                      'planned_nights': 2,
                      'placement': {'after_stop_id': stops[-1] if stops else None}},
            )
            assert response.status_code == 201, response.text
            data = planning_body(response)
            self.revision = data['itinerary_revision']
            stops = [stop['id'] for stop in data['stops']]
        self.stops = stops
        home_end = {'type': 'LOCATION', 'location': {'place_id': str(home.id)}}
        for body in (
            {'from': home_end, 'to': {'type': 'STOP', 'stop_id': stops[0]}},
            {'from': {'type': 'STOP', 'stop_id': stops[-1]}, 'to': home_end},
        ):
            response = client.post(self.base + '/connections', headers=auth(self.owner, self.revision),
                                   json=body | {'segments': [{'travel_mode': 'CAR'}]})
            assert response.status_code == 201, response.text
            self.revision = int(response.headers['etag'].strip('"'))

    def zone(self, user, center, radius):
        self.db.add(GpsPrivacyZone(user_id=user.id, name='Zone', latitude=center[0],
                                   longitude=center[1], radius_meters=radius))
        self.db.commit()

    def overview(self, user=None):
        response = self.client.get(self.base + '/overview', headers=auth(user or self.viewer))
        assert response.status_code == 200, response.text
        return response.json()

    def line(self, overview, kind):
        for connection in overview['connections']:
            ends = (connection['from']['type'], connection['to']['type'])
            if {'departure': ('LOCATION', 'STOP'), 'return': ('STOP', 'LOCATION'),
                    'between': ('STOP', 'STOP')}[kind] == ends:
                return connection
        return None


@pytest.fixture
def trip(client, db_session, api_prefix):
    return Trip(client, db_session, api_prefix)


def test_departure_and_return_stop_at_the_edge_of_a_home_zone(trip):
    before = trip.overview()
    assert trip.line(before, 'departure')['route']['geometry']['coordinates'][0] == [HOME[1], HOME[0]]
    trip.zone(trip.owner, HOME, 3000)
    overview = trip.overview()

    departure = trip.line(overview, 'departure')
    start = departure['route']['geometry']['coordinates'][0]
    assert 3000 < meters(start, HOME) < 3005
    assert departure['route']['geometry']['coordinates'][-1] == [AMSTERDAM[1], AMSTERDAM[0]]
    segment = departure['segments'][0]
    assert segment['geometry']['coordinates'][0] == start
    assert segment['from_endpoint'] == {'latitude': start[1], 'longitude': start[0],
                                        'name': 'Utrecht Province'}
    assert segment['to_endpoint']['name'] == 'Amsterdam'
    home = departure['from']['location']
    assert (home['latitude'], home['longitude']) == (start[1], start[0])
    assert (home['name'], home['full_name']) == ('Utrecht Province', 'Utrecht Province, Netherlands')

    back = trip.line(overview, 'return')
    finish = back['route']['geometry']['coordinates'][-1]
    assert 3000 < meters(finish, HOME) < 3005
    assert back['segments'][-1]['to_endpoint']['name'] == 'Utrecht Province'
    assert back['segments'][-1]['geometry']['coordinates'][-1] == finish
    assert back['to']['location']['latitude'] == finish[1]

    # Nothing inside the zone is left, and the home's name is gone.
    assert all(meters(point, HOME) > 3000 for point in all_points(overview))
    assert 'Bunnik' not in str(overview)
    # Members get the same cut version.
    assert trip.overview(trip.owner) == overview


def test_every_members_zone_counts_and_a_line_passing_through_is_drawn_in_full(trip):
    middle = ((AMSTERDAM[0] + HAARLEM[0]) / 2, (AMSTERDAM[1] + HAARLEM[1]) / 2)
    trip.zone(trip.owner, middle, 1000)
    between = trip.line(trip.overview(), 'between')
    assert between['route']['geometry']['coordinates'] == [
        [AMSTERDAM[1], AMSTERDAM[0]], [HAARLEM[1], HAARLEM[0]],
    ]

    trip.zone(trip.member, HAARLEM, 1500)
    between = trip.line(trip.overview(), 'between')
    finish = between['route']['geometry']['coordinates'][-1]
    assert 1500 < meters(finish, HAARLEM) < 1505
    assert between['segments'][0]['to_endpoint'] == {
        'latitude': finish[1], 'longitude': finish[0], 'name': 'North Holland',
    }
    # The Haarlem → home line starts at the same zone's edge.
    back = trip.line(trip.overview(), 'return')
    assert 1500 < meters(back['route']['geometry']['coordinates'][0], HAARLEM) < 1505


def test_a_line_entirely_inside_one_zone_is_left_out(trip):
    trip.zone(trip.member, AMSTERDAM, 30_000)
    overview = trip.overview()
    assert trip.line(overview, 'between') is None
    assert trip.line(overview, 'departure') is not None


def add_stay(trip):
    response = trip.client.post(
        trip.base + '/stays', headers=auth(trip.owner, trip.revision),
        json={'stop_id': trip.stops[0], 'stay_type': 'HOTEL', 'status': 'BOOKED',
              'name': 'Secret Hotel ZX9', 'address': 'Hidden lane 9', 'booking_reference': 'BK-ZX9',
              'check_in_date': '2026-10-01', 'check_out_date': '2026-10-03',
              'location': {'latitude': STAY[0], 'longitude': STAY[1]}},
    )
    assert response.status_code == 201, response.text
    trip.revision = planning_body(response)['itinerary_revision']


def test_stays_never_move_routes_or_reach_the_overview(trip):
    add_stay(trip)
    for reader in (trip.viewer, trip.owner, trip.member):
        overview = trip.overview(reader)
        assert all(meters(point, STAY) > 100 for point in all_points(overview))
        assert not any(secret in str(overview) for secret in ('Secret Hotel', 'ZX9', 'Hidden lane'))
        between = trip.line(overview, 'between')
        assert between['segments'][0]['from_endpoint']['name'] == 'Amsterdam'
    # Planning routes start at the town too.
    plan = trip.client.get(trip.base, headers=auth(trip.owner)).json()
    between = next(c for c in plan['connections'] if c['from']['type'] == c['to']['type'] == 'STOP')
    start = between['segments'][0]['from_endpoint']
    assert (start['latitude'], start['longitude']) == AMSTERDAM
