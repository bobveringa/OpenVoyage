from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session

from core import security
from factories.trips import add_trip_member, add_trip_viewer, create_trip
from factories.users import create_user
from models.database.gps_privacy_zones import GpsPrivacyZone
from models.database.trips import TripMember, TripRole, TripVisibility

START = datetime(2026, 8, 14, 8, 0, tzinfo=timezone.utc)


def _auth_headers(user) -> dict[str, str]:
    tokens = security.create_auth_tokens(subject=user.id, email=user.email)
    return {'Authorization': f'Bearer {tokens["access_token"]}'}


def _iso(moment: datetime) -> str:
    return moment.isoformat().replace('+00:00', 'Z')


def _sample(
    *,
    offset_seconds: int,
    latitude: float = 51.5,
    longitude: float = 5.5,
    travel_mode: str = 'UNKNOWN',
    sample_id: uuid.UUID | None = None,
    speed_mps: float | None = None,
    heading_degrees: float | None = None,
    altitude_meters: float | None = None,
) -> dict:
    return {
        'id': str(sample_id or uuid.uuid4()),
        'recorded_at': _iso(START + timedelta(seconds=offset_seconds)),
        'latitude': latitude,
        'longitude': longitude,
        'accuracy_meters': 8.4,
        'speed_mps': speed_mps,
        'heading_degrees': heading_degrees,
        'altitude_meters': altitude_meters,
        'travel_mode': travel_mode,
    }


class TrackingClient:
    """Thin wrapper so the tests read as tracking operations, not URLs."""

    def __init__(self, client, api_prefix: str, trip_id: uuid.UUID, user) -> None:
        self.client = client
        self.base = f'{api_prefix}/trips/{trip_id}/tracking'
        self.trip_base = f'{api_prefix}/trips/{trip_id}'
        self.headers = _auth_headers(user)

    def put_session(
        self,
        session_id: uuid.UUID,
        *,
        started_at: datetime,
        ended_at: datetime | None = None,
    ):
        return self.client.post(
            f'{self.base}/sessions/{session_id}',
            headers=self.headers,
            json={
                'started_at': _iso(started_at),
                'ended_at': _iso(ended_at) if ended_at else None,
            },
        )

    def end_session(self, session_id: uuid.UUID, *, ended_at: datetime):
        return self.client.patch(
            f'{self.base}/sessions/{session_id}',
            headers=self.headers,
            json={'ended_at': _iso(ended_at)},
        )

    def upload(self, session_id: uuid.UUID, samples: list[dict]):
        return self.client.post(
            f'{self.base}/sessions/{session_id}/samples/batch',
            headers=self.headers,
            json={'samples': samples},
        )

    def raw_samples(self, session_id: uuid.UUID, **params):
        return self.client.get(
            f'{self.base}/sessions/{session_id}/samples',
            headers=self.headers,
            params=params,
        )

    def sessions(self):
        return self.client.get(f'{self.base}/sessions', headers=self.headers)

    def delete_session(self, session_id: uuid.UUID):
        return self.client.delete(
            f'{self.base}/sessions/{session_id}',
            headers=self.headers,
        )

    def set_modes(self, sample_ids: list[str], travel_mode: str):
        return self.client.patch(
            f'{self.base}/samples/travel-mode',
            headers=self.headers,
            json={'sample_ids': sample_ids, 'travel_mode': travel_mode},
        )

    def delete_samples(self, sample_ids: list[str]):
        return self.client.post(
            f'{self.base}/samples/delete',
            headers=self.headers,
            json={'sample_ids': sample_ids},
        )

    def settings(self):
        return self.client.get(
            f'{self.trip_base}/live-location-settings',
            headers=self.headers,
        )

    def set_live_sharing(self, enabled: bool):
        return self.client.put(
            f'{self.trip_base}/live-location-settings',
            headers=self.headers,
            json={'share_live_location': enabled},
        )


def _zone_url(api_prefix: str) -> str:
    return f'{api_prefix}/users/me/gps-privacy-zones'


def _create_zone(
    client,
    api_prefix: str,
    user,
    *,
    name: str = 'Home',
    latitude: float = 51.4416,
    longitude: float = 5.4697,
    radius_meters: int = 500,
):
    return client.post(
        _zone_url(api_prefix),
        headers=_auth_headers(user),
        json={
            'name': name,
            'latitude': latitude,
            'longitude': longitude,
            'radius_meters': radius_meters,
        },
    )


