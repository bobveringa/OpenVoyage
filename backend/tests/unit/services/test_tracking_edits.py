from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import Mock
import uuid

import pytest

from models.api.tracking import (
    TrackSessionPointsReplaceRequest,
    TrackingSessionEndRequest,
)
from models.database.gps_tracking import GpsTrackSample
from models.database.travel import TravelMode
from models.database.user import UserRole
from services.gps.edit_geometry import distance, insertion_area, move_area_radius
from services.gps.tracking_service import (
    GpsTrackingService,
    TrackingPermissionError,
    TrackingSessionConflictError,
    TrackingValidationError,
)

pytestmark = pytest.mark.unit


def point(latitude=0, longitude=0, seconds=0):
    return GpsTrackSample(
        id=uuid.uuid4(),
        latitude=latitude,
        longitude=longitude,
        recorded_at=datetime(2026, 1, 1, tzinfo=timezone.utc)
        + timedelta(seconds=seconds),
        travel_mode=TravelMode.WALK,
    )


@pytest.fixture
def editor():
    db = Mock()
    zones = Mock()
    zones.is_within_any_zone.return_value = False
    service = GpsTrackingService(db, zones)
    service._require_trip_permission = Mock()
    service._lock_trip = Mock()
    service._get_session = Mock()
    service._refresh_session_derived_track = Mock()
    return service


def apply(service, rows, points):
    service.db.scalars.return_value = rows
    service.replace_session_points(
        trip_id=uuid.uuid4(),
        session_id=uuid.uuid4(),
        current_user_id=uuid.uuid4(),
        payload=TrackSessionPointsReplaceRequest(points=list(points)),
    )


def replacement(p, **changes):
    return (
        dict(
            id=p.id,
            latitude=p.latitude,
            longitude=p.longitude,
            travel_mode=p.travel_mode,
        )
        | changes
    )


@pytest.mark.parametrize(
    'meters,accepted', [(499.9, True), (500, True), (500.1, False)]
)
def test_move_limit_enforced_server_side(editor, meters, accepted):
    p = point()
    change = replacement(p, latitude=meters / distance((0, 0), (1, 0)))
    if accepted:
        apply(editor, [p], [change])
        editor.db.commit.assert_called_once()
    else:
        with pytest.raises(TrackingValidationError, match='movement area'):
            apply(editor, [p], [change])
        editor.db.commit.assert_not_called()
        assert p.latitude == 0


def test_foreign_point_and_reordering_rejected(editor):
    first, second = point(), point(seconds=1)
    with pytest.raises(TrackingSessionConflictError, match='another session'):
        apply(editor, [], [replacement(first)])
    with pytest.raises(TrackingValidationError, match='recorded order'):
        apply(editor, [first, second], [replacement(second), replacement(first)])


def test_connection_areas_scale_without_caps_and_handle_antimeridian():
    center, radius = insertion_area((0, 0), (0, 0.004))
    assert radius == 500
    assert distance(center, (0, 0.002)) < 0.01
    assert insertion_area((0, 0), (0, 1))[1] == pytest.approx(111_194.93, abs=0.01)
    assert move_area_radius((0, 0), [(0, 0.01)]) == pytest.approx(
        1_667.92, abs=0.01
    )
    assert distance(insertion_area((0, 179.9), (0, -179.9))[0], (0, 180)) < 0.01


@pytest.mark.parametrize('latitude,accepted', [(0.003, True), (0.01, False)])
def test_insert_circle_and_interpolated_time(editor, latitude, accepted):
    a, b = point(), point(longitude=0.004, seconds=60)
    insert = dict(
        latitude=latitude,
        longitude=0.002,
        travel_mode='WALK',
    )
    if accepted:
        apply(editor, [a, b], [replacement(a), insert, replacement(b)])
        added = editor.db.add_all.call_args.args[0][0]
        assert added.recorded_at == a.recorded_at + timedelta(seconds=30)
        editor._refresh_session_derived_track.assert_called_once()
    else:
        with pytest.raises(TrackingValidationError, match='outside'):
            apply(editor, [a, b], [replacement(a), insert, replacement(b)])
        editor.db.commit.assert_not_called()


def test_insert_requires_existing_points_on_both_sides(editor):
    existing = point()
    insert = dict(latitude=0, longitude=0, travel_mode='WALK')
    with pytest.raises(TrackingSessionConflictError, match='between'):
        apply(editor, [existing], [insert, replacement(existing)])


def test_ordered_replacement_deletes_omitted_points(editor):
    first, deleted, last = point(), point(seconds=30), point(seconds=60)

    apply(editor, [first, deleted, last], [replacement(first), replacement(last)])

    editor.db.delete.assert_called_once_with(deleted)


def test_multiple_insertions_get_ordered_interpolated_times(editor):
    first, last = point(), point(seconds=60)
    inserted = dict(latitude=0, longitude=0, travel_mode='WALK')

    apply(
        editor,
        [first, last],
        [replacement(first), inserted, inserted, replacement(last)],
    )

    additions = editor.db.add_all.call_args.args[0]
    assert [addition.recorded_at for addition in additions] == [
        first.recorded_at + timedelta(seconds=20),
        first.recorded_at + timedelta(seconds=40),
    ]


def test_privacy_zone_rejected(editor):
    editor.privacy_zones.is_within_any_zone.return_value = True
    p = point()
    with pytest.raises(TrackingValidationError, match='privacy'):
        apply(editor, [p], [replacement(p, latitude=0.001)])


@pytest.mark.parametrize(
    'role,owns,allowed',
    [
        (UserRole.USER, True, True),
        (UserRole.USER, False, False),
        (UserRole.ADMIN, False, True),
    ],
)
def test_stop_permissions(role, owns, allowed):
    user_id = uuid.uuid4()
    db = Mock()
    db.get.return_value = SimpleNamespace(role=role)
    service = GpsTrackingService(db, Mock())
    session = SimpleNamespace(recorded_by_user_id=user_id if owns else uuid.uuid4())
    if allowed:
        service._require_session_controller(session, user_id)
    else:
        with pytest.raises(TrackingPermissionError):
            service._require_session_controller(session, user_id)


def test_offline_end_retry_cannot_extend_remote_stop(editor):
    user_id, trip_id = uuid.uuid4(), uuid.uuid4()
    end = datetime(2026, 1, 1, tzinfo=timezone.utc)
    session = SimpleNamespace(trip_id=trip_id, ended_at=end)
    editor.db.get.side_effect = [SimpleNamespace(role=UserRole.USER), session]
    editor._require_session_controller = Mock()
    editor._count_samples = Mock(return_value=4)
    result = editor.end_session(
        trip_id=trip_id,
        session_id=uuid.uuid4(),
        current_user_id=user_id,
        payload=TrackingSessionEndRequest(ended_at=end + timedelta(hours=1)),
    )
    assert result.session.ended_at == end
    editor._require_session_controller.assert_called_once_with(session, user_id)
    editor.db.commit.assert_not_called()
