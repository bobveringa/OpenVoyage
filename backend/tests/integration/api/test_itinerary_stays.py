"""Stays: where trip members sleep. Members only, never shown to viewers."""

from datetime import date

import pytest

from core import security
from factories.places import create_place
from factories.trips import add_trip_viewer, create_trip
from factories.users import create_user
from models.database.trips import TripVisibility
from planning_helpers import planning_body

pytestmark = pytest.mark.integration


def auth(user, revision=None):
    token = security.create_auth_tokens(subject=user.id, email=user.email)['access_token']
    headers = {'Authorization': f'Bearer {token}'}
    if revision is not None:
        headers['If-Match'] = f'"{revision}"'
    return headers


class Plan:
    """Eindhoven 1–3 Oct, then Barcelona 3–6 Oct."""

    def __init__(self, client, db_session, api_prefix, visibility=TripVisibility.PRIVATE):
        self.client = client
        self.owner = create_user(db_session, password='StaysPass123!')
        self.trip = create_trip(
            db_session,
            owner_id=self.owner.id,
            start_date=date(2026, 10, 1),
            visibility=visibility,
        )
        self.place = create_place(db_session, name='Barcelona', latitude=41.39, longitude=2.16)
        self.base = f'{api_prefix}/trips/{self.trip.id}/itinerary'
        self.revision = 0
        self.data = None
        self.add_stop('Eindhoven', 2)
        self.add_stop('Barcelona', 3, after='Eindhoven')

    def apply(self, response, status=200):
        assert response.status_code == status, response.text
        self.data = planning_body(response)
        self.revision = self.data['itinerary_revision']
        assert response.headers['etag'] == f'"{self.revision}"'
        return self.data

    def add_stop(self, title, nights, after=None):
        return self.apply(
            self.client.post(
                self.base + '/stops',
                headers=auth(self.owner, self.revision),
                json={
                    'location': {'place_id': str(self.place.id)},
                    'title': title,
                    'planned_nights': nights,
                    'placement': {'after_stop_id': self.stop(after)['id'] if after else None},
                },
            ),
            201,
        )

    def stop(self, title):
        return next(stop for stop in self.data['stops'] if stop['title'] == title)

    def add_stay(self, expect=201, **body):
        response = self.client.post(
            self.base + '/stays',
            headers=auth(self.owner, self.revision),
            json={'stop_id': self.stop('Barcelona')['id'], 'stay_type': 'HOTEL',
                  'name': 'Hotel Arts', 'check_in_date': '2026-10-03',
                  'check_out_date': '2026-10-05'} | body,
        )
        if expect != 201:
            assert response.status_code == expect, response.text
            return response
        return self.apply(response, 201)

    def patch_stay(self, stay_id, expect=200, **body):
        response = self.client.patch(
            f'{self.base}/stays/{stay_id}', headers=auth(self.owner, self.revision), json=body
        )
        if expect != 200:
            assert response.status_code == expect, response.text
            return response
        return self.apply(response)

    def patch_stop(self, title, **body):
        return self.apply(
            self.client.patch(
                f'{self.base}/stops/{self.stop(title)["id"]}',
                headers=auth(self.owner, self.revision),
                json=body,
            )
        )

    def stays(self, title='Barcelona'):
        return [
            (stay['name'], stay['status'], stay['check_in_date'], stay['check_out_date'])
            for stay in self.stop(title)['stays']
        ]


@pytest.fixture
def plan(client, db_session, api_prefix):
    return Plan(client, db_session, api_prefix)


def test_stays_are_added_edited_and_removed_with_the_revision(plan):
    revision = plan.revision
    plan.add_stay(
        location={'latitude': 41.3866, 'longitude': 2.1963},
        address='  Carrer de la Marina 19-21  ',
        check_in_time='15:00',
        booking_url='https://example.com/booking/4821',
        contact_phone='',
    )
    assert plan.revision == revision + 1
    stay = plan.stop('Barcelona')['stays'][0]
    assert stay | {'id': None, 'location': None} == {
        'id': None,
        'stop_id': plan.stop('Barcelona')['id'],
        'stay_type': 'HOTEL',
        'status': 'IDEA',
        'name': 'Hotel Arts',
        'address': 'Carrer de la Marina 19-21',
        'location': None,
        'check_in_date': '2026-10-03',
        'check_out_date': '2026-10-05',
        'check_in_time': '15:00',
        'check_out_time': None,
        'booking_reference': None,
        'booking_url': 'https://example.com/booking/4821',
        'contact_phone': None,
        'contact_email': None,
    }
    assert stay['location']['latitude'] == 41.3866
    assert stay['location']['timezone'] == 'Europe/Madrid'

    # Mark as booked, clear the pin and the link.
    plan.patch_stay(stay['id'], status='BOOKED', location=None, booking_url=None)
    edited = plan.stop('Barcelona')['stays'][0]
    assert (edited['status'], edited['location'], edited['booking_url']) == ('BOOKED', None, None)
    assert edited['address'] == 'Carrer de la Marina 19-21'

    removed = plan.client.delete(
        f'{plan.base}/stays/{stay["id"]}', headers=auth(plan.owner, plan.revision)
    )
    assert plan.apply(removed)['stops'][1]['stays'] == []
    stale = plan.client.delete(f'{plan.base}/stays/{stay["id"]}', headers=auth(plan.owner, 0))
    assert stale.status_code == 412


