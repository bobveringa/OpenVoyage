"""Timeline geometry built from post and GPS anchors."""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

import pytest

from core import security
from factories.places import create_place
from factories.trips import add_trip_member, add_trip_viewer, create_trip
from factories.users import create_user
from models.database.trips import TripRole, TripVisibility

START = datetime(2026, 8, 14, 8, 0, tzinfo=timezone.utc)


def _auth_headers(user) -> dict[str, str]:
    tokens = security.create_auth_tokens(subject=user.id, email=user.email)
    return {'Authorization': f'Bearer {tokens["access_token"]}'}


def _iso(moment: datetime) -> str:
    return moment.isoformat().replace('+00:00', 'Z')


def _create_post(
    client,
    api_prefix,
    *,
    trip_id,
    user,
    place,
    title: str,
    occurred_at: datetime,
    publish: bool = True,
) -> dict:
    response = client.post(
        f'{api_prefix}/trips/{trip_id}/posts',
        headers=_auth_headers(user),
        json={
            'title': title,
            'body': title,
            'location': {'place_id': str(place.id)},
            'occurred_at': _iso(occurred_at),
            'media_ids': [],
            'publish': publish,
        },
    )
    assert response.status_code == 201, response.text
    return response.json()


def _upload(
    client,
    api_prefix,
    *,
    trip_id,
    user,
    session_id,
    points: list[tuple[int, float, float, str]],
) -> None:
    """Upload ``(offset_seconds, latitude, longitude, travel_mode)`` points."""
    response = client.post(
        f'{api_prefix}/trips/{trip_id}/tracking/sessions/{session_id}/samples/batch',
        headers=_auth_headers(user),
        json={
            'samples': [
                {
                    'id': str(uuid.uuid4()),
                    'recorded_at': _iso(START + timedelta(seconds=offset)),
                    'latitude': latitude,
                    'longitude': longitude,
                    'accuracy_meters': None,
                    'travel_mode': mode,
                }
                for offset, latitude, longitude, mode in points
            ]
        },
    )
    assert response.status_code == 200, response.text
    assert response.json()['accepted_samples'] == len(points)


def _open_session(client, api_prefix, *, trip_id, user, started_at=START):
    session_id = uuid.uuid4()
    response = client.post(
        f'{api_prefix}/trips/{trip_id}/tracking/sessions/{session_id}',
        headers=_auth_headers(user),
        json={'started_at': _iso(started_at), 'ended_at': None},
    )
    assert response.status_code == 201, response.text
    return session_id


def _end_session(client, api_prefix, *, trip_id, user, session_id, ended_at):
    response = client.patch(
        f'{api_prefix}/trips/{trip_id}/tracking/sessions/{session_id}',
        headers=_auth_headers(user),
        json={'ended_at': _iso(ended_at)},
    )
    assert response.status_code == 200, response.text


def _timeline(client, api_prefix, trip_id, *, user=None, params=None):
    return client.get(
        f'{api_prefix}/trips/{trip_id}/posts/timeline',
        headers=_auth_headers(user) if user else {},
        params=params or {},
    )


def _coordinates(segments) -> list[list[list[float]]]:
    return [segment['geometry']['coordinates'] for segment in segments]


def _modes(segments) -> list[str]:
    return [segment['travel_mode'] for segment in segments]


@pytest.fixture()
def owner(db_session):
    return create_user(db_session, password='TrackPass123!')


@pytest.fixture()
def trip(db_session, owner):
    return create_trip(
        db_session,
        owner_id=owner.id,
        visibility=TripVisibility.PUBLIC,
    )


@pytest.fixture()
def place(db_session):
    return create_place(db_session)


@pytest.mark.integration
def test_two_posts_with_no_gps_produce_the_plain_straight_line(
    client,
    api_prefix,
    db_session,
    trip,
    owner,
    place,
) -> None:
    _create_post(
        client,
        api_prefix,
        trip_id=trip.id,
        user=owner,
        place=place,
        title='A',
        occurred_at=START,
    )
    _create_post(
        client,
        api_prefix,
        trip_id=trip.id,
        user=owner,
        place=place,
        title='B',
        occurred_at=START + timedelta(hours=2),
    )

    body = _timeline(client, api_prefix, trip.id).json()
    assert body['opening_route'] is None
    route = body['entries'][0]['route_after']
    assert _modes(route['segments']) == ['UNKNOWN']
    assert len(route['segments'][0]['geometry']['coordinates']) == 2
    assert route['duration_seconds'] == 7200


