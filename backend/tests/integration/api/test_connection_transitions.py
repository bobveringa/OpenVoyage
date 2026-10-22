# ruff: noqa: F811
"""Reordering, normalization and migration boundaries for the shared leg model."""

import uuid
from pathlib import Path

import pytest
from alembic import command
from alembic.config import Config
from sqlalchemy import select
from sqlalchemy.exc import DBAPIError
from sqlalchemy.orm import Session

from factories.places import create_place
from integration.api.test_outer_connections import outer_body, write_body
from integration.services.test_itinerary_route_service import (
    headers,
    plan,  # noqa: F401
    enable_routes,
)
from models.database.itinerary import ItineraryTravelSegment, ItineraryPlanningArtifact
from models.database.locations import Location
from models.database.places import Place
from services.route_providers import RouteResponse


@pytest.mark.parametrize('moving_index', [0, 1])
def test_reorder_confirms_the_complete_graph_and_keeps_outer_ids(
    client, plan, moving_index
):  # noqa: F811
    user, _, base, endpoint, revision, interior, data = plan
    changed = client.put(
        endpoint,
        headers=headers(user, revision),
        json=write_body(
            interior, notes='Booked interior', segments=[{'travel_mode': 'TRAIN'}]
        ),
    )
    assert changed.status_code == 200, changed.text
    revision = changed.headers['etag']
    outer = []
    for side in ('DEPARTURE', 'RETURN'):
        created = client.post(
            base + '/connections',
            headers=headers(user, revision),
            json=outer_body(
                data, side, notes=side, segments=[{'travel_mode': 'TRAIN'}]
            ),
        )
        assert created.status_code == 201, created.text
        revision = created.headers['etag']
        outer.append(created.json())
    moving = data['stops'][moving_index]
    other = data['stops'][1 - moving_index]
    url = base + '/stops/' + moving['id']
    payload = {
        'placement': {
            'planned_start_date': moving['planned_start_date'],
            'after_stop_id': other['id'] if moving_index == 0 else None,
        }
    }
    blocked = client.patch(url, headers=headers(user, revision), json=payload)
    assert blocked.status_code == 409, blocked.text
    assert {item['id'] for item in blocked.json()['detail']['connections']} == {
        interior['id'],
        *[item['id'] for item in outer],
    }
    before = client.get(base, headers=headers(user))
    assert before.headers['etag'] == revision
    assert [stop['id'] for stop in before.json()['stops']] == [
        stop['id'] for stop in data['stops']
    ]
    confirmed = client.patch(
        url + '?confirm_travel_deletion=true',
        headers=headers(user, revision),
        json=payload,
    )
    assert confirmed.status_code == 200, confirmed.text
    assert [stop['id'] for stop in confirmed.json()['stops']] == [
        data['stops'][1]['id'],
        data['stops'][0]['id'],
    ]
    legs = confirmed.json()['legs']
    assert legs[0]['id'] == outer[0]['id']
    assert legs[-1]['id'] == outer[1]['id']
    assert legs[0]['from'] == outer[0]['from']
    assert legs[-1]['to'] == outer[1]['to']
    assert all(leg['notes'] == '' for leg in legs)
    assert all(leg['segments'][0]['mode_source'] == 'AUTO' for leg in legs)
    assert interior['id'] not in {leg['id'] for leg in legs}


def test_place_and_coordinate_inputs_share_noop_and_preview_identity(
    client, db_session, plan
):  # noqa: F811
    user, _, base, _, revision, _, data = plan
    place = create_place(db_session, name='Schiphol', latitude=52.31, longitude=4.76)
    body = outer_body(data)
    body['from']['location'] = {'place_id': str(place.id)}
    created = client.post(base + '/connections', headers=headers(user, revision), json=body)
    assert created.status_code == 201, created.text
    leg, revision = created.json(), created.headers['etag']
    endpoint = base + '/connections/' + leg['id']
    location_count = len(list(db_session.scalars(select(Location))))
    same = client.put(endpoint, headers=headers(user, revision), json=write_body(leg))
    assert same.status_code == 200, same.text
    assert same.headers['etag'] == revision
    assert same.json()['from'] == leg['from']
    assert len(list(db_session.scalars(select(Location)))) == location_count
    travel = {'segments': [{'travel_mode': 'TRAIN'}]}
    one = client.post(
        endpoint + '/preview', headers=headers(user, revision), json=body | travel
    )
    two = client.post(
        endpoint + '/preview',
        headers=headers(user, revision),
        json=write_body(leg, **travel),
    )
    assert one.status_code == two.status_code == 200
    assert one.json()['preview_id'] == two.json()['preview_id']