@pytest.fixture()
def trip_owner(db_session):
    return create_user(db_session, password='TrackPass123!')


@pytest.fixture()
def trip(db_session, trip_owner):
    return create_trip(
        db_session,
        owner_id=trip_owner.id,
        visibility=TripVisibility.PUBLIC,
    )


@pytest.fixture()
def tracking(client, api_prefix, trip, trip_owner) -> TrackingClient:
    return TrackingClient(client, api_prefix, trip.id, trip_owner)


# ---------------------------------------------------------------------------
# Privacy zones
# ---------------------------------------------------------------------------
@pytest.mark.integration
def test_zone_crud_is_owner_only(client, db_session, api_prefix) -> None:
    owner = create_user(db_session, password='TrackPass123!')
    stranger = create_user(db_session, password='TrackPass123!')

    created = _create_zone(client, api_prefix, owner)
    assert created.status_code == 201
    zone_id = created.json()['zone']['id']

    # The request test client normally shares ``db_session``. Verify through a
    # separate session so this catches an endpoint that flushes but forgets to
    # commit (the browser's following GET would use a new session too).
    with Session(bind=db_session.get_bind()) as verification_session:
        persisted_zone_id = verification_session.scalar(
            select(GpsPrivacyZone.id).where(GpsPrivacyZone.id == uuid.UUID(zone_id))
        )
    assert persisted_zone_id is not None

    listed = client.get(_zone_url(api_prefix), headers=_auth_headers(owner))
    assert [zone['id'] for zone in listed.json()] == [zone_id]

    # Another account cannot see or touch it, and gets the same 404 it would
    # get for an id that never existed.
    assert (
        client.get(
            _zone_url(api_prefix),
            headers=_auth_headers(stranger),
        ).json()
        == []
    )
    assert (
        client.put(
            f'{_zone_url(api_prefix)}/{zone_id}',
            headers=_auth_headers(stranger),
            json={
                'name': 'Theirs',
                'latitude': 0.0,
                'longitude': 0.0,
                'radius_meters': 500,
            },
        ).status_code
        == 404
    )
    assert (
        client.delete(
            f'{_zone_url(api_prefix)}/{zone_id}',
            headers=_auth_headers(stranger),
        ).status_code
        == 404
    )


@pytest.mark.integration
def test_zone_put_never_creates(client, db_session, api_prefix) -> None:
    owner = create_user(db_session, password='TrackPass123!')
    response = client.put(
        f'{_zone_url(api_prefix)}/{uuid.uuid4()}',
        headers=_auth_headers(owner),
        json={
            'name': 'Home',
            'latitude': 51.4416,
            'longitude': 5.4697,
            'radius_meters': 500,
        },
    )
    assert response.status_code == 404


@pytest.mark.integration
def test_twenty_first_zone_is_rejected(client, db_session, api_prefix) -> None:
    owner = create_user(db_session, password='TrackPass123!')
    for index in range(20):
        assert (
            _create_zone(
                client,
                api_prefix,
                owner,
                name=f'Zone {index}',
                latitude=float(index),
            ).status_code
            == 201
        )

    assert (
        _create_zone(
            client,
            api_prefix,
            owner,
            name='One too many',
        ).status_code
        == 422
    )


@pytest.mark.integration
def test_zone_radius_is_bounded_by_the_api(client, db_session, api_prefix) -> None:
    owner = create_user(db_session, password='TrackPass123!')
    assert (
        _create_zone(
            client,
            api_prefix,
            owner,
            radius_meters=50,
        ).status_code
        == 422
    )
    assert (
        _create_zone(
            client,
            api_prefix,
            owner,
            radius_meters=10_000,
        ).status_code
        == 201
    )
    assert (
        _create_zone(
            client,
            api_prefix,
            owner,
            radius_meters=10_001,
        ).status_code
        == 422
    )


# ---------------------------------------------------------------------------
# Sessions
# ---------------------------------------------------------------------------
@pytest.mark.integration
def test_creating_an_existing_session_conflicts(tracking) -> None:
    session_id = uuid.uuid4()

    created = tracking.put_session(session_id, started_at=START)
    assert created.status_code == 201
    assert created.json()['ended_at'] is None

    replayed = tracking.put_session(session_id, started_at=START)
    assert replayed.status_code == 409