@pytest.mark.integration
def test_post_candidates_follow_displayed_track_and_are_member_only(
    client,
    api_prefix,
    db_session,
    trip,
    owner,
) -> None:
    session_id = _open_session(client, api_prefix, trip_id=trip.id, user=owner)
    _upload(
        client,
        api_prefix,
        trip_id=trip.id,
        user=owner,
        session_id=session_id,
        points=[
            (0, 52.00, 5.00, 'WALK'),
            (300, 52.00, 5.00, 'WALK'),
            (600, 52.00, 5.00, 'WALK'),
            (660, 52.00, 5.00, 'WALK'),
            (1200, 52.00, 5.003, 'WALK'),
        ],
    )

    response = client.get(
        f'{api_prefix}/trips/{trip.id}/tracking/post-candidates',
        headers=_auth_headers(owner),
    )

    assert response.status_code == 200, response.text
    assert response.headers['Cache-Control'] == 'no-store'
    # The last raw point is a single unconfirmed departure fix, so stationary
    # compaction removes it from the map and it must not survive as a marker.
    assert [candidate['recorded_at'] for candidate in response.json()] == [_iso(START)]

    viewer = create_user(db_session, password='ViewerPass123!')
    add_trip_viewer(
        db_session,
        trip_id=trip.id,
        user_id=viewer.id,
        created_by=owner.id,
    )
    forbidden = client.get(
        f'{api_prefix}/trips/{trip.id}/tracking/post-candidates',
        headers=_auth_headers(viewer),
    )
    assert forbidden.status_code == 403


@pytest.mark.integration
def test_a_long_stay_is_a_candidate_and_remains_on_the_displayed_route(
    client,
    api_prefix,
    db_session,
    trip,
    owner,
) -> None:
    session_id = _open_session(client, api_prefix, trip_id=trip.id, user=owner)
    _upload(
        client,
        api_prefix,
        trip_id=trip.id,
        user=owner,
        session_id=session_id,
        points=[
            (0, 52.0, 5.0, 'WALK'),
            # This stop is only 350 m from the previous point and starts
            # before the normal ten-minute interval, so ordinary sampling
            # would skip it. Its fifteen-minute dwell makes it a priority.
            (300, 52.0, 5.005, 'WALK'),
            (600, 52.0, 5.005, 'WALK'),
            (1_200, 52.0, 5.005, 'WALK'),
            (1_260, 52.0, 5.010, 'WALK'),
            (1_320, 52.0, 5.015, 'WALK'),
        ],
    )

    candidates = client.get(
        f'{api_prefix}/trips/{trip.id}/tracking/post-candidates',
        headers=_auth_headers(owner),
    ).json()
    stay = next(
        candidate
        for candidate in candidates
        if candidate['recorded_at'] == _iso(START + timedelta(minutes=5))
    )

    timeline = _timeline(client, api_prefix, trip.id, user=owner).json()
    route_coordinates = {
        tuple(coordinate)
        for segment in timeline['opening_route']['segments']
        for coordinate in segment['geometry']['coordinates']
    }
    assert (stay['longitude'], stay['latitude']) in route_coordinates


@pytest.mark.integration
def test_post_candidates_infer_sparse_road_spacing_without_trusting_mode(
    client,
    api_prefix,
    db_session,
    trip,
    owner,
) -> None:
    """A 100 km/h track must not offer one post action per GPS point."""
    session_id = _open_session(client, api_prefix, trip_id=trip.id, user=owner)
    _upload(
        client,
        api_prefix,
        trip_id=trip.id,
        user=owner,
        session_id=session_id,
        # All points falsely claim WALK.  At the equator, 0.45 longitude is
        # about 50 km, so this trace advances at roughly 100 km/h.
        points=[
            (0, 0.0, 0.0, 'WALK'),
            (1_800, 0.0, 0.45, 'WALK'),
            (3_600, 0.0, 0.90, 'WALK'),
            (5_400, 0.0, 1.35, 'WALK'),
            (7_200, 0.0, 1.80, 'WALK'),
        ],
    )
    _end_session(
        client,
        api_prefix,
        trip_id=trip.id,
        user=owner,
        session_id=session_id,
        ended_at=START + timedelta(hours=2),
    )

    candidates = client.get(
        f'{api_prefix}/trips/{trip.id}/tracking/post-candidates',
        headers=_auth_headers(owner),
    ).json()

    assert [candidate['recorded_at'] for candidate in candidates] == [
        _iso(START),
        _iso(START + timedelta(minutes=60)),
        _iso(START + timedelta(hours=2)),
    ]


