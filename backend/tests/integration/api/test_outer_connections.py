# ruff: noqa: F811
"""Outer journeys share itinerary topology, revision and access boundaries."""

from planning_helpers import planning_body

import uuid
from datetime import timedelta
from unittest.mock import Mock

import pytest
from sqlalchemy import func, select, text
from sqlalchemy.exc import IntegrityError

from factories.trips import add_trip_member, add_trip_viewer, create_trip
from factories.users import create_user
from integration.services.test_itinerary_route_service import (
    headers,
    plan,  # noqa: F401
    enable_routes,
    matched_lookup,
)
from models.database.itinerary import ItineraryPlanningArtifact, ItineraryConnection
from models.database.locations import Location
from models.database.trips import TripVisibility
from services.route_providers import GraphHopperRouteProvider, RouteResponse


def outer_body(data, side='DEPARTURE', **travel):
    stop = {
        'type': 'STOP',
        'stop_id': data['stops'][0 if side == 'DEPARTURE' else -1]['id'],
    }
    outside = {'type': 'LOCATION', 'location': {'latitude': 51.5, 'longitude': -0.1}}
    return (
        {'from': outside, 'to': stop}
        if side == 'DEPARTURE'
        else {'from': stop, 'to': outside}
    ) | travel


def write_body(connection, **travel):
    def endpoint(value):
        return (
            value
            if value['type'] == 'STOP'
            else {
                'type': 'LOCATION',
                'location': {
                    key: value['location'][key] for key in ('latitude', 'longitude')
                },
            }
        )

    return {'from': endpoint(connection['from']), 'to': endpoint(connection['to']), **travel}


@pytest.mark.parametrize('side', ['DEPARTURE', 'RETURN'])
@pytest.mark.parametrize(
    'latitude,longitude,mode', [(51.5, -0.1, 'CAR'), (-33.92, 18.42, 'FLIGHT')]
)
def test_unsaved_outer_preview_uses_regular_default_mode_and_saves_it(
    client, db_session, plan, monkeypatch, side, latitude, longitude, mode
):
    user, _, base, _, revision, _, data = plan
    route = enable_routes(
        db_session,
        monkeypatch,
        RouteResponse(
            geometry_geojson={
                'type': 'LineString',
                'coordinates': [[longitude, latitude], [4.9, 52.37]],
            },
            distance_meters=1000,
            duration_seconds=100,
        ),
    )
    body = outer_body(data, side)
    body['from' if side == 'DEPARTURE' else 'to']['location'] = {
        'latitude': latitude,
        'longitude': longitude,
    }
    response = client.post(
        base + '/connections/preview', headers=headers(user, revision), json=body
    )
    assert response.status_code == 200, response.text
    preview = planning_body(response)
    segment = preview['connection']['segments'][0]
    assert segment['intent']['travel_mode'] == mode
    assert segment['mode_source'] == 'AUTO'
    assert route.call_count == (1 if mode == 'CAR' else 0)
    saved = client.post(
        base + '/connections',
        headers=headers(user, revision),
        json=body
        | {
            'segments': [segment['intent']],
            'preview_id': preview['preview_id'],
        },
    )
    assert saved.status_code == 201, saved.text
    assert planning_body(saved)['segments'][0]['intent']['travel_mode'] == mode
    assert route.call_count == (1 if mode == 'CAR' else 0)