@pytest.mark.integration
def test_creating_with_a_reused_id_conflicts(tracking) -> None:
    session_id = uuid.uuid4()
    assert tracking.put_session(session_id, started_at=START).status_code == 201
    conflict = tracking.put_session(
        session_id,
        started_at=START + timedelta(minutes=5),
    )
    assert conflict.status_code == 409


@pytest.mark.integration
def test_end_time_is_monotonic_and_never_moves_backward(tracking) -> None:
    session_id = uuid.uuid4()
    tracking.put_session(session_id, started_at=START)

    ended = tracking.end_session(
        session_id,
        ended_at=START + timedelta(hours=4),
    )
    assert ended.status_code == 200
    assert ended.json()['ended_at'] == _iso(START + timedelta(hours=4))

    earlier = tracking.end_session(
        session_id,
        ended_at=START + timedelta(hours=1),
    )
    assert earlier.status_code == 200
    assert earlier.json()['ended_at'] == _iso(START + timedelta(hours=4))


@pytest.mark.integration
def test_end_time_absorbs_a_newer_retained_sample(tracking) -> None:
    session_id = uuid.uuid4()
    tracking.put_session(session_id, started_at=START)
    tracking.upload(session_id, [_sample(offset_seconds=600)])

    # The device stopped a moment before its last buffered fix.
    ended = tracking.end_session(
        session_id,
        ended_at=START + timedelta(seconds=300),
    )
    assert ended.status_code == 200
    assert ended.json()['ended_at'] == _iso(START + timedelta(seconds=600))

    # Repeating the end update is safe for an offline retry.
    assert (
        tracking.end_session(
            session_id,
            ended_at=START + timedelta(seconds=300),
        ).status_code
        == 200
    )


@pytest.mark.integration
def test_ended_before_started_is_unprocessable(tracking) -> None:
    response = tracking.put_session(
        uuid.uuid4(),
        started_at=START,
        ended_at=START - timedelta(hours=1),
    )
    assert response.status_code == 422


@pytest.mark.integration
def test_overlapping_sessions_conflict_but_touching_ones_do_not(tracking) -> None:
    first = uuid.uuid4()
    tracking.put_session(
        first,
        started_at=START,
        ended_at=START + timedelta(hours=2),
    )

    overlapping = tracking.put_session(
        uuid.uuid4(),
        started_at=START + timedelta(hours=1),
        ended_at=START + timedelta(hours=3),
    )
    assert overlapping.status_code == 409

    touching = tracking.put_session(
        uuid.uuid4(),
        started_at=START + timedelta(hours=2),
        ended_at=START + timedelta(hours=3),
    )
    assert touching.status_code == 201


@pytest.mark.integration
def test_a_trip_cannot_hold_two_open_sessions(tracking) -> None:
    tracking.put_session(uuid.uuid4(), started_at=START)
    second = tracking.put_session(
        uuid.uuid4(),
        started_at=START + timedelta(hours=5),
    )
    assert second.status_code == 409


@pytest.mark.integration
def test_a_historical_session_may_be_backfilled_under_an_open_one(
    tracking,
) -> None:
    tracking.put_session(uuid.uuid4(), started_at=START + timedelta(hours=5))
    backfilled = tracking.put_session(
        uuid.uuid4(),
        started_at=START,
        ended_at=START + timedelta(hours=5),
    )
    assert backfilled.status_code == 201


@pytest.mark.integration
def test_deleted_session_can_be_recreated(tracking) -> None:
    session_id = uuid.uuid4()
    tracking.put_session(session_id, started_at=START)
    sample = _sample(offset_seconds=60)
    tracking.upload(session_id, [sample])

    assert tracking.delete_session(session_id).status_code == 204

    assert tracking.sessions().json()['sessions'] == []
    assert tracking.put_session(session_id, started_at=START).status_code == 201
    assert (
        tracking.end_session(
            session_id,
            ended_at=START + timedelta(hours=1),
        ).status_code
        == 200
    )
    assert tracking.upload(session_id, [sample]).status_code == 200
    assert tracking.raw_samples(session_id).json()['items'][0]['id'] == sample['id']


@pytest.mark.integration
def test_deleting_a_session_frees_its_interval(tracking) -> None:
    first = uuid.uuid4()
    tracking.put_session(
        first,
        started_at=START,
        ended_at=START + timedelta(hours=2),
    )
    tracking.delete_session(first)

    replacement = tracking.put_session(
        uuid.uuid4(),
        started_at=START,
        ended_at=START + timedelta(hours=2),
    )
    assert replacement.status_code == 201