@pytest.mark.integration
def test_post_candidates_keep_one_kilometre_walking_spacing_without_trusting_mode(
    client,
    api_prefix,
    db_session,
    trip,
    owner,
) -> None:
    session_id = _open_session(client, api_prefix, trip_id=trip.id, user=owner)
    _upload(
        client,
        api_prefix,
        trip_id=trip.id,
        user=owner,
        session_id=session_id,
        # Roughly 3 km/h, despite the deliberately wrong CAR mode.
        points=[
            (0, 0.0, 0.0, 'CAR'),
            (600, 0.0, 0.0045, 'CAR'),
            (1_200, 0.0, 0.0090, 'CAR'),
            (1_800, 0.0, 0.0135, 'CAR'),
        ],
    )
    _end_session(
        client,
        api_prefix,
        trip_id=trip.id,
        user=owner,
        session_id=session_id,
        ended_at=START + timedelta(minutes=30),
    )

    candidates = client.get(
        f'{api_prefix}/trips/{trip.id}/tracking/post-candidates',
        headers=_auth_headers(owner),
    ).json()

    assert [candidate['recorded_at'] for candidate in candidates] == [
        _iso(START),
        _iso(START + timedelta(minutes=20)),
        _iso(START + timedelta(minutes=30)),
    ]


@pytest.mark.integration
def test_high_speed_track_gets_one_preserved_midpoint_candidate(
    client,
    api_prefix,
    db_session,
    trip,
    owner,
) -> None:
    """Flights and high-speed trains get one useful post-along-the-way point."""
    session_id = _open_session(client, api_prefix, trip_id=trip.id, user=owner)
    _upload(
        client,
        api_prefix,
        trip_id=trip.id,
        user=owner,
        session_id=session_id,
        # About 200 km/h, despite the deliberately wrong client mode.
        points=[
            (0, 0.0, 0.0, 'WALK'),
            (1_800, 0.0, 0.90, 'WALK'),
            (3_600, 0.0, 1.80, 'WALK'),
            (5_400, 0.0, 2.70, 'WALK'),
        ],
    )
    _end_session(
        client,
        api_prefix,
        trip_id=trip.id,
        user=owner,
        session_id=session_id,
        ended_at=START + timedelta(minutes=90),
    )

    candidates = client.get(
        f'{api_prefix}/trips/{trip.id}/tracking/post-candidates',
        headers=_auth_headers(owner),
    ).json()
    assert [candidate['recorded_at'] for candidate in candidates] == [
        _iso(START),
        _iso(START + timedelta(minutes=60)),
        _iso(START + timedelta(minutes=90)),
    ]

    timeline = _timeline(client, api_prefix, trip.id, user=owner).json()
    route_coordinates = {
        tuple(coordinate)
        for segment in timeline['opening_route']['segments']
        for coordinate in segment['geometry']['coordinates']
    }
    midpoint = candidates[1]
    assert (midpoint['longitude'], midpoint['latitude']) in route_coordinates


@pytest.mark.integration
def test_gps_points_become_anchors_and_split_by_mode(
    client,
    api_prefix,
    db_session,
    trip,
    owner,
    place,
) -> None:
    _create_post(
        client,
        api_prefix,
        trip_id=trip.id,
        user=owner,
        place=place,
        title='A',
        occurred_at=START,
    )
    _create_post(
        client,
        api_prefix,
        trip_id=trip.id,
        user=owner,
        place=place,
        title='B',
        occurred_at=START + timedelta(hours=3),
    )

    session_id = _open_session(client, api_prefix, trip_id=trip.id, user=owner)
    _upload(
        client,
        api_prefix,
        trip_id=trip.id,
        user=owner,
        session_id=session_id,
        points=[
            (600, 52.00, 5.00, 'WALK'),
            (1200, 52.10, 5.20, 'WALK'),
            (1800, 52.30, 5.60, 'TRAIN'),
            (2400, 52.60, 6.20, 'TRAIN'),
        ],
    )
    _end_session(
        client,
        api_prefix,
        trip_id=trip.id,
        user=owner,
        session_id=session_id,
        ended_at=START + timedelta(hours=3),
    )

    body = _timeline(client, api_prefix, trip.id).json()
    segments = body['entries'][0]['route_after']['segments']

    # post A -> p0 -> p1 use p1's mode chain; the change happens at p1, whose
    # coordinate is shared by both adjacent segments.
    assert _modes(segments) == ['WALK', 'TRAIN']
    walk, train = _coordinates(segments)
    assert walk[-1] == train[0]
    # Every coordinate is a real post or GPS coordinate.
    assert [52.00, 5.00] not in walk  # stored as (lon, lat)
    assert [5.00, 52.00] in walk


