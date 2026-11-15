"""Stop order is stored, and one date rule keeps the gaps between stops."""

from datetime import date
from pathlib import Path

import pytest
from alembic import command
from alembic.config import Config
from sqlalchemy import text

from core import security
from factories.places import create_place
from factories.trips import create_trip
from factories.users import create_user
from planning_helpers import planning_body

pytestmark = pytest.mark.integration


class Plan:
    def __init__(self, client, db_session, api_prefix, *, end_date=None):
        self.client = client
        self.owner = create_user(db_session, password='ItineraryPass123!')
        self.trip = create_trip(
            db_session,
            owner_id=self.owner.id,
            start_date=date(2026, 10, 1),
            end_date=end_date,
        )
        self.place = create_place(db_session, name='Somewhere')
        self.base = f'{api_prefix}/trips/{self.trip.id}/itinerary'
        self.revision = 0
        self.data = None

    def headers(self):
        token = security.create_auth_tokens(
            subject=self.owner.id, email=self.owner.email
        )['access_token']
        return {'Authorization': f'Bearer {token}', 'If-Match': f'"{self.revision}"'}

    def _apply(self, response, status=200):
        assert response.status_code == status, response.text
        self.data = planning_body(response)
        self.revision = self.data['itinerary_revision']
        return self.data

    def add(self, title, nights, *, after=None, start=None):
        body = {
            'location': {'place_id': str(self.place.id)},
            'title': title,
            'planned_nights': nights,
            'placement': {'after_stop_id': self.id(after) if after else None},
        }
        if start:
            body['planned_start_date'] = start
        return self._apply(
            self.client.post(self.base + '/stops', headers=self.headers(), json=body),
            201,
        )

    def patch(self, title, **body):
        return self._apply(
            self.client.patch(
                f'{self.base}/stops/{self.id(title)}', headers=self.headers(), json=body
            )
        )

    def delete(self, title):
        return self._apply(
            self.client.delete(
                f'{self.base}/stops/{self.id(title)}', headers=self.headers()
            )
        )

    def id(self, title):
        return next(stop['id'] for stop in self.data['stops'] if stop['title'] == title)

    def schedule(self):
        return [
            (stop['title'], stop['planned_start_date'], stop['planned_nights'])
            for stop in self.data['stops']
        ]


@pytest.fixture
def plan(client, db_session, api_prefix):
    plan = Plan(client, db_session, api_prefix)
    plan.add('Eindhoven', 2)
    plan.add('Home', 7, after='Eindhoven', start='2026-10-05')
    plan.add('Barcelona', 3, after='Home')
    return plan


def test_new_stops_default_to_the_previous_leave_date_and_keep_gaps(plan):
    assert plan.schedule() == [
        ('Eindhoven', '2026-10-01', 2),
        ('Home', '2026-10-05', 7),
        ('Barcelona', '2026-10-12', 3),
    ]
    assert 'same_day_position' not in plan.data['stops'][0]

    plan.add('Utrecht', 1, after='Eindhoven')
    assert plan.schedule() == [
        ('Eindhoven', '2026-10-01', 2),
        ('Utrecht', '2026-10-03', 1),
        ('Home', '2026-10-06', 7),
        ('Barcelona', '2026-10-13', 3),
    ]

    plan.add('Amsterdam', 1)
    assert plan.schedule()[:2] == [
        ('Amsterdam', '2026-10-01', 1),
        ('Eindhoven', '2026-10-02', 2),
    ]


def test_changing_nights_or_arrival_moves_only_this_and_later_stops(plan):
    plan.patch('Eindhoven', planned_nights=3)
    assert plan.schedule() == [
        ('Eindhoven', '2026-10-01', 3),
        ('Home', '2026-10-06', 7),
        ('Barcelona', '2026-10-13', 3),
    ]

    plan.patch('Home', planned_start_date='2026-10-04')
    assert plan.schedule() == [
        ('Eindhoven', '2026-10-01', 3),
        ('Home', '2026-10-04', 7),
        ('Barcelona', '2026-10-11', 3),
    ]

    plan.patch('Barcelona', planned_start_date='2026-10-14', planned_nights=1)
    assert plan.schedule()[-1] == ('Barcelona', '2026-10-14', 1)