# ---------------------------------------------------------------------------
# Sample upload
# ---------------------------------------------------------------------------
@pytest.mark.integration
def test_batch_counts_add_up_across_every_bucket(
    tracking,
    client,
    api_prefix,
    trip_owner,
) -> None:
    _create_zone(client, api_prefix, trip_owner, latitude=51.4416, longitude=5.4697)

    session_id = uuid.uuid4()
    tracking.put_session(
        session_id,
        started_at=START,
        ended_at=START + timedelta(hours=1),
    )

    stored = _sample(offset_seconds=60)
    assert tracking.upload(session_id, [stored]).json() == {
        'accepted_samples': 1,
        'filtered_samples': 0,
        'duplicate_samples': 0,
        'discarded_samples': 0,
    }

    batch = [
        stored,  # duplicate
        _sample(offset_seconds=120),  # accepted
        _sample(offset_seconds=180, latitude=51.4416, longitude=5.4697),  # filtered
        _sample(offset_seconds=99_999),  # discarded, past ended_at
    ]
    result = tracking.upload(session_id, batch).json()
    assert result == {
        'accepted_samples': 1,
        'filtered_samples': 1,
        'duplicate_samples': 1,
        'discarded_samples': 1,
    }
    assert sum(result.values()) == len(batch)


@pytest.mark.integration
def test_speed_heading_altitude_round_trip_and_default_to_null(tracking) -> None:
    session_id = uuid.uuid4()
    tracking.put_session(session_id, started_at=START)

    with_motion = _sample(
        offset_seconds=60,
        speed_mps=1.4,
        heading_degrees=180.0,
        altitude_meters=42.0,
    )
    without_motion = _sample(offset_seconds=120)
    result = tracking.upload(session_id, [with_motion, without_motion]).json()
    assert result['accepted_samples'] == 2

    stored = {
        point['id']: point
        for point in tracking.raw_samples(session_id).json()['items']
    }
    assert stored[with_motion['id']]['speed_mps'] == 1.4
    assert stored[with_motion['id']]['heading_degrees'] == 180.0
    assert stored[with_motion['id']]['altitude_meters'] == 42.0
    assert stored[without_motion['id']]['speed_mps'] is None
    assert stored[without_motion['id']]['heading_degrees'] is None
    assert stored[without_motion['id']]['altitude_meters'] is None


@pytest.mark.integration
@pytest.mark.parametrize(
    'field,value',
    [('speed_mps', -1.0), ('heading_degrees', -1.0), ('heading_degrees', 361.0)],
)
def test_out_of_range_motion_fields_are_rejected(tracking, field, value) -> None:
    session_id = uuid.uuid4()
    tracking.put_session(session_id, started_at=START)

    sample = _sample(offset_seconds=60)
    sample[field] = value
    response = tracking.upload(session_id, [sample])
    assert response.status_code == 422


@pytest.mark.integration
def test_a_retained_point_is_a_duplicate_even_after_a_zone_covers_it(
    tracking,
    client,
    api_prefix,
    trip_owner,
) -> None:
    session_id = uuid.uuid4()
    tracking.put_session(session_id, started_at=START)

    sample = _sample(offset_seconds=60, latitude=51.4416, longitude=5.4697)
    assert tracking.upload(session_id, [sample]).json()['accepted_samples'] == 1

    _create_zone(client, api_prefix, trip_owner, latitude=51.4416, longitude=5.4697)

    # The stored row wins and is never re-examined, so the client's
    # reconciliation cannot drift.
    replayed = tracking.upload(session_id, [sample]).json()
    assert replayed['duplicate_samples'] == 1
    assert replayed['filtered_samples'] == 0

    stored = tracking.raw_samples(session_id).json()['items']
    assert [point['id'] for point in stored] == [sample['id']]


@pytest.mark.integration
def test_filtered_points_are_never_written(
    tracking,
    client,
    api_prefix,
    trip_owner,
) -> None:
    _create_zone(client, api_prefix, trip_owner, latitude=51.4416, longitude=5.4697)
    session_id = uuid.uuid4()
    tracking.put_session(session_id, started_at=START)

    response = tracking.upload(
        session_id,
        [_sample(offset_seconds=60, latitude=51.4416, longitude=5.4697)],
    ).json()
    assert response['filtered_samples'] == 1
    assert response['accepted_samples'] == 0
    # No coordinate, and nothing that names a zone, an owner, or a rule.
    assert set(response) == {
        'accepted_samples',
        'filtered_samples',
        'duplicate_samples',
        'discarded_samples',
    }
    assert tracking.raw_samples(session_id).json()['items'] == []


