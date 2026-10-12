"""Route display cleanup must not erase stops or plausible short journeys."""

from datetime import datetime, timedelta, timezone

from services.gps.route_filter import route_filter_indices
from services.gps.stationary_compaction import TimedGpsCoordinate


START = datetime(2026, 1, 1, tzinfo=timezone.utc)


def point(seconds: int, latitude: float) -> TimedGpsCoordinate:
    return TimedGpsCoordinate(
        recorded_at=START + timedelta(seconds=seconds),
        latitude=latitude,
        longitude=5.0,
        accuracy_meters=10.0,
        speed_mps=None,
    )


def test_thins_nearby_display_points_but_keeps_the_endpoint_and_stay() -> None:
    points = [point(0, 51.0), point(60, 51.0005), point(120, 51.0007)]
    assert route_filter_indices(points, required_indices=set()) == [0, 2]
    assert route_filter_indices(points, required_indices={1}) == [0, 1, 2]


def test_removes_a_fast_out_and_back_gps_spike() -> None:
    points = [point(0, 51.0), point(5, 51.02), point(10, 51.0001)]
    assert route_filter_indices(points, required_indices=set()) == [0, 2]


def test_preserves_a_plausible_out_and_back_walk() -> None:
    points = [point(0, 51.0), point(900, 51.005), point(1800, 51.0001)]
    assert route_filter_indices(points, required_indices=set()) == [0, 1, 2]
