from datetime import datetime, timedelta, timezone

import pytest

from services.gps.stationary_compaction import (
    MAX_STOP_RADIUS_METERS,
    MIN_STOP_RADIUS_METERS,
    POST_CANDIDATE_STAY_DWELL_SECONDS,
    STOP_DWELL_SECONDS,
    TimedGpsCoordinate,
    compact_stationary_indices,
    long_stay_representative_indices,
)

START = datetime(2026, 8, 20, tzinfo=timezone.utc)
METERS_PER_LATITUDE_DEGREE = 111_195.0


def sample(
    offset_seconds: int,
    north_meters: float = 0.0,
    *,
    accuracy_meters: float | None = 5.0,
    longitude: float = 5.5,
    speed_mps: float | None = None,
) -> TimedGpsCoordinate:
    return TimedGpsCoordinate(
        recorded_at=START + timedelta(seconds=offset_seconds),
        latitude=51.5 + north_meters / METERS_PER_LATITUDE_DEGREE,
        longitude=longitude,
        accuracy_meters=accuracy_meters,
        speed_mps=speed_mps,
    )


@pytest.mark.unit
def test_empty_and_one_sample_inputs_are_safe() -> None:
    assert compact_stationary_indices([]) == []
    assert compact_stationary_indices([sample(0)]) == [0]


@pytest.mark.unit
def test_compacts_a_parked_trace_at_the_dwell_boundary() -> None:
    samples = [
        sample(0, accuracy_meters=5),
        sample(30, 8, accuracy_meters=10),
        sample(STOP_DWELL_SECONDS, -10, accuracy_meters=20),
    ]

    assert compact_stationary_indices(samples) == [0]


@pytest.mark.unit
def test_does_not_compact_a_stop_shorter_than_the_dwell() -> None:
    samples = [sample(0), sample(STOP_DWELL_SECONDS - 1, 8)]

    assert compact_stationary_indices(samples) == [0, 1]


@pytest.mark.unit
def test_tolerates_stationary_speed_noise_below_the_movement_threshold() -> None:
    samples = [
        sample(0, speed_mps=0.88),
        sample(30, 8, speed_mps=0.68),
        sample(90, -10, speed_mps=0.57),
    ]

    assert compact_stationary_indices(samples) == [0]


@pytest.mark.unit
def test_selects_the_best_observed_accuracy_as_the_representative() -> None:
    samples = [
        sample(0, accuracy_meters=None),
        sample(30, 8, accuracy_meters=6),
        sample(90, -10, accuracy_meters=10),
    ]

    assert compact_stationary_indices(samples) == [1]


@pytest.mark.unit
def test_equal_accuracy_keeps_the_earliest_representative() -> None:
    samples = [sample(0, accuracy_meters=5), sample(90, 8, accuracy_meters=5)]

    assert compact_stationary_indices(samples) == [0]


@pytest.mark.unit
def test_accuracy_expands_the_radius_but_never_past_its_cap() -> None:
    within_capped_radius = [
        sample(0, accuracy_meters=100),
        sample(90, 90, accuracy_meters=100),
    ]
    beyond_capped_radius = [
        sample(0, accuracy_meters=1_000),
        sample(90, MAX_STOP_RADIUS_METERS + 1, accuracy_meters=1_000),
    ]

    assert compact_stationary_indices(within_capped_radius) == [0]
    assert compact_stationary_indices(beyond_capped_radius) == [0, 1]


@pytest.mark.unit
def test_unknown_accuracy_uses_the_minimum_radius() -> None:
    samples = [
        sample(0, accuracy_meters=None),
        sample(90, MIN_STOP_RADIUS_METERS + 1, accuracy_meters=None),
    ]

    assert compact_stationary_indices(samples) == [0, 1]


@pytest.mark.unit
def test_drops_one_outside_outlier_that_returns_to_the_stop() -> None:
    samples = [sample(0), sample(90, 5), sample(120, 60), sample(150, 3)]

    assert compact_stationary_indices(samples) == [0]


@pytest.mark.unit
def test_two_outside_fixes_confirm_departure() -> None:
    samples = [sample(0), sample(90, 5), sample(120, 60), sample(150, 90)]

    assert compact_stationary_indices(samples) == [0, 2, 3]


@pytest.mark.unit
def test_a_clearly_moving_speed_fix_confirms_departure_immediately() -> None:
    samples = [sample(0), sample(90, 5), sample(120, 5, speed_mps=2.1)]

    assert compact_stationary_indices(samples) == [0, 2]


@pytest.mark.unit
def test_unconfirmed_terminal_outlier_keeps_the_stable_endpoint() -> None:
    samples = [sample(0), sample(90, 5), sample(120, 60)]

    assert compact_stationary_indices(samples) == [0]


@pytest.mark.unit
def test_compacts_across_the_antimeridian_using_the_short_distance() -> None:
    samples = [
        TimedGpsCoordinate(START, 0.0, 179.9999, 5.0, None),
        TimedGpsCoordinate(
            START + timedelta(seconds=STOP_DWELL_SECONDS),
            0.0,
            -179.9999,
            5.0,
            None,
        ),
    ]

    assert compact_stationary_indices(samples) == [0]


@pytest.mark.unit
def test_output_indices_are_ordered_unique_and_from_the_input() -> None:
    samples = [
        sample(0),
        sample(90, 5),
        sample(120, 60),
        sample(150, 90),
        sample(180, 300),
    ]

    result = compact_stationary_indices(samples)

    assert result == sorted(set(result))
    assert all(0 <= index < len(samples) for index in result)


@pytest.mark.unit
def test_long_stay_uses_the_best_accuracy_representative() -> None:
    samples = [
        sample(0, accuracy_meters=25),
        sample(300, 8, accuracy_meters=5),
        sample(POST_CANDIDATE_STAY_DWELL_SECONDS, -8, accuracy_meters=10),
        sample(POST_CANDIDATE_STAY_DWELL_SECONDS + 60, 300),
    ]

    assert long_stay_representative_indices(samples) == [1]


@pytest.mark.unit
def test_short_stationary_run_is_not_a_post_candidate_stay() -> None:
    samples = [sample(0), sample(POST_CANDIDATE_STAY_DWELL_SECONDS - 1, 8)]

    assert long_stay_representative_indices(samples) == []