@pytest.mark.integration
def test_deleted_points_leave_the_surrounding_anchors_connected(
    client,
    api_prefix,
    db_session,
    trip,
    owner,
    place,
) -> None:
    _create_post(
        client,
        api_prefix,
        trip_id=trip.id,
        user=owner,
        place=place,
        title='A',
        occurred_at=START,
    )
    _create_post(
        client,
        api_prefix,
        trip_id=trip.id,
        user=owner,
        place=place,
        title='B',
        occurred_at=START + timedelta(hours=3),
    )
    session_id = _open_session(client, api_prefix, trip_id=trip.id, user=owner)
    _upload(
        client,
        api_prefix,
        trip_id=trip.id,
        user=owner,
        session_id=session_id,
        points=[
            (600, 52.0, 5.0, 'WALK'),
            (1200, 53.0, 6.0, 'WALK'),
            (1800, 54.0, 7.0, 'WALK'),
        ],
    )

    stored = client.get(
        f'{api_prefix}/trips/{trip.id}/tracking/sessions/{session_id}/samples',
        headers=_auth_headers(owner),
    ).json()['items']
    middle = stored[1]['id']
    client.post(
        f'{api_prefix}/trips/{trip.id}/tracking/samples/delete',
        headers=_auth_headers(owner),
        json={'sample_ids': [middle]},
    )

    body = _timeline(client, api_prefix, trip.id).json()
    coordinates = _coordinates(body['entries'][0]['route_after']['segments'])[0]
    assert [6.0, 53.0] not in coordinates
    assert [5.0, 52.0] in coordinates
    assert [7.0, 54.0] in coordinates


@pytest.mark.integration
def test_opening_route_reaches_the_first_post_for_every_reader(
    client,
    api_prefix,
    db_session,
    trip,
    owner,
    place,
) -> None:
    """The one route that is never gated, even from a session still open.

    Every coordinate in it predates the first visible post, whose location and
    timestamp the same reader can already see.
    """
    session_id = _open_session(client, api_prefix, trip_id=trip.id, user=owner)
    _upload(
        client,
        api_prefix,
        trip_id=trip.id,
        user=owner,
        session_id=session_id,
        points=[(600, 52.0, 5.0, 'TRAIN'), (1200, 52.5, 5.5, 'TRAIN')],
    )
    _create_post(
        client,
        api_prefix,
        trip_id=trip.id,
        user=owner,
        place=place,
        title='First',
        occurred_at=START + timedelta(hours=1),
    )

    anonymous = _timeline(client, api_prefix, trip.id)
    assert anonymous.status_code == 200
    opening = anonymous.json()['opening_route']
    assert opening is not None
    coordinates = _coordinates(opening['segments'])[0]
    assert [5.0, 52.0] in coordinates
    assert len(opening['segments']) == 1

    # Post social state is actor-specific, so all timelines are private.
    assert anonymous.headers['Cache-Control'] == 'private, no-store'


@pytest.mark.integration
def test_opening_route_is_null_without_a_leading_gps_point(
    client,
    api_prefix,
    db_session,
    trip,
    owner,
    place,
) -> None:
    _create_post(
        client,
        api_prefix,
        trip_id=trip.id,
        user=owner,
        place=place,
        title='First',
        occurred_at=START,
    )
    body = _timeline(client, api_prefix, trip.id).json()
    assert body['opening_route'] is None


@pytest.mark.integration
def test_postless_opening_route_gates_the_open_session(
    client,
    api_prefix,
    db_session,
    trip,
    owner,
) -> None:
    """With no post there is no upper bound, so the live switch applies."""
    ended_id = uuid.uuid4()
    client.post(
        f'{api_prefix}/trips/{trip.id}/tracking/sessions/{ended_id}',
        headers=_auth_headers(owner),
        json={
            'started_at': _iso(START),
            'ended_at': _iso(START + timedelta(hours=1)),
        },
    )
    _upload(
        client,
        api_prefix,
        trip_id=trip.id,
        user=owner,
        session_id=ended_id,
        points=[(60, 52.0, 5.0, 'WALK'), (120, 52.1, 5.1, 'WALK')],
    )

    open_id = _open_session(
        client,
        api_prefix,
        trip_id=trip.id,
        user=owner,
        started_at=START + timedelta(hours=2),
    )
    _upload(
        client,
        api_prefix,
        trip_id=trip.id,
        user=owner,
        session_id=open_id,
        points=[(7_500, 53.0, 6.0, 'CAR'), (7_800, 53.5, 6.5, 'CAR')],
    )

    # The ended session is history and is public; the open session's CAR tail
    # is the part the switch withholds. Assert on the mode segments rather than
    # individual coordinates, which simplification is free to thin out.
    anonymous = _timeline(client, api_prefix, trip.id)
    assert _modes(anonymous.json()['opening_route']['segments']) == ['WALK']

    member = _timeline(client, api_prefix, trip.id, user=owner)
    assert _modes(member.json()['opening_route']['segments']) == ['WALK', 'CAR']
    # Post social state is actor-specific, so all timelines are private.
    assert member.headers['Cache-Control'] == 'private, no-store'

    client.put(
        f'{api_prefix}/trips/{trip.id}/live-location-settings',
        headers=_auth_headers(owner),
        json={'share_live_location': True},
    )
    shared = _timeline(client, api_prefix, trip.id)
    assert _modes(shared.json()['opening_route']['segments']) == ['WALK', 'CAR']
    assert shared.headers['Cache-Control'] == 'private, no-store'


