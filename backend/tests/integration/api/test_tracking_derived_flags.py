"""The stored derived flags must never fall behind the points they describe.

Post candidates and timeline geometry are both read straight out of these
columns, so a write path that forgets to refresh them does not fail loudly —
it quietly serves a stale map. These tests pin every write that can change
what a session's track means.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import select

from core import security
from factories.trips import create_trip
from factories.users import create_user
from models.database.gps_tracking import GpsTrackSample
from models.database.trips import TripVisibility

START = datetime(2026, 8, 14, 8, 0, tzinfo=timezone.utc)


def _auth_headers(user) -> dict[str, str]:
    tokens = security.create_auth_tokens(subject=user.id, email=user.email)
    return {'Authorization': f'Bearer {tokens["access_token"]}'}


def _iso(moment: datetime) -> str:
    return moment.isoformat().replace('+00:00', 'Z')


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


def _open_session(client, api_prefix, *, trip_id, user):
    session_id = uuid.uuid4()
    response = client.post(
        f'{api_prefix}/trips/{trip_id}/tracking/sessions/{session_id}',
        headers=_auth_headers(user),
        json={'started_at': _iso(START), 'ended_at': None},
    )
    assert response.status_code == 201, response.text
    return session_id


def _upload(client, api_prefix, *, trip_id, user, session_id, points):
    """Upload ``(offset_seconds, latitude, longitude, travel_mode)`` points."""
    sample_ids = [uuid.uuid4() for _ in points]
    response = client.post(
        f'{api_prefix}/trips/{trip_id}/tracking/sessions/{session_id}/samples/batch',
        headers=_auth_headers(user),
        json={
            'samples': [
                {
                    'id': str(sample_id),
                    'recorded_at': _iso(START + timedelta(seconds=offset)),
                    'latitude': latitude,
                    'longitude': longitude,
                    'accuracy_meters': None,
                    'travel_mode': mode,
                }
                for sample_id, (offset, latitude, longitude, mode) in zip(
                    sample_ids, points, strict=True
                )
            ]
        },
    )
    assert response.status_code == 200, response.text
    return sample_ids


def _flags(db_session, sample_id):
    row = db_session.execute(
        select(
            GpsTrackSample.is_long_stay,
            GpsTrackSample.is_post_candidate,
            GpsTrackSample.is_display_retained,
        ).where(GpsTrackSample.id == sample_id)
    ).one()
    return {
        'long_stay': row.is_long_stay,
        'candidate': row.is_post_candidate,
        'retained': row.is_display_retained,
    }


def _all_flags(db_session, trip_id):
    return db_session.execute(
        select(
            GpsTrackSample.id,
            GpsTrackSample.is_long_stay,
            GpsTrackSample.is_post_candidate,
            GpsTrackSample.is_display_retained,
        ).where(GpsTrackSample.trip_id == trip_id)
    ).all()


def _candidate_ids(client, api_prefix, *, trip_id, user) -> set[str]:
    response = client.get(
        f'{api_prefix}/trips/{trip_id}/tracking/post-candidates',
        headers=_auth_headers(user),
    )
    assert response.status_code == 200, response.text
    return {item['id'] for item in response.json()}


def _straight_walk(count: int, *, step_seconds: int = 60, step_degrees: float = 0.01):
    return [
        (index * step_seconds, 52.0 + index * step_degrees, 5.0, 'WALK')
        for index in range(count)
    ]


@pytest.mark.integration
def test_uploading_points_derives_their_flags_immediately(
    client,
    api_prefix,
    db_session,
    trip,
    owner,
) -> None:
    session_id = _open_session(client, api_prefix, trip_id=trip.id, user=owner)
    sample_ids = _upload(
        client,
        api_prefix,
        trip_id=trip.id,
        user=owner,
        session_id=session_id,
        points=_straight_walk(6),
    )

    assert _flags(db_session, sample_ids[0])['candidate'] is True
    assert _candidate_ids(client, api_prefix, trip_id=trip.id, user=owner) == {
        str(sample_id)
        for sample_id in sample_ids
        if _flags(db_session, sample_id)['candidate']
    }


@pytest.mark.integration
def test_a_later_batch_can_change_what_an_earlier_point_means(
    client,
    api_prefix,
    db_session,
    trip,
    owner,
) -> None:
    """Why a session is re-derived whole rather than only at its new tail."""
    session_id = _open_session(client, api_prefix, trip_id=trip.id, user=owner)
    first = _upload(
        client,
        api_prefix,
        trip_id=trip.id,
        user=owner,
        session_id=session_id,
        points=[(0, 52.0, 5.0, 'WALK'), (60, 52.0, 5.0, 'WALK')],
    )
    before = _flags(db_session, first[1])

    # Standing still long enough turns the pair above into a confirmed stop,
    # which compaction then collapses onto its representative.
    _upload(
        client,
        api_prefix,
        trip_id=trip.id,
        user=owner,
        session_id=session_id,
        points=[(120, 52.0, 5.0, 'WALK'), (180, 52.0, 5.0, 'WALK')],
    )
    db_session.expire_all()

    assert before['retained'] is True
    assert _flags(db_session, first[1])['retained'] is False


@pytest.mark.integration
def test_ending_a_session_promotes_its_final_point(
    client,
    api_prefix,
    db_session,
    trip,
    owner,
) -> None:
    session_id = _open_session(client, api_prefix, trip_id=trip.id, user=owner)
    sample_ids = _upload(
        client,
        api_prefix,
        trip_id=trip.id,
        user=owner,
        session_id=session_id,
        points=_straight_walk(6),
    )
    assert _flags(db_session, sample_ids[-1])['candidate'] is False

    response = client.patch(
        f'{api_prefix}/trips/{trip.id}/tracking/sessions/{session_id}',
        headers=_auth_headers(owner),
        json={'ended_at': _iso(START + timedelta(seconds=600))},
    )
    assert response.status_code == 200, response.text
    db_session.expire_all()

    assert _flags(db_session, sample_ids[-1])['candidate'] is True
    assert str(sample_ids[-1]) in _candidate_ids(
        client, api_prefix, trip_id=trip.id, user=owner
    )


@pytest.mark.integration
def test_changing_travel_mode_redraws_the_display_track(
    client,
    api_prefix,
    db_session,
    trip,
    owner,
) -> None:
    session_id = _open_session(client, api_prefix, trip_id=trip.id, user=owner)
    sample_ids = _upload(
        client,
        api_prefix,
        trip_id=trip.id,
        user=owner,
        session_id=session_id,
        points=_straight_walk(8),
    )
    # A straight line, so simplification drops the middle of it.
    middle = sample_ids[4]
    assert _flags(db_session, middle)['retained'] is False

    response = client.patch(
        f'{api_prefix}/trips/{trip.id}/tracking/samples/travel-mode',
        headers=_auth_headers(owner),
        json={
            'sample_ids': [str(sample_id) for sample_id in sample_ids[4:]],
            'travel_mode': 'CAR',
        },
    )
    assert response.status_code == 200, response.text
    db_session.expire_all()

    # The mode change ends one drawn stretch and starts another, so the
    # boundary point has to come back onto the track.
    assert _flags(db_session, middle)['retained'] is True


@pytest.mark.integration
def test_deleting_points_rederives_the_rest_of_the_session(
    client,
    api_prefix,
    db_session,
    trip,
    owner,
) -> None:
    session_id = _open_session(client, api_prefix, trip_id=trip.id, user=owner)
    sample_ids = _upload(
        client,
        api_prefix,
        trip_id=trip.id,
        user=owner,
        session_id=session_id,
        points=_straight_walk(8),
    )

    response = client.post(
        f'{api_prefix}/trips/{trip.id}/tracking/samples/delete',
        headers=_auth_headers(owner),
        json={'sample_ids': [str(sample_ids[0])]},
    )
    assert response.status_code == 200, response.text
    db_session.expire_all()

    # The first surviving point inherits the session's opening prompt.
    assert _flags(db_session, sample_ids[1])['candidate'] is True


@pytest.mark.integration
def test_every_marker_stays_on_the_display_track(
    client,
    api_prefix,
    db_session,
    trip,
    owner,
) -> None:
    """The invariant that lets post-candidates skip building any geometry."""
    session_id = _open_session(client, api_prefix, trip_id=trip.id, user=owner)
    _upload(
        client,
        api_prefix,
        trip_id=trip.id,
        user=owner,
        session_id=session_id,
        points=_straight_walk(30),
    )

    rows = _all_flags(db_session, trip.id)
    assert rows
    for row in rows:
        if row.is_long_stay:
            assert row.is_post_candidate
        if row.is_post_candidate:
            assert row.is_display_retained