@pytest.mark.parametrize('side', ['DEPARTURE', 'RETURN'])
@pytest.mark.parametrize('failure', ['disabled', 'unavailable'])
@pytest.mark.parametrize('echo_segments', [False, True])
def test_unsaved_outer_fallback_preview_can_be_saved(
    client, db_session, plan, monkeypatch, side, failure, echo_segments
):
    from services.route_providers.route_provider import RouteProviderError

    user, trip, base, _, revision, _, data = plan
    route = None
    if failure == 'unavailable':
        def unavailable(*args, **kwargs):
            raise RouteProviderError('No road connection')

        route = enable_routes(db_session, monkeypatch, unavailable)
    body = outer_body(data, side)
    preview = client.post(
        base + '/connections/preview', headers=headers(user, revision), json=body
    )
    assert preview.status_code == 200, preview.text
    segment = planning_body(preview)['connection']['segments'][0]
    assert segment['intent']['travel_mode'] == 'OTHER'
    again = client.post(
        base + '/connections/preview', headers=headers(user, revision), json=body
    )
    assert again.status_code == 200, again.text
    assert planning_body(again)['preview_id'] == planning_body(preview)['preview_id']
    payload = body | {'preview_id': planning_body(preview)['preview_id']}
    if echo_segments:
        payload['segments'] = [segment['intent']]
    # A normalized suggestion remains bound to the original outside endpoint.
    wrong_endpoint = 'from' if side == 'DEPARTURE' else 'to'
    changed = payload | {
        wrong_endpoint: {
            'type': 'LOCATION', 'location': {'latitude': 50.85, 'longitude': 4.35}
        }
    }
    rejected = client.post(
        base + '/connections', headers=headers(user, revision), json=changed
    )
    assert rejected.status_code == 409, rejected.text
    # Another editor cannot adopt the creator's preview, including its fallback.
    member = create_user(db_session, password='PlanningPass123!')
    add_trip_member(db_session, trip_id=trip.id, user_id=member.id)
    rejected = client.post(
        base + '/connections', headers=headers(member, revision), json=payload
    )
    assert rejected.status_code == 409, rejected.text
    saved = client.post(
        base + '/connections', headers=headers(user, revision), json=payload
    )
    assert saved.status_code == 201, saved.text
    assert planning_body(saved)['segments'][0]['intent']['travel_mode'] == 'OTHER'
    if route:
        route.assert_called_once()


def test_route_preview_is_reused_for_seven_days_then_cleaned_up(
    client, db_session, plan, monkeypatch
):
    from jobs.handlers import PlanningArtifactCleanupJob
    from models.database.base import utcnow

    user, _, base, _, revision, _, data = plan
    route = enable_routes(
        db_session, monkeypatch,
        RouteResponse(
            {'type': 'LineString', 'coordinates': [[-0.1, 51.5], [4.9, 52.37]]},
            50000, 3600,
        ),
    )
    now = utcnow()
    monkeypatch.setattr('services.planning_artifacts.utcnow', lambda: now)
    body = outer_body(data, segments=[{'travel_mode': 'CAR'}])
    preview = client.post(
        base + '/connections/preview', headers=headers(user, revision), json=body
    )
    assert preview.status_code == 200, preview.text
    preview_id = uuid.UUID(planning_body(preview)['preview_id'])
    artifact = db_session.get(ItineraryPlanningArtifact, preview_id)
    assert artifact.expires_at == now + timedelta(days=7)

    later = now + timedelta(days=6)
    monkeypatch.setattr('models.database.base.utcnow', lambda: later)
    monkeypatch.setattr('services.planning_artifacts.utcnow', lambda: later)
    monkeypatch.setattr('jobs.handlers.utcnow', lambda: later)
    assert PlanningArtifactCleanupJob(db_session).run().summary == {'deleted': 0}
    again = client.post(
        base + '/connections/preview', headers=headers(user, revision), json=body
    )
    assert again.status_code == 200, again.text
    assert planning_body(again)['preview_id'] == str(preview_id)
    saved = client.post(
        base + '/connections', headers=headers(user, revision),
        json=body | {'preview_id': str(preview_id)},
    )
    assert saved.status_code == 201, saved.text
    assert planning_body(saved)['segments'][0]['route_state'] == 'READY'
    route.assert_called_once()

    later = now + timedelta(days=7, seconds=1)
    assert PlanningArtifactCleanupJob(db_session).run().summary == {'deleted': 1}
    assert db_session.get(ItineraryPlanningArtifact, preview_id) is None
    # Cleanup of a temporary preview must keep the saved route.
    read = client.get(base + '/connections/' + planning_body(saved)['id'], headers=headers(user))
    assert read.status_code == 200, read.text
    assert planning_body(read)['segments'][0]['route_state'] == 'READY'