@pytest.mark.integration
def test_postless_opening_route_needs_two_points(
    client,
    api_prefix,
    db_session,
    trip,
    owner,
) -> None:
    session_id = _open_session(client, api_prefix, trip_id=trip.id, user=owner)
    _upload(
        client,
        api_prefix,
        trip_id=trip.id,
        user=owner,
        session_id=session_id,
        points=[(60, 52.0, 5.0, 'WALK')],
    )

    body = _timeline(client, api_prefix, trip.id, user=owner).json()
    assert body['opening_route'] is None


@pytest.mark.integration
def test_postless_stationary_gps_is_compacted_without_changing_raw_samples(
    client,
    api_prefix,
    db_session,
    trip,
    owner,
) -> None:
    session_id = _open_session(client, api_prefix, trip_id=trip.id, user=owner)
    points = [
        (0, 52.0, 5.0, 'WALK'),
        (90, 52.00005, 5.00005, 'WALK'),
        (180, 51.99995, 4.99995, 'WALK'),
    ]
    _upload(
        client,
        api_prefix,
        trip_id=trip.id,
        user=owner,
        session_id=session_id,
        points=points,
    )

    stored = client.get(
        f'{api_prefix}/trips/{trip.id}/tracking/sessions/{session_id}/samples',
        headers=_auth_headers(owner),
    ).json()['items']
    assert [(item['latitude'], item['longitude']) for item in stored] == [
        (latitude, longitude) for _, latitude, longitude, _ in points
    ]

    body = _timeline(client, api_prefix, trip.id, user=owner).json()
    coordinates = _coordinates(body['opening_route']['segments'])[0]

    # The LineString contract needs two coordinates. Both are the same best
    # observed stationary fix, not a route through the later raw drift points.
    assert coordinates == [[5.0, 52.0], [5.0, 52.0]]


@pytest.mark.integration
def test_stationary_compaction_keeps_an_authored_post_coordinate(
    client,
    api_prefix,
    db_session,
    trip,
    owner,
) -> None:
    post_place = create_place(
        db_session,
        latitude=52.1,
        longitude=5.1,
        name='Post place',
    )
    _create_post(
        client,
        api_prefix,
        trip_id=trip.id,
        user=owner,
        place=post_place,
        title='At the stop',
        occurred_at=START + timedelta(seconds=120),
    )
    session_id = _open_session(client, api_prefix, trip_id=trip.id, user=owner)
    _upload(
        client,
        api_prefix,
        trip_id=trip.id,
        user=owner,
        session_id=session_id,
        points=[
            (0, 52.0, 5.0, 'WALK'),
            (90, 52.00005, 5.00005, 'WALK'),
        ],
    )

    body = _timeline(client, api_prefix, trip.id).json()
    coordinates = _coordinates(body['opening_route']['segments'])[0]

    assert coordinates == [[5.0, 52.0], [5.1, 52.1]]


@pytest.mark.integration
def test_final_route_follows_the_live_sharing_switch(
    client,
    api_prefix,
    db_session,
    trip,
    owner,
    place,
) -> None:
    _create_post(
        client,
        api_prefix,
        trip_id=trip.id,
        user=owner,
        place=place,
        title='Last',
        occurred_at=START,
    )
    session_id = _open_session(client, api_prefix, trip_id=trip.id, user=owner)
    _upload(
        client,
        api_prefix,
        trip_id=trip.id,
        user=owner,
        session_id=session_id,
        points=[(600, 52.0, 5.0, 'CAR')],
    )

    anonymous = _timeline(client, api_prefix, trip.id)
    assert anonymous.json()['entries'][0]['route_after'] is None
    assert anonymous.headers['Cache-Control'] == 'private, no-store'

    member = _timeline(client, api_prefix, trip.id, user=owner)
    route = member.json()['entries'][0]['route_after']
    assert route['duration_seconds'] is None
    assert _modes(route['segments']) == ['CAR']
    assert all(segment['visible_to_members_only'] for segment in route['segments'])
    assert member.headers['Cache-Control'] == 'private, no-store'

    client.put(
        f'{api_prefix}/trips/{trip.id}/live-location-settings',
        headers=_auth_headers(owner),
        json={'share_live_location': True},
    )
    member = _timeline(client, api_prefix, trip.id, user=owner)
    route = member.json()['entries'][0]['route_after']
    assert route['duration_seconds'] is None
    assert _modes(route['segments']) == ['CAR']
    assert not any(segment['visible_to_members_only'] for segment in route['segments'])
    assert member.headers['Cache-Control'] == 'private, no-store'

    shared = _timeline(client, api_prefix, trip.id)
    assert shared.json()['entries'][0]['route_after'] is not None
    assert shared.headers['Cache-Control'] == 'private, no-store'