@pytest.mark.integration
def test_another_members_zone_filters_every_tracker_in_the_trip(
    client,
    db_session,
    api_prefix,
    trip,
    trip_owner,
) -> None:
    member = create_user(db_session, password='TrackPass123!')
    add_trip_member(
        db_session, trip_id=trip.id, user_id=member.id, role=TripRole.MEMBER
    )
    _create_zone(client, api_prefix, member, latitude=51.4416, longitude=5.4697)

    owner_tracking = TrackingClient(client, api_prefix, trip.id, trip_owner)
    session_id = uuid.uuid4()
    owner_tracking.put_session(session_id, started_at=START)

    response = owner_tracking.upload(
        session_id,
        [_sample(offset_seconds=60, latitude=51.4416, longitude=5.4697)],
    ).json()
    assert response['filtered_samples'] == 1


@pytest.mark.integration
def test_upload_to_an_unknown_session_is_a_retryable_404(tracking) -> None:
    session_id = uuid.uuid4()
    sample = _sample(offset_seconds=60)

    # The batch overtook the session creation request.
    assert tracking.upload(session_id, [sample]).status_code == 404

    tracking.put_session(session_id, started_at=START)
    retried = tracking.upload(session_id, [sample])
    assert retried.status_code == 200
    assert retried.json()['accepted_samples'] == 1


@pytest.mark.integration
def test_reusing_a_sample_id_in_another_session_conflicts(tracking) -> None:
    first = uuid.uuid4()
    second = uuid.uuid4()
    tracking.put_session(
        first,
        started_at=START,
        ended_at=START + timedelta(hours=1),
    )
    tracking.put_session(second, started_at=START + timedelta(hours=2))

    sample = _sample(offset_seconds=60)
    assert tracking.upload(first, [sample]).status_code == 200

    reused = dict(sample, recorded_at=_iso(START + timedelta(hours=3)))
    assert tracking.upload(second, [reused]).status_code == 409
    assert tracking.raw_samples(second).json()['items'] == []


@pytest.mark.integration
def test_duplicate_ids_within_one_batch_are_rejected(tracking) -> None:
    session_id = uuid.uuid4()
    tracking.put_session(session_id, started_at=START)
    sample = _sample(offset_seconds=60)
    assert tracking.upload(session_id, [sample, sample]).status_code == 422


@pytest.mark.integration
def test_out_of_order_and_late_batches_are_accepted(tracking) -> None:
    session_id = uuid.uuid4()
    tracking.put_session(
        session_id,
        started_at=START,
        ended_at=START + timedelta(hours=1),
    )
    assert (
        tracking.upload(
            session_id,
            [_sample(offset_seconds=600), _sample(offset_seconds=60)],
        ).json()['accepted_samples']
        == 2
    )

    stored = tracking.raw_samples(session_id).json()['items']
    assert [point['recorded_at'] for point in stored] == [
        _iso(START + timedelta(seconds=60)),
        _iso(START + timedelta(seconds=600)),
    ]


@pytest.mark.integration
def test_a_trailing_sample_can_be_recovered_by_advancing_the_end(
    tracking,
) -> None:
    session_id = uuid.uuid4()
    tracking.put_session(
        session_id,
        started_at=START,
        ended_at=START + timedelta(minutes=10),
    )
    late = _sample(offset_seconds=1_200)

    first = tracking.upload(session_id, [late, _sample(offset_seconds=60)]).json()
    assert first['discarded_samples'] == 1
    assert first['accepted_samples'] == 1

    tracking.end_session(
        session_id,
        ended_at=START + timedelta(minutes=30),
    )
    assert tracking.upload(session_id, [late]).json()['accepted_samples'] == 1


