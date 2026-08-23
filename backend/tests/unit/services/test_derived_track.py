import uuid
from datetime import datetime, timedelta, timezone

import pytest

from services.gps.derived_track import (
    POST_CANDIDATE_HIGH_SPEED_MIN_ELAPSED_SECONDS,
    POST_CANDIDATE_WALK_DISTANCE_METERS,
    SessionTrackPoint,
    derive_session_track,
)
from services.gps.stationary_compaction import POST_CANDIDATE_STAY_DWELL_SECONDS

START = datetime(2026, 8, 20, tzinfo=timezone.utc)
METERS_PER_LATITUDE_DEGREE = 111_195.0


def point(
    offset_seconds: float,
    north_meters: float = 0.0,
    *,
    accuracy_meters: float | None = 5.0,
    speed_mps: float | None = None,
    travel_mode: str = 'WALK',
) -> SessionTrackPoint:
    return SessionTrackPoint(
        id=uuid.uuid4(),
        recorded_at=START + timedelta(seconds=offset_seconds),
        latitude=51.5 + north_meters / METERS_PER_LATITUDE_DEGREE,
        longitude=5.5,
        accuracy_meters=accuracy_meters,
        speed_mps=speed_mps,
        travel_mode=travel_mode,
    )


def walk(count: int, *, step_seconds: int = 60, step_meters: float = 200.0):
    return [
        point(index * step_seconds, index * step_meters) for index in range(count)
    ]


@pytest.mark.unit
def test_an_empty_session_derives_nothing() -> None:
    derived = derive_session_track([], is_closed=True)

    assert derived.long_stay_ids == set()
    assert derived.post_candidate_ids == set()
    assert derived.display_retained_ids == set()


@pytest.mark.unit
def test_every_marker_is_also_on_the_display_track() -> None:
    """The invariant the read path depends on: a marker is never off the line."""
    points = walk(60)

    derived = derive_session_track(points, is_closed=True)

    assert derived.long_stay_ids <= derived.display_retained_ids
    assert derived.post_candidate_ids <= derived.display_retained_ids
    assert derived.long_stay_ids <= derived.post_candidate_ids


@pytest.mark.unit
def test_the_first_point_of_a_session_always_prompts_a_post() -> None:
    points = walk(10)

    derived = derive_session_track(points, is_closed=True)

    assert points[0].id in derived.post_candidate_ids


@pytest.mark.unit
def test_closing_a_session_promotes_its_final_point() -> None:
    points = walk(10)

    open_track = derive_session_track(points, is_closed=False)
    closed_track = derive_session_track(points, is_closed=True)

    assert points[-1].id not in open_track.post_candidate_ids
    assert points[-1].id in closed_track.post_candidate_ids


@pytest.mark.unit
def test_a_walk_prompts_a_post_once_it_has_covered_enough_ground() -> None:
    # Well under the walking speed band, so only distance decides.
    points = [
        point(0),
        point(600, POST_CANDIDATE_WALK_DISTANCE_METERS - 1),
        point(1200, POST_CANDIDATE_WALK_DISTANCE_METERS * 2),
    ]

    derived = derive_session_track(points, is_closed=False)

    assert points[1].id not in derived.post_candidate_ids
    assert points[2].id in derived.post_candidate_ids


@pytest.mark.unit
def test_a_long_stay_is_kept_as_a_marker_and_on_the_track() -> None:
    points = [
        point(0, accuracy_meters=20),
        point(300, 5, accuracy_meters=4),
        point(POST_CANDIDATE_STAY_DWELL_SECONDS + 60, -5, accuracy_meters=20),
        point(POST_CANDIDATE_STAY_DWELL_SECONDS + 120, 5_000),
    ]

    derived = derive_session_track(points, is_closed=True)

    # The best-accuracy fix of the stay represents it.
    assert derived.long_stay_ids == {points[1].id}
    assert points[1].id in derived.display_retained_ids


@pytest.mark.unit
def test_a_stationary_session_compacts_to_a_single_display_point() -> None:
    points = [point(0), point(90, 5), point(180, -5)]

    derived = derive_session_track(points, is_closed=False)

    assert derived.display_retained_ids == {points[0].id}


@pytest.mark.unit
def test_a_high_speed_journey_is_prompted_at_its_midpoint_once_finished() -> None:
    # 500 km covered in 100 minutes: comfortably past the road speed band.
    step_seconds = 600
    step_meters = 50_000.0
    points = [
        point(index * step_seconds, index * step_meters) for index in range(11)
    ]
    assert (
        points[-1].recorded_at - points[0].recorded_at
    ).total_seconds() >= POST_CANDIDATE_HIGH_SPEED_MIN_ELAPSED_SECONDS

    derived = derive_session_track(points, is_closed=True)

    # The run collapses to its halfway point rather than prompting all the way
    # along, and the live endpoint is not offered for a finished journey.
    midpoint_ids = {points[index].id for index in range(4, 8)}
    assert derived.post_candidate_ids & midpoint_ids


@pytest.mark.unit
def test_a_live_high_speed_journey_prompts_at_its_current_end() -> None:
    step_seconds = 600
    step_meters = 50_000.0
    points = [
        point(index * step_seconds, index * step_meters) for index in range(11)
    ]

    derived = derive_session_track(points, is_closed=False)

    assert points[-1].id in derived.post_candidate_ids


@pytest.mark.unit
def test_travel_mode_splits_the_track_into_separately_drawn_stretches() -> None:
    # A straight line, so simplification would drop every middle point were it
    # not for the mode change that ends one drawn stretch and starts the next.
    points = [
        point(index * 60, index * 500.0, travel_mode='WALK' if index < 5 else 'CAR')
        for index in range(10)
    ]

    derived = derive_session_track(points, is_closed=True)

    assert points[4].id in derived.display_retained_ids
    assert points[5].id in derived.display_retained_ids


@pytest.mark.unit
def test_derivation_does_not_depend_on_how_the_points_were_batched() -> None:
    """A session is always re-derived whole, so this must hold."""
    points = walk(40)

    whole = derive_session_track(points, is_closed=True)
    assert whole == derive_session_track(list(points), is_closed=True)