@pytest.mark.integration
def test_final_open_route_is_absent_when_the_latest_post_is_newer_than_gps(
    client,
    api_prefix,
    db_session,
    trip,
    owner,
    place,
) -> None:
    session_id = _open_session(client, api_prefix, trip_id=trip.id, user=owner)
    _upload(
        client,
        api_prefix,
        trip_id=trip.id,
        user=owner,
        session_id=session_id,
        points=[(60, 52.0, 5.0, 'WALK'), (120, 52.1, 5.1, 'WALK')],
    )
    _create_post(
        client,
        api_prefix,
        trip_id=trip.id,
        user=owner,
        place=place,
        title='Newer than the GPS track',
        occurred_at=START + timedelta(seconds=180),
    )

    route_after = _timeline(client, api_prefix, trip.id, user=owner).json()['entries'][
        0
    ]['route_after']
    assert route_after is None


@pytest.mark.integration
def test_ended_session_after_the_final_post_is_last_seen_when_shared(
    client,
    api_prefix,
    db_session,
    trip,
    owner,
    place,
) -> None:
    _create_post(
        client,
        api_prefix,
        trip_id=trip.id,
        user=owner,
        place=place,
        title='Last',
        occurred_at=START,
    )
    session_id = uuid.uuid4()
    client.post(
        f'{api_prefix}/trips/{trip.id}/tracking/sessions/{session_id}',
        headers=_auth_headers(owner),
        json={
            'started_at': _iso(START + timedelta(minutes=1)),
            'ended_at': _iso(START + timedelta(hours=1)),
        },
    )
    _upload(
        client,
        api_prefix,
        trip_id=trip.id,
        user=owner,
        session_id=session_id,
        points=[(600, 52.0, 5.0, 'CAR')],
    )

    anonymous = _timeline(client, api_prefix, trip.id)
    assert anonymous.json()['entries'][0]['route_after'] is None

    member = _timeline(client, api_prefix, trip.id, user=owner)
    member_route = member.json()['entries'][0]['route_after']
    assert _modes(member_route['segments']) == ['CAR']
    assert all(
        segment['visible_to_members_only'] for segment in member_route['segments']
    )
    assert member.headers['Cache-Control'] == 'private, no-store'

    client.put(
        f'{api_prefix}/trips/{trip.id}/live-location-settings',
        headers=_auth_headers(owner),
        json={'share_live_location': True},
    )
    for reader in (None, owner):
        response = _timeline(client, api_prefix, trip.id, user=reader)
        route_after = response.json()['entries'][0]['route_after']
        assert _modes(route_after['segments']) == ['CAR']
        assert not any(
            segment['visible_to_members_only'] for segment in route_after['segments']
        )
        assert response.headers['Cache-Control'] == 'private, no-store'

    # A later post closes the interval and the geometry becomes history.
    _create_post(
        client,
        api_prefix,
        trip_id=trip.id,
        user=owner,
        place=place,
        title='Next',
        occurred_at=START + timedelta(hours=2),
    )
    body = _timeline(client, api_prefix, trip.id).json()
    coordinates = _coordinates(body['entries'][0]['route_after']['segments'])[0]
    assert [5.0, 52.0] in coordinates


@pytest.mark.integration
def test_drafts_do_not_leak_through_gps_geometry(
    client,
    api_prefix,
    db_session,
    trip,
    owner,
    place,
) -> None:
    _create_post(
        client,
        api_prefix,
        trip_id=trip.id,
        user=owner,
        place=place,
        title='Published first',
        occurred_at=START,
    )
    _create_post(
        client,
        api_prefix,
        trip_id=trip.id,
        user=owner,
        place=place,
        title='Hidden draft',
        occurred_at=START + timedelta(hours=1),
        publish=False,
    )
    _create_post(
        client,
        api_prefix,
        trip_id=trip.id,
        user=owner,
        place=place,
        title='Published last',
        occurred_at=START + timedelta(hours=2),
    )
    session_id = uuid.uuid4()
    client.post(
        f'{api_prefix}/trips/{trip.id}/tracking/sessions/{session_id}',
        headers=_auth_headers(owner),
        json={
            'started_at': _iso(START),
            'ended_at': _iso(START + timedelta(hours=2)),
        },
    )
    _upload(
        client,
        api_prefix,
        trip_id=trip.id,
        user=owner,
        session_id=session_id,
        points=[(1_800, 52.0, 5.0, 'CAR'), (5_400, 53.0, 6.0, 'CAR')],
    )

    public = _timeline(client, api_prefix, trip.id).json()
    assert [entry['post']['title'] for entry in public['entries']] == [
        'Published first',
        'Published last',
    ]
    # Both GPS points fall in the single visible interval, and no draft id,
    # timestamp, or location appears anywhere in the response.
    coordinates = _coordinates(public['entries'][0]['route_after']['segments'])[0]
    assert [5.0, 52.0] in coordinates
    assert [6.0, 53.0] in coordinates