def test_inferred_flight_remains_uncustomized_and_reset_is_full_replacement(
    client, plan
):  # noqa: F811
    user, _, base, _, revision, _, data = plan
    body = outer_body(data)
    body['from']['location'] = {'latitude': -33.92, 'longitude': 18.42}
    created = client.post(base + '/connections', headers=headers(user, revision), json=body)
    assert created.status_code == 201, created.text
    leg, revision = created.json(), created.headers['etag']
    assert leg['segments'][0]['intent']['travel_mode'] == 'FLIGHT'
    endpoint = base + '/connections/' + leg['id']
    custom = client.put(
        endpoint,
        headers=headers(user, revision),
        json=body
        | {
            'notes': 'Custom',
            'segments': [{'travel_mode': 'TRAIN', 'mode_selected': True}],
        },
    )
    assert custom.status_code == 200, custom.text
    reset = client.put(
        endpoint, headers=headers(user, custom.headers['etag']), json=body
    )
    assert reset.status_code == 200, reset.text
    assert reset.json()['notes'] == ''
    assert reset.json()['segments'][0]['mode_source'] == 'AUTO'
    assert reset.json()['segments'][0]['intent']['travel_mode'] == 'FLIGHT'
    deleted = client.delete(endpoint, headers=headers(user, reset.headers['etag']))
    assert deleted.status_code == 200, deleted.text


def test_migration_downgrade_requires_explicit_outer_removal_and_preserves_children(
    client, db_session, engine, plan
):  # noqa: F811
    user, _, base, _, revision, _, data = plan
    created = client.post(
        base + '/connections', headers=headers(user, revision), json=outer_body(data)
    )
    assert created.status_code == 201, created.text
    leg, revision = created.json(), created.headers['etag']
    segment_id = uuid.UUID(leg['segments'][0]['id'])
    root = Path(__file__).resolve().parents[3]
    config = Config(str(root / 'alembic.ini'))
    config.set_main_option('script_location', str(root / 'app/alembic'))
    config.set_main_option(
        'sqlalchemy.url', engine.url.render_as_string(hide_password=False)
    )
    db_session.commit()
    with pytest.raises(DBAPIError, match='Remove departure and return connections'):
        command.downgrade(config, 'c7e9f1a3b502')
    assert db_session.get(ItineraryTravelSegment, segment_id) is not None
    deleted = client.delete(
        base + '/connections/' + leg['id'], headers=headers(user, revision)
    )
    assert deleted.status_code == 200, deleted.text
    assert db_session.get(ItineraryTravelSegment, segment_id) is None
    db_session.commit()
    command.downgrade(config, 'c7e9f1a3b502')
    command.upgrade(config, 'head')
    assert client.get(base, headers=headers(user)).status_code == 200


def test_preview_rechecks_resolved_outside_place_after_provider_work(
    client, db_session, engine, plan, monkeypatch
):
    user, trip, base, _, revision, _, data = plan
    place = create_place(
        db_session, name='Outside anchor', latitude=51.5, longitude=-0.1
    )
    place_id = place.id
    body = outer_body(data)
    body['from']['location'] = {'place_id': str(place_id)}
    created = client.post(base + '/connections', headers=headers(user, revision), json=body)
    assert created.status_code == 201, created.text
    leg, revision = created.json(), created.headers['etag']

    def update_place_during_calculation(*args, **kwargs):
        with Session(engine) as other:
            other.get(Place, place_id).latitude = 50
            other.commit()
        return RouteResponse(
            geometry_geojson={
                'type': 'LineString',
                'coordinates': [[-0.1, 51.5], [5.12, 52.09]],
            },
            distance_meters=1000,
            duration_seconds=100,
        )

    enable_routes(db_session, monkeypatch, update_place_during_calculation)
    preview = client.post(
        base + '/connections/' + leg['id'] + '/preview',
        headers=headers(user, revision),
        json=body | {'segments': [{'travel_mode': 'CAR'}]},
    )
    assert preview.status_code == 412, preview.text
    assert not list(
        db_session.scalars(
            select(ItineraryPlanningArtifact).where(
                ItineraryPlanningArtifact.trip_id == trip.id
            )
        )
    )