# ---------------------------------------------------------------------------
# Authorization
# ---------------------------------------------------------------------------
@pytest.mark.integration
def test_only_the_recorder_may_upload(
    client,
    db_session,
    api_prefix,
    trip,
    trip_owner,
) -> None:
    member = create_user(db_session, password='TrackPass123!')
    add_trip_member(
        db_session, trip_id=trip.id, user_id=member.id, role=TripRole.MEMBER
    )

    owner_tracking = TrackingClient(client, api_prefix, trip.id, trip_owner)
    member_tracking = TrackingClient(client, api_prefix, trip.id, member)

    session_id = uuid.uuid4()
    owner_tracking.put_session(session_id, started_at=START)

    assert (
        member_tracking.upload(
            session_id,
            [_sample(offset_seconds=60)],
        ).status_code
        == 403
    )

    # Lifecycle is separate: a non-recorder may still end the session.
    assert (
        member_tracking.end_session(
            session_id,
            ended_at=START + timedelta(hours=1),
        ).status_code
        == 200
    )
    # And the original recorder can still upload after that correction.
    assert (
        owner_tracking.upload(
            session_id,
            [_sample(offset_seconds=60)],
        ).json()['accepted_samples']
        == 1
    )


@pytest.mark.integration
def test_a_removed_member_loses_upload_access_but_keeps_their_points(
    client,
    db_session,
    api_prefix,
    trip,
    trip_owner,
) -> None:
    member = create_user(db_session, password='TrackPass123!')
    add_trip_member(
        db_session, trip_id=trip.id, user_id=member.id, role=TripRole.MEMBER
    )
    member_tracking = TrackingClient(client, api_prefix, trip.id, member)

    session_id = uuid.uuid4()
    member_tracking.put_session(session_id, started_at=START)
    member_tracking.upload(session_id, [_sample(offset_seconds=60)])

    membership = db_session.execute(
        select(TripMember).where(
            TripMember.trip_id == trip.id,
            TripMember.user_id == member.id,
        )
    ).scalar_one()
    db_session.delete(membership)
    db_session.commit()

    # The trip is public, so the removed member can still read it and gets a
    # 403 rather than the 404 used to conceal a trip they cannot see at all.
    assert (
        member_tracking.upload(
            session_id,
            [_sample(offset_seconds=120)],
        ).status_code
        == 403
    )

    owner_tracking = TrackingClient(client, api_prefix, trip.id, trip_owner)
    remaining = owner_tracking.raw_samples(session_id).json()['items']
    assert len(remaining) == 1
    assert (
        owner_tracking.delete_samples([remaining[0]['id']]).json()['deleted_count'] == 1
    )


@pytest.mark.integration
def test_viewers_cannot_reach_raw_tracking_endpoints(
    client,
    db_session,
    api_prefix,
    trip,
    trip_owner,
) -> None:
    viewer = create_user(db_session, password='TrackPass123!')
    add_trip_viewer(
        db_session,
        trip_id=trip.id,
        user_id=viewer.id,
        created_by=trip_owner.id,
    )

    viewer_tracking = TrackingClient(client, api_prefix, trip.id, viewer)
    assert viewer_tracking.sessions().status_code == 403
    assert viewer_tracking.settings().status_code == 403


@pytest.mark.integration
def test_only_an_owner_may_change_live_sharing(
    client,
    db_session,
    api_prefix,
    trip,
    trip_owner,
) -> None:
    member = create_user(db_session, password='TrackPass123!')
    add_trip_member(
        db_session, trip_id=trip.id, user_id=member.id, role=TripRole.MEMBER
    )

    member_tracking = TrackingClient(client, api_prefix, trip.id, member)
    assert member_tracking.settings().json() == {'share_live_location': False}
    assert member_tracking.set_live_sharing(True).status_code == 403

    owner_tracking = TrackingClient(client, api_prefix, trip.id, trip_owner)
    assert owner_tracking.set_live_sharing(True).status_code == 200
    assert member_tracking.settings().json() == {'share_live_location': True}