@pytest.mark.parametrize('side', ['DEPARTURE', 'RETURN'])
def test_outer_lifecycle_preview_defaults_and_noop(
    client, db_session, plan, monkeypatch, side
):  # noqa: F811
    user, _, base, _, revision, interior, data = plan
    route = Mock(side_effect=AssertionError('Implicit provider request'))
    monkeypatch.setattr(GraphHopperRouteProvider, 'get_route', route)
    body = outer_body(data, side)
    created = client.post(base + '/connections', headers=headers(user, revision), json=body)
    assert created.status_code == 201, created.text
    connection = planning_body(created)
    assert connection['connection_type'] == side
    assert created.headers['location'].endswith('/connections/' + connection['id'])
    endpoint = base + '/connections/' + connection['id']
    revision = created.headers['etag']
    count = db_session.scalar(select(func.count()).select_from(Location))
    same = client.put(endpoint, headers=headers(user, revision), json=body)
    assert same.status_code == 200, same.text
    assert same.headers['etag'] == revision
    assert db_session.scalar(select(func.count()).select_from(Location)) == count
    duplicate = client.post(base + '/connections', headers=headers(user, revision), json=body)
    assert duplicate.status_code == 409
    detail = planning_body(client.get(
        base + '/stops/' + body['to' if side == 'DEPARTURE' else 'from']['stop_id'],
        headers=headers(user),
    ))
    assert (
        detail['incoming_connection' if side == 'DEPARTURE' else 'outgoing_connection']['id']
        == connection['id']
    )
    snapshot = planning_body(client.get(base, headers=headers(user)))
    assert [item['id'] for item in snapshot['connections']] == (
        [connection['id'], interior['id']]
        if side == 'DEPARTURE'
        else [interior['id'], connection['id']]
    )
    route.assert_not_called()
    draft = write_body(
        connection,
        notes='Train home',
        segments=[{'travel_mode': 'TRAIN', 'mode_selected': True}],
    )
    location_side = 'from' if side == 'DEPARTURE' else 'to'
    draft[location_side]['location'] = {'latitude': 50.85, 'longitude': 4.35}
    preview = client.post(
        endpoint + '/preview', headers=headers(user, revision), json=draft
    )
    assert preview.status_code == 200, preview.text
    assert planning_body(preview)['connection'][location_side]['location']['latitude'] == 50.85
    assert planning_body(preview)['connection']['route']['geometry']['coordinates'][
        0 if side == 'DEPARTURE' else -1
    ] == [4.35, 50.85]
    saved = client.put(
        endpoint,
        headers=headers(user, revision),
        json=draft | {'preview_id': planning_body(preview)['preview_id']},
    )
    assert saved.status_code == 200, saved.text
    revision = saved.headers['etag']
    refreshed = client.post(
        endpoint + '/route-refresh', headers=headers(user, revision)
    )
    assert refreshed.status_code == 200, refreshed.text
    revision = refreshed.headers['etag']
    blocked = client.delete(endpoint, headers=headers(user, revision))
    assert blocked.status_code == 409
    assert planning_body(blocked)['detail']['connections'][0]['id'] == connection['id']
    assert client.get(endpoint, headers=headers(user)).headers['etag'] == revision
    stale = client.delete(
        endpoint + '?confirm_connection_deletion=true', headers=headers(user, '"0"')
    )
    assert stale.status_code == 412
    deleted = client.delete(
        endpoint + '?confirm_connection_deletion=true', headers=headers(user, revision)
    )
    assert deleted.status_code == 200, deleted.text
    assert [item['id'] for item in planning_body(deleted)['connections']] == [interior['id']]
    assert client.get(endpoint, headers=headers(user)).status_code == 404