def test_stays_are_sorted_by_check_in_then_name(plan):
    plan.add_stay(name='Zebra Hostel', stay_type='HOSTEL', check_in_date='2026-10-04', check_out_date='2026-10-06')
    plan.add_stay(name='Casa Bonay', check_in_date='2026-10-04', check_out_date='2026-10-05')
    plan.add_stay(name='With Marta', stay_type='FRIENDS', check_in_date='2026-10-03', check_out_date='2026-10-04')
    assert [stay[0] for stay in plan.stays()] == ['With Marta', 'Casa Bonay', 'Zebra Hostel']
    assert plan.stays()[0][1] is None


@pytest.mark.parametrize(
    'body',
    [
        {'check_in_date': '2026-10-05', 'check_out_date': '2026-10-05'},
        {'check_in_date': '2026-10-02', 'check_out_date': '2026-10-04'},
        {'check_in_date': '2026-10-04', 'check_out_date': '2026-10-07'},
        {'stay_type': 'FRIENDS', 'status': 'BOOKED'},
        {'status': None},
        {'booking_url': 'javascript:alert(1)'},
        {'booking_url': 'ftp://example.com'},
        {'contact_email': 'not-an-email'},
        {'name': '   '},
        {'stay_type': 'CASTLE'},
    ],
)
def test_invalid_stays_are_rejected(plan, body):
    response = plan.add_stay(expect=422, **body)
    assert response.status_code == 422


def test_only_changed_dates_are_checked_so_misfit_bookings_stay_editable(plan):
    plan.add_stay(status='BOOKED', check_in_date='2026-10-03', check_out_date='2026-10-06')
    stay_id = plan.stop('Barcelona')['stays'][0]['id']
    plan.patch_stop('Barcelona', planned_nights=1)
    plan.patch_stay(stay_id, name='Hotel Arts Barcelona', check_in_time='14:00')
    assert plan.stays() == [('Hotel Arts Barcelona', 'BOOKED', '2026-10-03', '2026-10-06')]
    plan.patch_stay(stay_id, expect=422, check_out_date='2026-10-07')
    plan.patch_stay(stay_id, check_out_date='2026-10-04')
    plan.patch_stay(stay_id, expect=422, check_in_date='2026-10-05')


def test_type_changes_keep_the_status_rule(plan):
    plan.add_stay(status='BOOKED')
    stay_id = plan.stop('Barcelona')['stays'][0]['id']
    plan.patch_stay(stay_id, stay_type='OVERNIGHT_TRAVEL', name='Night train')
    assert plan.stays()[0][1] is None
    plan.patch_stay(stay_id, stay_type='CAMPING')
    assert plan.stays()[0][1] == 'IDEA'
    response = plan.client.patch(
        f'{plan.base}/stays/{stay_id}',
        headers=auth(plan.owner, plan.revision),
        json={'stay_type': 'FRIENDS', 'status': 'BOOKED'},
    )
    assert response.status_code == 422


def test_idea_stays_move_with_their_stop_and_booked_stays_do_not(plan):
    plan.add_stay(name='Idea', check_in_date='2026-10-03', check_out_date='2026-10-05')
    plan.add_stay(name='Booked', status='BOOKED', check_in_date='2026-10-03', check_out_date='2026-10-05')
    plan.add_stay(name='Friends', stay_type='FRIENDS', check_in_date='2026-10-05', check_out_date='2026-10-06')
    # An extra night in Eindhoven pushes Barcelona one day later.
    plan.patch_stop('Eindhoven', planned_nights=3)
    assert plan.stays() == [
        ('Booked', 'BOOKED', '2026-10-03', '2026-10-05'),
        ('Idea', 'IDEA', '2026-10-04', '2026-10-06'),
        ('Friends', None, '2026-10-05', '2026-10-06'),
    ]
    # Shortening the stop leaves ideas where they are.
    plan.patch_stop('Barcelona', planned_nights=1)
    assert ('Idea', 'IDEA', '2026-10-04', '2026-10-06') in plan.stays()
    # Moving the stop moves its ideas too.
    plan.patch_stop('Barcelona', placement={'after_stop_id': None})
    assert plan.stop('Barcelona')['planned_start_date'] == '2026-10-01'
    assert ('Idea', 'IDEA', '2026-10-01', '2026-10-03') in plan.stays()
    assert ('Booked', 'BOOKED', '2026-10-03', '2026-10-05') in plan.stays()