@pytest.mark.integration
def test_a_draft_request_without_access_returns_an_empty_timeline(
    client,
    api_prefix,
    db_session,
    trip,
    owner,
) -> None:
    """It must not fall through to the whole-trip postless opening route."""
    session_id = _open_session(client, api_prefix, trip_id=trip.id, user=owner)
    _upload(
        client,
        api_prefix,
        trip_id=trip.id,
        user=owner,
        session_id=session_id,
        points=[(60, 52.0, 5.0, 'WALK'), (120, 52.1, 5.1, 'WALK')],
    )

    body = _timeline(
        client,
        api_prefix,
        trip.id,
        params={'status': 'draft'},
    ).json()
    assert body == {'opening_route': None, 'entries': []}


@pytest.mark.integration
def test_session_boundaries_are_not_map_anchors(
    client,
    api_prefix,
    db_session,
    trip,
    owner,
    place,
) -> None:
    _create_post(
        client,
        api_prefix,
        trip_id=trip.id,
        user=owner,
        place=place,
        title='A',
        occurred_at=START,
    )
    _create_post(
        client,
        api_prefix,
        trip_id=trip.id,
        user=owner,
        place=place,
        title='B',
        occurred_at=START + timedelta(hours=4),
    )

    first = uuid.uuid4()
    client.post(
        f'{api_prefix}/trips/{trip.id}/tracking/sessions/{first}',
        headers=_auth_headers(owner),
        json={
            'started_at': _iso(START),
            'ended_at': _iso(START + timedelta(hours=1)),
        },
    )
    _upload(
        client,
        api_prefix,
        trip_id=trip.id,
        user=owner,
        session_id=first,
        points=[(600, 52.0, 5.0, 'CAR')],
    )

    second = uuid.uuid4()
    client.post(
        f'{api_prefix}/trips/{trip.id}/tracking/sessions/{second}',
        headers=_auth_headers(owner),
        json={
            'started_at': _iso(START + timedelta(hours=2)),
            'ended_at': _iso(START + timedelta(hours=3)),
        },
    )
    _upload(
        client,
        api_prefix,
        trip_id=trip.id,
        user=owner,
        session_id=second,
        points=[(7_800, 53.0, 6.0, 'CAR')],
    )

    body = _timeline(client, api_prefix, trip.id).json()
    segments = body['entries'][0]['route_after']['segments']
    # One continuous CAR run: the boundary between the two sessions produces no
    # extra anchor and no extra segment.
    assert _modes(segments) == ['CAR']
    coordinates = _coordinates(segments)[0]
    assert coordinates.index([5.0, 52.0]) + 1 == coordinates.index([6.0, 53.0])


@pytest.mark.integration
def test_a_gps_point_at_a_posts_timestamp_lands_in_exactly_one_interval(
    client,
    api_prefix,
    db_session,
    trip,
    owner,
    place,
) -> None:
    """Posts sort before GPS points, so this belongs to the later interval."""
    _create_post(
        client,
        api_prefix,
        trip_id=trip.id,
        user=owner,
        place=place,
        title='A',
        occurred_at=START,
    )
    _create_post(
        client,
        api_prefix,
        trip_id=trip.id,
        user=owner,
        place=place,
        title='B',
        occurred_at=START + timedelta(hours=1),
    )
    _create_post(
        client,
        api_prefix,
        trip_id=trip.id,
        user=owner,
        place=place,
        title='C',
        occurred_at=START + timedelta(hours=2),
    )

    session_id = uuid.uuid4()
    client.post(
        f'{api_prefix}/trips/{trip.id}/tracking/sessions/{session_id}',
        headers=_auth_headers(owner),
        json={
            'started_at': _iso(START),
            'ended_at': _iso(START + timedelta(hours=2)),
        },
    )
    # Recorded at exactly post B's occurred_at.
    _upload(
        client,
        api_prefix,
        trip_id=trip.id,
        user=owner,
        session_id=session_id,
        points=[(3_600, 52.0, 5.0, 'BIKE')],
    )

    body = _timeline(client, api_prefix, trip.id).json()
    first_interval = _coordinates(body['entries'][0]['route_after']['segments'])
    second_interval = _coordinates(body['entries'][1]['route_after']['segments'])
    first_flat = [point for segment in first_interval for point in segment]
    second_flat = [point for segment in second_interval for point in segment]

    assert [5.0, 52.0] not in first_flat
    assert [5.0, 52.0] in second_flat


