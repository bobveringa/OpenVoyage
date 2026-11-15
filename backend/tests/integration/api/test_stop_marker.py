# ruff: noqa: F811
"""Moving a stop's marker within its place keeps the travel around it."""

from planning_helpers import planning_body

from factories.places import create_place
from factories.trips import add_trip_viewer
from factories.users import create_user
from integration.api.test_outer_connections import write_body
from integration.services.test_itinerary_route_service import headers, plan  # noqa: F401

# About 1.5 km from the Utrecht place in the plan fixture.
NEAR_UTRECHT = {'latitude': 52.1, 'longitude': 5.14}


def _customize(client, plan):
    user, _, base, endpoint, revision, connection, _ = plan
    response = client.put(
        endpoint,
        headers=headers(user, revision),
        json=write_body(
            connection,
            notes='Custom',
            segments=[{'travel_mode': 'TRAIN', 'mode_selected': True}],
        ),
    )
    assert response.status_code == 200, response.text
    return response.headers['etag']


def _patch_stop(client, plan, revision, body, stop_index=0):
    user, _, base, *_rest, data = plan
    stop_id = data['stops'][stop_index]['id']
    return client.patch(
        f'{base}/stops/{stop_id}', headers=headers(user, revision), json=body
    )


def test_moving_the_marker_keeps_custom_travel(client, plan):
    revision = _customize(client, plan)

    response = _patch_stop(client, plan, revision, {'marker': NEAR_UTRECHT})

    assert response.status_code == 200, response.text
    body = planning_body(response)
    stop = body['stops'][0]
    assert (stop['location']['latitude'], stop['location']['longitude']) == (52.1, 5.14)
    assert stop['location']['name'] == 'Utrecht'
    assert stop['location']['id'] != stop['original_location']['id']
    assert stop['original_location']['latitude'] == 52.09
    [connection] = body['connections']
    assert connection['id'] == plan[5]['id']
    assert connection['notes'] == 'Custom'
    assert connection['segments'][0]['intent']['travel_mode'] == 'TRAIN'


def test_null_marker_puts_it_back_on_the_original_place(client, plan):
    moved = _patch_stop(client, plan, plan[4], {'marker': NEAR_UTRECHT})
    assert moved.status_code == 200, moved.text

    reset = _patch_stop(client, plan, moved.headers['etag'], {'marker': None})

    assert reset.status_code == 200, reset.text
    stop = planning_body(reset)['stops'][0]
    assert stop['location'] == stop['original_location']
    assert stop['location']['latitude'] == 52.09


def test_marker_may_not_leave_its_place(client, plan):
    # Amsterdam is about 35 km from Utrecht.
    response = _patch_stop(
        client, plan, plan[4], {'marker': {'latitude': 52.37, 'longitude': 4.9}}
    )

    assert response.status_code == 422
    assert '25 km' in response.json()['detail']['message']


def test_marker_is_measured_from_the_original_place(client, plan):
    # Two hops of 20 km each would end 40 km from Utrecht.
    first = _patch_stop(
        client, plan, plan[4], {'marker': {'latitude': 52.27, 'longitude': 5.12}}
    )
    assert first.status_code == 200, first.text

    second = _patch_stop(
        client,
        plan,
        first.headers['etag'],
        {'marker': {'latitude': 52.45, 'longitude': 5.12}},
    )

    assert second.status_code == 422


def test_marker_and_place_cannot_change_together(client, plan):
    response = _patch_stop(
        client,
        plan,
        plan[4],
        {'marker': NEAR_UTRECHT, 'location': {'latitude': 52.0, 'longitude': 5.0}},
    )

    assert response.status_code == 422


def test_changing_the_place_resets_the_marker(client, db_session, plan):
    moved = _patch_stop(client, plan, plan[4], {'marker': NEAR_UTRECHT})
    assert moved.status_code == 200, moved.text
    arnhem = create_place(db_session, name='Arnhem', latitude=51.98, longitude=5.91)

    replaced = _patch_stop(
        client,
        plan,
        moved.headers['etag'],
        {'location': {'place_id': str(arnhem.id)}},
    )

    assert replaced.status_code == 200, replaced.text
    stop = planning_body(replaced)['stops'][0]
    assert stop['location'] == stop['original_location']
    assert stop['location']['name'] == 'Arnhem'


def test_viewers_cannot_move_the_marker(client, db_session, plan):
    viewer = create_user(db_session, password='ViewerPass123!')
    add_trip_viewer(
        db_session, trip_id=plan[1].id, user_id=viewer.id, created_by=plan[0].id
    )
    stop_id = plan[6]['stops'][0]['id']

    response = client.patch(
        f'{plan[2]}/stops/{stop_id}',
        headers=headers(viewer, plan[4]),
        json={'marker': NEAR_UTRECHT},
    )

    assert response.status_code == 403


def test_shared_overview_shows_the_moved_marker(client, plan):
    user, trip, base, *_ = plan
    moved = _patch_stop(client, plan, plan[4], {'marker': NEAR_UTRECHT})
    assert moved.status_code == 200, moved.text
    link = client.post(
        f'{base.removesuffix("/itinerary")}/share-links',
        headers=headers(user),
        json={'label': 'Marker'},
    )
    assert link.status_code == 201, link.text

    overview = client.get(
        f'{base}/overview',
        headers={'X-Trip-Share-Token': planning_body(link)['token']},
    )

    assert overview.status_code == 200, overview.text
    location = planning_body(overview)['stops'][0]['location']
    assert (location['latitude'], location['longitude']) == (52.1, 5.14)