def test_topology_and_creation_artifacts_cannot_be_forged(client, db_session, plan):  # noqa: F811
    user, _, base, endpoint, revision, connection, data = plan
    body = outer_body(data)
    assert (
        client.post(
            base + '/connections', headers=headers(user, revision), json=write_body(connection)
        ).status_code
        == 409
    )
    assert client.delete(endpoint, headers=headers(user, revision)).status_code == 409
    assert (
        client.put(endpoint, headers=headers(user, revision), json=body).status_code
        == 409
    )
    assert (
        client.post(
            endpoint + '/preview', headers=headers(user, revision), json=body
        ).status_code
        == 409
    )
    wrong_anchor = body | {'to': {'type': 'STOP', 'stop_id': data['stops'][-1]['id']}}
    assert (
        client.post(
            base + '/connections', headers=headers(user, revision), json=wrong_anchor
        ).status_code
        == 409
    )
    foreign_trip = create_trip(db_session, owner_id=user.id)
    assert (
        client.post(
            f'/api/v1/trips/{foreign_trip.id}/itinerary/connections',
            headers=headers(user, '"0"'),
            json=body,
        ).status_code
        == 404
    )
    for travel, status in (
        ({'preview_id': str(uuid.uuid4())}, 409),
        ({'segments': [{'id': connection['segments'][0]['id'], 'travel_mode': 'CAR'}]}, 422),
        (
            {
                'segments': [
                    {
                        'travel_mode': 'FLIGHT',
                        'flight': {'candidate_id': str(uuid.uuid4())},
                    }
                ]
            },
            409,
        ),
    ):
        assert (
            client.post(
                base + '/connections', headers=headers(user, revision), json=body | travel
            ).status_code
            == status
        )
    assert (
        client.post(base + '/connections', headers=headers(user), json=body).status_code == 428
    )


@pytest.mark.parametrize('side', ['DEPARTURE', 'RETURN'])
def test_reanchor_is_atomic_preserves_id_and_outside_and_clears_artifacts(
    client, db_session, plan, side
):  # noqa: F811
    user, trip, base, _, revision, _, data = plan
    created = client.post(
        base + '/connections',
        headers=headers(user, revision),
        json=outer_body(
            data,
            side,
            notes='Booked flight',
            segments=[
                {
                    'travel_mode': 'FLIGHT',
                    'flight': {
                        'flight_number': 'QF6842',
                        'departure_date': '2026-11-18',
                    },
                }
            ],
        ),
    )
    assert created.status_code == 201, created.text
    connection = planning_body(created)
    endpoint = base + '/connections/' + connection['id']
    revision = created.headers['etag']
    preview = client.post(
        endpoint + '/preview',
        headers=headers(user, revision),
        json=write_body(connection, segments=[{'travel_mode': 'TRAIN'}]),
    )
    assert preview.status_code == 200, preview.text
    count = db_session.scalar(select(func.count()).select_from(Location))
    payload = {
        'title': 'New edge',
        'location': {'latitude': 52, 'longitude': 5},
        'planned_nights': 0,
        'placement': {
            'planned_start_date': '2026-11-17' if side == 'DEPARTURE' else '2026-11-19',
            'after_stop_id': None,
        },
    }
    rejected = client.post(
        base + '/stops', headers=headers(user, revision), json=payload
    )
    assert rejected.status_code == 409, rejected.text
    assert planning_body(rejected)['detail']['connections'][0]['id'] == connection['id']
    assert db_session.scalar(select(func.count()).select_from(Location)) == count
    unchanged = client.get(base, headers=headers(user))
    assert unchanged.headers['etag'] == revision
    assert len(planning_body(unchanged)['stops']) == 2
    assert (
        db_session.get(
            ItineraryPlanningArtifact, uuid.UUID(planning_body(preview)['preview_id'])
        )
        is not None
    )
    inserted = client.post(
        base + '/stops?confirm_connection_deletion=true',
        headers=headers(user, revision),
        json=payload,
    )
    assert inserted.status_code == 201, inserted.text
    new_connection = next(item for item in planning_body(inserted)['connections'] if item['id'] == connection['id'])
    outside_side = 'from' if side == 'DEPARTURE' else 'to'
    assert new_connection[outside_side] == connection[outside_side]
    assert new_connection['notes'] == ''
    assert new_connection['segments'][0]['mode_source'] == 'AUTO'
    assert new_connection['segments'][0]['intent']['flight'] is None
    assert (
        db_session.get(
            ItineraryPlanningArtifact, uuid.UUID(planning_body(preview)['preview_id'])
        )
        is None
    )
    stop_id = new_connection['to' if side == 'DEPARTURE' else 'from']['stop_id']
    removed = client.delete(
        base + '/stops/' + stop_id, headers=headers(user, inserted.headers['etag'])
    )
    assert removed.status_code == 200, removed.text
    assert any(item['id'] == connection['id'] for item in planning_body(removed)['connections'])
    assert db_session.get(ItineraryConnection, uuid.UUID(connection['id'])).trip_id == trip.id