def test_a_date_change_never_changes_the_order(plan):
    """An arrival before the previous stop leaves is an overlap, not a move."""
    plan.patch('Barcelona', planned_start_date='2026-09-20')
    assert plan.schedule() == [
        ('Eindhoven', '2026-10-01', 2),
        ('Home', '2026-10-05', 7),
        ('Barcelona', '2026-09-20', 3),
    ]
    reloaded = plan.client.get(plan.base, headers=plan.headers())
    assert [stop['title'] for stop in planning_body(reloaded)['stops']] == [
        'Eindhoven',
        'Home',
        'Barcelona',
    ]


def test_deleting_a_stop_pulls_later_stops_forward(plan):
    plan.delete('Eindhoven')
    assert plan.schedule() == [
        ('Home', '2026-10-03', 7),
        ('Barcelona', '2026-10-10', 3),
    ]


def test_moving_a_stop_is_a_removal_followed_by_an_insertion(plan):
    # Down: the stops after its old spot move earlier, it arrives when the
    # stop before its new spot leaves, and the stops after it move later.
    plan.patch('Eindhoven', placement={'after_stop_id': plan.id('Home')})
    assert plan.schedule() == [
        ('Home', '2026-10-03', 7),
        ('Eindhoven', '2026-10-10', 2),
        ('Barcelona', '2026-10-12', 3),
    ]
    # Up to the front: it takes the arrival date of the stop it displaces.
    plan.patch('Barcelona', placement={'after_stop_id': None})
    assert plan.schedule() == [
        ('Barcelona', '2026-10-03', 3),
        ('Home', '2026-10-06', 7),
        ('Eindhoven', '2026-10-13', 2),
    ]
    # Move, then arrival date, then nights.
    plan.patch(
        'Eindhoven',
        placement={'after_stop_id': plan.id('Barcelona')},
        planned_start_date='2026-10-07',
        planned_nights=1,
    )
    assert plan.schedule() == [
        ('Barcelona', '2026-10-03', 3),
        ('Eindhoven', '2026-10-07', 1),
        ('Home', '2026-10-08', 7),
    ]


def test_placement_at_the_current_spot_changes_nothing(plan):
    revision = plan.revision
    plan.patch('Home', placement={'after_stop_id': plan.id('Eindhoven')})
    assert plan.revision == revision
    assert plan.schedule()[1] == ('Home', '2026-10-05', 7)


def test_stops_may_run_past_the_trip_end(client, db_session, api_prefix):
    plan = Plan(client, db_session, api_prefix, end_date=date(2026, 10, 3))
    plan.add('Long stay', 10)
    plan.add('After the trip', 2, after='Long stay')
    assert plan.schedule()[-1] == ('After the trip', '2026-10-11', 2)


def test_positions_stay_unique_and_contiguous(plan, db_session):
    plan.patch('Barcelona', placement={'after_stop_id': None})
    plan.delete('Home')
    plan.add('Porto', 1, after='Barcelona')
    rows = db_session.execute(
        text(
            'SELECT title, position FROM itinerary_stops '
            'WHERE trip_id = :trip ORDER BY position'
        ),
        {'trip': plan.trip.id},
    ).all()
    assert [tuple(row) for row in rows] == [
        ('Barcelona', 0),
        ('Porto', 1),
        ('Eindhoven', 2),
    ]


def test_migration_fills_position_from_the_old_date_order(engine, plan, db_session):
    root = Path(__file__).resolve().parents[3]
    config = Config(str(root / 'alembic.ini'))
    config.set_main_option('script_location', str(root / 'app/alembic'))
    config.set_main_option(
        'sqlalchemy.url', engine.url.render_as_string(hide_password=False)
    )
    trip_id = plan.trip.id
    db_session.commit()
    db_session.close()
    command.downgrade(config, '5e7a9c1b3d24')
    with engine.begin() as connection:
        # Two stops on one date, in reverse same-day order.
        connection.execute(
            text(
                "UPDATE itinerary_stops SET planned_start_date = '2026-10-05', "
                "same_day_position = CASE title WHEN 'Barcelona' THEN 0 ELSE 1 END "
                "WHERE title IN ('Home', 'Barcelona')"
            )
        )
    command.upgrade(config, 'head')
    with engine.connect() as connection:
        rows = connection.execute(
            text(
                'SELECT title, position FROM itinerary_stops '
                'WHERE trip_id = :trip ORDER BY position'
            ),
            {'trip': trip_id},
        ).all()
    assert [tuple(row) for row in rows] == [
        ('Eindhoven', 0),
        ('Barcelona', 1),
        ('Home', 2),
    ]