@pytest.mark.integration
def test_a_post_inside_a_privacy_zone_stays_an_anchor(
    client,
    api_prefix,
    db_session,
    trip,
    owner,
) -> None:
    """Zones filter GPS telemetry, never an explicitly published post."""
    place_in_zone = create_place(db_session, latitude=51.4416, longitude=5.4697)
    client.post(
        f'{api_prefix}/users/me/gps-privacy-zones',
        headers=_auth_headers(owner),
        json={
            'name': 'Home',
            'latitude': 51.4416,
            'longitude': 5.4697,
            'radius_meters': 500,
        },
    )
    _create_post(
        client,
        api_prefix,
        trip_id=trip.id,
        user=owner,
        place=place_in_zone,
        title='Home',
        occurred_at=START,
    )
    _create_post(
        client,
        api_prefix,
        trip_id=trip.id,
        user=owner,
        place=place_in_zone,
        title='Away',
        occurred_at=START + timedelta(hours=2),
    )
    session_id = uuid.uuid4()
    client.post(
        f'{api_prefix}/trips/{trip.id}/tracking/sessions/{session_id}',
        headers=_auth_headers(owner),
        json={
            'started_at': _iso(START),
            'ended_at': _iso(START + timedelta(hours=2)),
        },
    )
    _upload(
        client,
        api_prefix,
        trip_id=trip.id,
        user=owner,
        session_id=session_id,
        points=[(3_600, 52.5, 6.5, 'CAR')],
    )

    body = _timeline(client, api_prefix, trip.id).json()
    coordinates = _coordinates(body['entries'][0]['route_after']['segments'])[0]
    assert coordinates[0] == [5.4697, 51.4416]
    assert [6.5, 52.5] in coordinates


@pytest.mark.integration
def test_share_link_and_viewer_readers_receive_the_opening_route(
    client,
    api_prefix,
    db_session,
    owner,
    place,
) -> None:
    private_trip = create_trip(
        db_session,
        owner_id=owner.id,
        visibility=TripVisibility.PRIVATE,
    )
    viewer = create_user(db_session, password='TrackPass123!')
    add_trip_viewer(
        db_session,
        trip_id=private_trip.id,
        user_id=viewer.id,
        created_by=owner.id,
    )

    session_id = uuid.uuid4()
    client.post(
        f'{api_prefix}/trips/{private_trip.id}/tracking/sessions/{session_id}',
        headers=_auth_headers(owner),
        json={
            'started_at': _iso(START),
            'ended_at': _iso(START + timedelta(hours=1)),
        },
    )
    _upload(
        client,
        api_prefix,
        trip_id=private_trip.id,
        user=owner,
        session_id=session_id,
        points=[(600, 52.0, 5.0, 'TRAIN')],
    )
    _create_post(
        client,
        api_prefix,
        trip_id=private_trip.id,
        user=owner,
        place=place,
        title='First',
        occurred_at=START + timedelta(hours=2),
    )

    body = _timeline(client, api_prefix, private_trip.id, user=viewer).json()
    assert body['opening_route'] is not None
    coordinates = _coordinates(body['opening_route']['segments'])[0]
    assert [5.0, 52.0] in coordinates


@pytest.mark.integration
def test_members_can_edit_modes_and_the_timeline_follows(
    client,
    api_prefix,
    db_session,
    trip,
    owner,
    place,
) -> None:
    member = create_user(db_session, password='TrackPass123!')
    add_trip_member(
        db_session,
        trip_id=trip.id,
        user_id=member.id,
        role=TripRole.MEMBER,
    )

    _create_post(
        client,
        api_prefix,
        trip_id=trip.id,
        user=owner,
        place=place,
        title='A',
        occurred_at=START,
    )
    _create_post(
        client,
        api_prefix,
        trip_id=trip.id,
        user=owner,
        place=place,
        title='B',
        occurred_at=START + timedelta(hours=2),
    )
    session_id = uuid.uuid4()
    client.post(
        f'{api_prefix}/trips/{trip.id}/tracking/sessions/{session_id}',
        headers=_auth_headers(owner),
        json={
            'started_at': _iso(START),
            'ended_at': _iso(START + timedelta(hours=2)),
        },
    )
    _upload(
        client,
        api_prefix,
        trip_id=trip.id,
        user=owner,
        session_id=session_id,
        points=[(3_600, 52.0, 5.0, 'UNKNOWN')],
    )

    stored = client.get(
        f'{api_prefix}/trips/{trip.id}/tracking/sessions/{session_id}/samples',
        headers=_auth_headers(member),
    ).json()['items']

    # A member edits a point the owner recorded.
    updated = client.patch(
        f'{api_prefix}/trips/{trip.id}/tracking/samples/travel-mode',
        headers=_auth_headers(member),
        json={
            'sample_ids': [stored[0]['id']],
            'travel_mode': 'MOTORCYCLE',
        },
    )
    assert updated.json() == {'updated_count': 1}

    body = _timeline(client, api_prefix, trip.id).json()
    assert _modes(body['entries'][0]['route_after']['segments']) == ['MOTORCYCLE']