def test_one_stop_both_outer_connections_and_delete_final_stop(client, plan):  # noqa: F811
    user, _, base, _, revision, _, data = plan
    removed = client.delete(
        base + '/stops/' + data['stops'][-1]['id'], headers=headers(user, revision)
    )
    assert removed.status_code == 200, removed.text
    data, revision = planning_body(removed), removed.headers['etag']
    for side, mode in [('DEPARTURE', 'FLIGHT'), ('RETURN', 'TRAIN')]:
        payload = outer_body(
            data,
            side,
            notes=side,
            segments=[{'travel_mode': mode, 'mode_selected': True}],
        )
        if side == 'RETURN':
            payload['to']['location'] = {'latitude': 50.85, 'longitude': 4.35}
        created = client.post(
            base + '/connections', headers=headers(user, revision), json=payload
        )
        assert created.status_code == 201, created.text
        revision = created.headers['etag']
    stop_id = data['stops'][0]['id']
    detail = planning_body(client.get(base + '/stops/' + stop_id, headers=headers(user)))
    assert detail['incoming_connection']['connection_type'] == 'DEPARTURE'
    assert detail['outgoing_connection']['connection_type'] == 'RETURN'
    rejected = client.delete(
        base + '/stops/' + stop_id, headers=headers(user, revision)
    )
    assert rejected.status_code == 409
    assert len(planning_body(rejected)['detail']['connections']) == 2
    deleted = client.delete(
        base + '/stops/' + stop_id + '?confirm_connection_deletion=true',
        headers=headers(user, revision),
    )
    assert deleted.status_code == 200, deleted.text
    assert planning_body(deleted)['connections'] == planning_body(deleted)['stops'] == []
    assert (
        client.post(
            base + '/connections',
            headers=headers(user, deleted.headers['etag']),
            json=outer_body(data),
        ).status_code
        == 404
    )