def test_deleting_a_stop_deletes_its_stays(plan, db_session):
    plan.add_stay(status='BOOKED')
    response = plan.client.delete(
        f'{plan.base}/stops/{plan.stop("Barcelona")["id"]}', headers=auth(plan.owner, plan.revision)
    )
    plan.apply(response)
    from sqlalchemy import text

    assert db_session.execute(text('SELECT count(*) FROM itinerary_stays')).scalar() == 0


def test_stays_cannot_cross_trips(client, db_session, api_prefix, plan):
    other = Plan(client, db_session, api_prefix)
    other.add_stay()
    foreign_stay = other.stop('Barcelona')['stays'][0]['id']
    assert plan.patch_stay(foreign_stay, expect=404, name='Mine now').status_code == 404
    assert plan.client.delete(
        f'{plan.base}/stays/{foreign_stay}', headers=auth(plan.owner, plan.revision)
    ).status_code == 404
    response = plan.add_stay(expect=404, stop_id=other.stop('Barcelona')['id'])
    assert response.status_code == 404
    # Both owners keep exactly their own stays.
    assert plan.client.get(other.base, headers=auth(plan.owner)).status_code == 404


@pytest.mark.parametrize('visibility', [TripVisibility.PUBLIC, TripVisibility.PRIVATE])
def test_viewers_and_share_links_can_never_read_or_change_stays(
    client, db_session, api_prefix, visibility
):
    plan = Plan(client, db_session, api_prefix, visibility=visibility)
    before_stay = client.get(plan.base + '/overview', headers=auth(plan.owner))
    assert before_stay.status_code == 200, before_stay.text
    assert planning_body(before_stay)['connections']
    plan.add_stay(
        name='Secret Hotel QZ77',
        status='BOOKED',
        address='Secret street 1',
        location={'latitude': 41.4041, 'longitude': 2.1755},
        booking_reference='REF-QZ77',
        booking_url='https://example.com/qz77',
        contact_phone='+34 600 000 000',
        contact_email='desk@qz77.example',
    )
    stay_id = plan.stop('Barcelona')['stays'][0]['id']
    stop_id = plan.stop('Barcelona')['id']
    viewer = create_user(db_session, password='StaysPass123!')
    outsider = create_user(db_session, password='StaysPass123!')
    add_trip_viewer(db_session, trip_id=plan.trip.id, user_id=viewer.id, created_by=plan.owner.id)
    link = client.post(
        f'{api_prefix}/trips/{plan.trip.id}/share-links', headers=auth(plan.owner), json={}
    )
    share = {'X-Trip-Share-Token': planning_body(link)['token']}
    readers = {'viewer': auth(viewer), 'share': share, 'outsider': auth(outsider), 'anonymous': {}}

    secrets = ['Secret Hotel', 'QZ77', 'Secret street', '41.4041', '2.1755', '600 000', 'stays']
    for name, headers in readers.items():
        for path in ('', f'/stops/{stop_id}'):
            response = client.get(plan.base + path, headers=headers)
            assert response.status_code in (403, 404), (name, path)
            assert not any(secret in response.text for secret in secrets)
        overview = client.get(plan.base + '/overview', headers=headers)
        if overview.status_code == 200:
            assert not any(secret in overview.text for secret in secrets), name
        writes = [
            client.post(plan.base + '/stays', headers=headers | {'If-Match': f'"{plan.revision}"'},
                        json={'stop_id': stop_id, 'stay_type': 'HOTEL', 'name': 'X',
                              'check_in_date': '2026-10-03', 'check_out_date': '2026-10-04'}),
            client.patch(f'{plan.base}/stays/{stay_id}', headers=headers | {'If-Match': f'"{plan.revision}"'},
                         json={'name': 'Hijacked'}),
            client.delete(f'{plan.base}/stays/{stay_id}', headers=headers | {'If-Match': f'"{plan.revision}"'}),
        ]
        assert all(write.status_code in (401, 403, 404) for write in writes), name
    owner_overview = client.get(plan.base + '/overview', headers=auth(plan.owner))
    assert owner_overview.status_code == 200, owner_overview.text
    assert planning_body(owner_overview) == planning_body(before_stay)
    assert plan.stays() == [('Secret Hotel QZ77', 'BOOKED', '2026-10-03', '2026-10-05')]