# ---------------------------------------------------------------------------
# Bulk operations
# ---------------------------------------------------------------------------
@pytest.mark.integration
def test_mode_edits_and_deletions_reject_ids_from_another_trip(
    client,
    db_session,
    api_prefix,
    trip,
    trip_owner,
    tracking,
) -> None:
    other_trip = create_trip(db_session, owner_id=trip_owner.id)
    other_tracking = TrackingClient(client, api_prefix, other_trip.id, trip_owner)

    session_id = uuid.uuid4()
    other_session_id = uuid.uuid4()
    tracking.put_session(session_id, started_at=START)
    other_tracking.put_session(other_session_id, started_at=START)

    mine = _sample(offset_seconds=60)
    theirs = _sample(offset_seconds=60)
    tracking.upload(session_id, [mine])
    other_tracking.upload(other_session_id, [theirs])

    assert tracking.set_modes([theirs['id']], 'TRAIN').status_code == 404
    assert tracking.set_modes([mine['id'], theirs['id']], 'TRAIN').status_code == 404
    assert tracking.delete_samples([theirs['id']]).status_code == 404
    # An id that never existed is indistinguishable from another trip's.
    assert tracking.set_modes([str(uuid.uuid4())], 'TRAIN').status_code == 404

    # Nothing partial happened.
    stored = tracking.raw_samples(session_id).json()['items']
    assert stored[0]['travel_mode'] == 'UNKNOWN'


@pytest.mark.integration
def test_mode_edits_survive_a_re_upload(tracking) -> None:
    session_id = uuid.uuid4()
    tracking.put_session(session_id, started_at=START)
    sample = _sample(offset_seconds=60, travel_mode='WALK')
    tracking.upload(session_id, [sample])

    assert (
        tracking.set_modes(
            [sample['id']],
            'MOTORCYCLE',
        ).json()['updated_count']
        == 1
    )

    tracking.upload(session_id, [sample])
    stored = tracking.raw_samples(session_id).json()['items']
    assert stored[0]['travel_mode'] == 'MOTORCYCLE'


@pytest.mark.integration
def test_bulk_endpoints_reject_repeated_ids(tracking) -> None:
    sample_id = str(uuid.uuid4())
    assert tracking.set_modes([sample_id, sample_id], 'TRAIN').status_code == 422
    assert tracking.delete_samples([sample_id, sample_id]).status_code == 422
    assert tracking.set_modes([], 'TRAIN').status_code == 422


@pytest.mark.integration
def test_deleted_points_leave_no_receipt(tracking) -> None:
    session_id = uuid.uuid4()
    tracking.put_session(session_id, started_at=START)
    sample = _sample(offset_seconds=60)
    tracking.upload(session_id, [sample])

    assert tracking.delete_samples([sample['id']]).json()['deleted_count'] == 1
    assert tracking.raw_samples(session_id).json()['items'] == []

    # A stale retry recreates it: individual deletion keeps no tombstone.
    assert tracking.upload(session_id, [sample]).json()['accepted_samples'] == 1


# ---------------------------------------------------------------------------
# Raw reads
# ---------------------------------------------------------------------------
@pytest.mark.integration
def test_raw_samples_paginate_by_keyset(tracking) -> None:
    session_id = uuid.uuid4()
    tracking.put_session(session_id, started_at=START)
    tracking.upload(
        session_id,
        [_sample(offset_seconds=index * 30) for index in range(5)],
    )

    first = tracking.raw_samples(session_id, limit=2).json()
    assert len(first['items']) == 2
    assert first['next_cursor'] is not None

    second = tracking.raw_samples(
        session_id,
        limit=2,
        cursor=first['next_cursor'],
    ).json()
    assert len(second['items']) == 2

    last = tracking.raw_samples(
        session_id,
        limit=2,
        cursor=second['next_cursor'],
    ).json()
    assert len(last['items']) == 1
    assert last['next_cursor'] is None

    seen = [point['id'] for page in (first, second, last) for point in page['items']]
    assert len(set(seen)) == 5


@pytest.mark.integration
def test_a_malformed_cursor_is_unprocessable(tracking) -> None:
    session_id = uuid.uuid4()
    tracking.put_session(session_id, started_at=START)
    assert (
        tracking.raw_samples(
            session_id,
            cursor='not-a-cursor',
        ).status_code
        == 422
    )


@pytest.mark.integration
def test_session_list_counts_only_retained_points(
    tracking,
    client,
    api_prefix,
    trip_owner,
) -> None:
    _create_zone(client, api_prefix, trip_owner, latitude=51.4416, longitude=5.4697)
    session_id = uuid.uuid4()
    tracking.put_session(session_id, started_at=START)
    tracking.upload(
        session_id,
        [
            _sample(offset_seconds=60),
            _sample(offset_seconds=120, latitude=51.4416, longitude=5.4697),
        ],
    )

    sessions = tracking.sessions().json()['sessions']
    assert len(sessions) == 1
    assert sessions[0]['sample_count'] == 1
    assert sessions[0]['recorded_by_user_id'] == str(trip_owner.id)