@pytest.mark.parametrize(
    'visibility,anonymous,outsider',
    [('PRIVATE', 404, 404), ('PUBLIC', 403, 403), ('PLATFORM_PUBLIC', 404, 403)],
)
def test_outer_read_and_mutation_access_matrix(
    client, db_session, plan, visibility, anonymous, outsider
):  # noqa: F811
    user, trip, base, _, revision, _, data = plan
    viewer, member, stranger = [
        create_user(db_session, password='PlanningPass123!') for _ in range(3)
    ]
    add_trip_viewer(db_session, trip_id=trip.id, user_id=viewer.id, created_by=user.id)
    add_trip_member(db_session, trip_id=trip.id, user_id=member.id)
    trip.visibility = TripVisibility(visibility)
    db_session.commit()
    created = client.post(
        base + '/connections', headers=headers(member, revision), json=outer_body(data)
    )
    assert created.status_code == 201, created.text
    endpoint = base + '/connections/' + planning_body(created)['id']
    revision = created.headers['etag']
    assert client.get(endpoint).status_code == anonymous
    assert client.get(endpoint, headers=headers(stranger)).status_code == outsider
    assert client.get(endpoint, headers=headers(viewer)).status_code == 403
    assert client.get(endpoint, headers=headers(member)).status_code == 200
    overview = client.get(base + '/overview', headers=headers(viewer))
    assert overview.status_code == 200
    assert planning_body(created)['id'] in [connection['id'] for connection in planning_body(overview)['connections']]
    body = write_body(planning_body(created))
    for method, path, payload in [
        ('post', base + '/connections', outer_body(data, 'RETURN')),
        ('post', base + '/connections/preview', outer_body(data, 'RETURN')),
        (
            'post',
            base + '/connections/flight-lookups',
            {
                'flight_number': 'QF6842',
                'departure_date': '2026-11-18',
            },
        ),
        ('put', endpoint, body),
        ('post', endpoint + '/preview', body),
        ('delete', endpoint, None),
    ]:
        response = client.request(
            method, path, headers=headers(viewer, revision), json=payload
        )
        assert response.status_code == 403, response.text
    link = planning_body(client.post(
        f'/api/v1/trips/{trip.id}/share-links',
        headers=headers(user),
        json={'label': 'Outer'},
    ))
    shared = {'X-Trip-Share-Token': link['token']}
    assert client.get(endpoint, headers=shared).status_code == 403
    assert client.get(base + '/overview', headers=shared).status_code == 200
    assert (
        client.get(endpoint, headers={'X-Trip-Share-Token': 'invalid'}).status_code
        == anonymous
    )
    client.patch(
        f'/api/v1/trips/{trip.id}/share-links/{link["id"]}',
        headers=headers(user),
        json={'revoked': True},
    )
    assert client.get(endpoint, headers=shared).status_code == anonymous


@pytest.mark.parametrize('side', ['DEPARTURE', 'RETURN'])
@pytest.mark.parametrize('route_option', [0, 1])
def test_unsaved_connection_preview_is_atomic_and_bound_to_inputs(
    client, db_session, plan, monkeypatch, side, route_option
):
    user, _, base, _, revision, _, data = plan
    route = enable_routes(
        db_session,
        monkeypatch,
        RouteResponse(
            geometry_geojson={
                'type': 'LineString',
                'coordinates': [[-0.1, 51.5], [5.12, 52.09]],
            },
            distance_meters=1000,
            duration_seconds=100,
            alternatives=(
                RouteResponse(
                    geometry_geojson={
                        'type': 'LineString',
                        'coordinates': [[-0.1, 51.5], [1, 52], [5.12, 52.09]],
                    },
                    distance_meters=1200,
                    duration_seconds=120,
                ),
            ),
        ),
    )
    body = outer_body(
        data, side, segments=[{'travel_mode': 'CAR', 'mode_selected': True}]
    )
    connections_before = db_session.scalar(
        select(func.count()).select_from(ItineraryConnection)
    )
    locations_before = db_session.scalar(select(func.count()).select_from(Location))
    preview = client.post(
        base + '/connections/preview', headers=headers(user, revision), json=body
    )
    assert preview.status_code == 200, preview.text
    assert planning_body(preview)['connection']['connection_type'] == side
    assert route.call_count == 1
    cached = client.post(
        base + '/connections/preview', headers=headers(user, revision), json=body
    )
    assert cached.status_code == 200, cached.text
    assert planning_body(cached)['preview_id'] == planning_body(preview)['preview_id']
    assert route.call_count == 1
    assert (
        db_session.scalar(select(func.count()).select_from(ItineraryConnection))
        == connections_before
    )
    assert (
        db_session.scalar(select(func.count()).select_from(Location))
        == locations_before
    )
    assert client.get(base, headers=headers(user)).headers['etag'] == revision
    changed = outer_body(
        data, side, segments=body['segments'], preview_id=planning_body(preview)['preview_id']
    )
    changed['from' if side == 'DEPARTURE' else 'to']['location']['latitude'] = 50
    rejected = client.post(
        base + '/connections', headers=headers(user, revision), json=changed
    )
    assert rejected.status_code == 409, rejected.text
    body['segments'][0]['route_option'] = route_option
    saved = client.post(
        base + '/connections',
        headers=headers(user, revision),
        json=body | {'preview_id': planning_body(preview)['preview_id']},
    )
    assert saved.status_code == 201, saved.text
    assert planning_body(saved)['segments'][0]['route_state'] == 'READY'
    assert planning_body(saved)['duration_seconds'] == (120 if route_option else 100)
    assert saved.headers['etag'] != revision
    assert route.call_count == 1


def test_unsaved_flight_artifacts_are_actor_trip_and_revision_scoped(
    client, db_session, plan, monkeypatch
):
    user, trip, base, _, revision, _, data = plan
    member = create_user(db_session, password='PlanningPass123!')
    add_trip_member(db_session, trip_id=trip.id, user_id=member.id)
    db_session.commit()
    matched_lookup(db_session, monkeypatch)
    found = client.post(
        base + '/connections/flight-lookups',
        headers=headers(user, revision),
        json={
            'flight_number': 'QF6842',
            'departure_date': '2026-11-18',
        },
    )
    assert found.status_code == 200, found.text
    candidate = planning_body(found)['candidates'][0]['candidate_id']
    body = outer_body(
        data,
        segments=[
            {
                'travel_mode': 'FLIGHT',
                'flight': {
                    'flight_number': 'QF6842',
                    'departure_date': '2026-11-18',
                    'candidate_id': candidate,
                },
            }
        ],
    )
    preview = client.post(
        base + '/connections/preview', headers=headers(user, revision), json=body
    )
    assert preview.status_code == 200, preview.text
    body['preview_id'] = planning_body(preview)['preview_id']
    assert (
        client.post(
            base + '/connections', headers=headers(member, revision), json=body
        ).status_code
        == 409
    )
    foreign = create_trip(db_session, owner_id=user.id)
    assert (
        client.post(
            f'/api/v1/trips/{foreign.id}/itinerary/connections/preview',
            headers=headers(user, '"0"'),
            json=body,
        ).status_code
        == 404
    )
    assert (
        client.post(base + '/connections', headers=headers(user, '"0"'), json=body).status_code
        == 412
    )
    saved = client.post(base + '/connections', headers=headers(user, revision), json=body)
    assert saved.status_code == 201, saved.text
    assert planning_body(saved)['segments'][0]['lookup'] is not None
    assert db_session.get(
        ItineraryPlanningArtifact, uuid.UUID(candidate)
    ).connection_id == uuid.UUID(planning_body(saved)['id'])


def test_outer_flight_candidate_scope_and_warning_sides(
    client, db_session, plan, monkeypatch
):  # noqa: F811
    user, _, base, _, revision, interior, data = plan
    matched_lookup(db_session, monkeypatch)
    created = client.post(
        base + '/connections', headers=headers(user, revision), json=outer_body(data)
    )
    assert created.status_code == 201, created.text
    connection, revision = planning_body(created), created.headers['etag']
    endpoint = base + '/connections/' + connection['id']
    found = client.post(
        endpoint + '/flight-lookups',
        headers=headers(user, revision),
        json={'flight_number': 'QF6842', 'departure_date': '2026-11-18'},
    )
    assert found.status_code == 200, found.text
    candidate = planning_body(found)['candidates'][0]['candidate_id']
    body = write_body(
        connection,
        segments=[
            {
                'travel_mode': 'FLIGHT',
                'flight': {
                    'flight_number': 'QF6842',
                    'departure_date': '2026-11-18',
                    'candidate_id': candidate,
                },
            }
        ],
    )
    other = client.put(
        base + '/connections/' + interior['id'],
        headers=headers(user, revision),
        json=write_body(interior, segments=body['segments']),
    )
    assert other.status_code == 409
    saved = client.put(endpoint, headers=headers(user, revision), json=body)
    assert saved.status_code == 200, saved.text
    assert planning_body(saved)['duration_scope'] == 'FLIGHT_JOURNEY'
    assert not any('preceding stop' in warning['message'] for warning in planning_body(saved)['warnings'])
    assert planning_body(saved)['segments'][0]['lookup'] is not None


def test_outer_endpoint_changes_invalidate_preview_and_candidates(
    client, db_session, plan, monkeypatch
):  # noqa: F811
    user, _, base, _, revision, _, data = plan
    created = client.post(
        base + '/connections', headers=headers(user, revision), json=outer_body(data)
    )
    connection, revision = planning_body(created), created.headers['etag']
    endpoint = base + '/connections/' + connection['id']
    route = enable_routes(
        db_session,
        monkeypatch,
        RouteResponse(
            geometry_geojson={
                'type': 'LineString',
                'coordinates': [[-0.1, 51.5], [5.12, 52.09]],
            },
            distance_meters=1000,
            duration_seconds=100,
        ),
    )
    body = write_body(connection, segments=[{'travel_mode': 'CAR'}])
    preview = client.post(
        endpoint + '/preview', headers=headers(user, revision), json=body
    )
    assert preview.status_code == 200, preview.text
    artifact = db_session.get(
        ItineraryPlanningArtifact, uuid.UUID(planning_body(preview)['preview_id'])
    )
    artifact.expires_at += timedelta(minutes=1)
    db_session.commit()
    changed = body | {
        'from': {'type': 'LOCATION', 'location': {'latitude': 48, 'longitude': 2}},
        'preview_id': planning_body(preview)['preview_id'],
    }
    saved = client.put(endpoint, headers=headers(user, revision), json=changed)
    assert saved.status_code == 200, saved.text
    assert planning_body(saved)['segments'][0]['route_state'] == 'NOT_CALCULATED'
    assert db_session.get(ItineraryPlanningArtifact, artifact.id) is None
    route.assert_called_once()


@pytest.mark.parametrize(
    'shape',
    ['empty_side', 'both_side', 'no_stop', 'same_stop', 'cross_trip', 'duplicate'],
)
def test_database_rejects_invalid_outer_endpoint_shapes(db_session, plan, shape):  # noqa: F811
    user, trip, _, _, _, _, data = plan
    stop_id = uuid.UUID(data['stops'][0]['id'])
    location_id = uuid.UUID(data['stops'][0]['location']['id'])
    values = dict(
        id=uuid.uuid4(),
        trip_id=trip.id,
        from_stop_id=None,
        to_stop_id=stop_id,
        from_location_id=location_id,
        to_location_id=None,
    )
    if shape == 'empty_side':
        values['from_location_id'] = None
    elif shape == 'both_side':
        values['from_stop_id'] = uuid.UUID(data['stops'][-1]['id'])
    elif shape == 'no_stop':
        values.update(to_stop_id=None, to_location_id=location_id)
    elif shape == 'same_stop':
        values.update(from_location_id=None, from_stop_id=stop_id)
    elif shape == 'cross_trip':
        other = create_trip(db_session, owner_id=user.id)
        values['trip_id'] = other.id
    else:
        db_session.execute(
            text(
                'INSERT INTO itinerary_connections (id,trip_id,from_location_id,to_stop_id) VALUES (:id,:trip_id,:from_location_id,:to_stop_id)'
            ),
            values,
        )
        values['id'] = uuid.uuid4()
    with pytest.raises(IntegrityError):
        db_session.execute(
            text(
                'INSERT INTO itinerary_connections (id,trip_id,from_stop_id,to_stop_id,from_location_id,to_location_id) VALUES (:id,:trip_id,:from_stop_id,:to_stop_id,:from_location_id,:to_location_id)'
            ),
            values,
        )
    db_session.rollback()
