"""Per-session derived GPS sets, computed once on write instead of per read.

Three properties of a retained point are pure functions of its own recording
session: whether it represents a long stay, whether it is an editorial post
candidate, and whether it survives onto the drawn display track. Deriving them
on every read meant re-scanning every raw point of a trip for every request,
which grows without bound as a trip gets longer. They are stored on the sample
row instead, and this module is the single place that decides them.

The store guarantees ``long stay`` and ``post candidate`` both imply ``display
retained``: a marker must never sit somewhere the drawn line does not go, so
both are fed to compaction and simplification as required points.
"""

from __future__ import annotations

import uuid
from bisect import bisect_left
from dataclasses import dataclass
from datetime import datetime
from math import asin, cos, radians, sin, sqrt

from services.gps.stationary_compaction import (
    TimedGpsCoordinate,
    compact_stationary_indices,
    long_stay_representative_indices,
)
from services.gps.geometry import simplify_line_indices

# Speed is measured across a small trailing window rather than taken from the
# client, so a single noisy fix cannot turn a walk into a flight.
POST_CANDIDATE_SPEED_WINDOW_SECONDS = 5 * 60
POST_CANDIDATE_MIN_SPEED_WINDOW_SECONDS = 2 * 60
POST_CANDIDATE_WALK_MAX_MPS = 2.5  # 9 km/h
POST_CANDIDATE_LOCAL_MAX_MPS = 12.5  # 45 km/h
POST_CANDIDATE_ROAD_MAX_MPS = 50.0  # 180 km/h
POST_CANDIDATE_WALK_DISTANCE_METERS = 1_000
POST_CANDIDATE_LOCAL_DISTANCE_METERS = 5_000
POST_CANDIDATE_LOCAL_ELAPSED_SECONDS = 20 * 60
POST_CANDIDATE_ROAD_DISTANCE_METERS = 75_000
POST_CANDIDATE_ROAD_ELAPSED_SECONDS = 45 * 60
POST_CANDIDATE_HIGH_SPEED_MIN_DISTANCE_METERS = 100_000
POST_CANDIDATE_HIGH_SPEED_MIN_ELAPSED_SECONDS = 15 * 60
POST_CANDIDATE_HIGH_SPEED_MIN_SAMPLES = 2

EARTH_RADIUS_METERS = 6_371_000


@dataclass(frozen=True, slots=True)
class SessionTrackPoint:
    """One retained point of a single session, in chronological order."""

    id: uuid.UUID
    recorded_at: datetime
    latitude: float
    longitude: float
    accuracy_meters: float | None
    speed_mps: float | None
    travel_mode: str


@dataclass(frozen=True, slots=True)
class DerivedSessionTrack:
    """The three derived sets for one session, as sample ids."""

    long_stay_ids: set[uuid.UUID]
    post_candidate_ids: set[uuid.UUID]
    display_retained_ids: set[uuid.UUID]

    @classmethod
    def empty(cls) -> 'DerivedSessionTrack':
        return cls(
            long_stay_ids=set(),
            post_candidate_ids=set(),
            display_retained_ids=set(),
        )


def derive_session_track(
    points: list[SessionTrackPoint],
    *,
    is_closed: bool,
) -> DerivedSessionTrack:
    """Derive every stored flag for one session's chronological points.

    Args:
        points: The session's retained points, ordered by ``recorded_at``.
        is_closed: Whether the session has ended. An open session has no
            settled final point and no stable midpoint for a journey still
            under way, so the two differ in which points they promote.

    Returns:
        The long-stay, post-candidate, and display-retained id sets.
    """
    if not points:
        return DerivedSessionTrack.empty()

    coordinates = [
        TimedGpsCoordinate(
            recorded_at=point.recorded_at,
            latitude=point.latitude,
            longitude=point.longitude,
            accuracy_meters=point.accuracy_meters,
            speed_mps=point.speed_mps,
        )
        for point in points
    ]
    long_stay_indices = set(long_stay_representative_indices(coordinates))
    candidate_indices = _post_candidate_indices(points, is_closed=is_closed)
    # Long stays are candidates in their own right; the read path only has to
    # thin the union down to what the map can show.
    candidate_indices |= long_stay_indices
    display_indices = _display_retained_indices(
        points,
        coordinates,
        required_indices=candidate_indices,
    )

    return DerivedSessionTrack(
        long_stay_ids={points[index].id for index in long_stay_indices},
        post_candidate_ids={points[index].id for index in candidate_indices},
        display_retained_ids={points[index].id for index in display_indices},
    )


# ---------------------------------------------------------------------------
# Post candidates
# ---------------------------------------------------------------------------
def _post_candidate_indices(
    points: list[SessionTrackPoint],
    *,
    is_closed: bool,
) -> set[int]:
    """Select sparse editorial prompts from coordinate-derived movement speed."""
    times = [point.recorded_at.timestamp() for point in points]
    latitudes = [point.latitude for point in points]
    longitudes = [point.longitude for point in points]

    speeds = _trailing_window_speeds(times, latitudes, longitudes)
    cumulative = _cumulative_distances(latitudes, longitudes)
    runs = _high_speed_runs(times, cumulative, speeds)

    selected = {0}
    in_high_speed_run = [False] * len(points)
    for start, end in runs:
        for index in range(start, end + 1):
            in_high_speed_run[index] = True

    last_regular = 0
    for index in range(1, len(points)):
        if in_high_speed_run[index]:
            continue
        if _meets_candidate_spacing(
            speed_mps=speeds[index],
            elapsed_seconds=times[index] - times[last_regular],
            distance_meters=_distance_meters(
                latitudes[last_regular],
                longitudes[last_regular],
                latitudes[index],
                longitudes[index],
            ),
        ):
            selected.add(index)
            last_regular = index

    for start, end in runs:
        if not is_closed and end == len(points) - 1:
            # A live high-speed journey has no stable midpoint yet. Its current
            # endpoint is the useful "post along the way" prompt.
            selected.add(end)
        else:
            selected.add(_high_speed_run_midpoint(cumulative, start, end))

    if is_closed:
        selected.add(len(points) - 1)
    return selected


def _trailing_window_speeds(
    times: list[float],
    latitudes: list[float],
    longitudes: list[float],
) -> list[float]:
    """Return each point's ground speed over a bounded trailing window.

    Recording timestamps are non-decreasing, so the window's lower bound only
    ever moves forward. Carrying it between iterations keeps this linear in the
    number of points rather than re-walking the window for each one, which is
    what made this the dominant cost of the old per-request derivation.
    """
    speeds = [0.0] * len(times)
    lower = 0
    for index in range(1, len(times)):
        threshold = times[index] - POST_CANDIDATE_SPEED_WINDOW_SECONDS
        while lower < index and times[lower] < threshold:
            lower += 1
        # The window always spans at least one edge, even when consecutive
        # fixes are further apart than the window itself.
        start = min(lower, index - 1)

        elapsed_seconds = times[index] - times[start]
        if elapsed_seconds < POST_CANDIDATE_MIN_SPEED_WINDOW_SECONDS:
            continue
        speeds[index] = (
            _distance_meters(
                latitudes[start],
                longitudes[start],
                latitudes[index],
                longitudes[index],
            )
            / elapsed_seconds
        )
    return speeds


def _cumulative_distances(
    latitudes: list[float],
    longitudes: list[float],
) -> list[float]:
    """Return travelled distance from the first point to each later one."""
    cumulative = [0.0] * len(latitudes)
    total = 0.0
    for index in range(1, len(latitudes)):
        total += _distance_meters(
            latitudes[index - 1],
            longitudes[index - 1],
            latitudes[index],
            longitudes[index],
        )
        cumulative[index] = total
    return cumulative


def _high_speed_runs(
    times: list[float],
    cumulative: list[float],
    speeds: list[float],
) -> list[tuple[int, int]]:
    """Return sustained high-speed ranges, as inclusive index pairs."""
    runs: list[tuple[int, int]] = []
    run_start: int | None = None

    for index in range(1, len(times)):
        is_high_speed = speeds[index] > POST_CANDIDATE_ROAD_MAX_MPS
        if is_high_speed and run_start is None:
            run_start = index
        elif not is_high_speed and run_start is not None:
            _append_high_speed_run(runs, times, cumulative, run_start, index - 1)
            run_start = None

    if run_start is not None:
        _append_high_speed_run(runs, times, cumulative, run_start, len(times) - 1)
    return runs


def _append_high_speed_run(
    runs: list[tuple[int, int]],
    times: list[float],
    cumulative: list[float],
    first_high_speed_index: int,
    last_high_speed_index: int,
) -> None:
    # The inferred speed at index N describes travel from N - 1 to N, so
    # include that preceding fix in the semantic journey run.
    start = first_high_speed_index - 1
    end = last_high_speed_index
    high_speed_samples = last_high_speed_index - first_high_speed_index + 1
    if (
        high_speed_samples >= POST_CANDIDATE_HIGH_SPEED_MIN_SAMPLES
        and times[end] - times[start] >= POST_CANDIDATE_HIGH_SPEED_MIN_ELAPSED_SECONDS
        and cumulative[end] - cumulative[start]
        >= POST_CANDIDATE_HIGH_SPEED_MIN_DISTANCE_METERS
    ):
        runs.append((start, end))


def _high_speed_run_midpoint(
    cumulative: list[float],
    start: int,
    end: int,
) -> int:
    """Return the run's halfway point by distance travelled.

    Candidates must be existing retained points. When the exact midpoint falls
    between fixes, this takes the first one past halfway; that reads more
    naturally as an along-the-way point than the last fix before it, and
    converges on the exact midpoint at normal recording cadence.
    """
    target = cumulative[start] + (cumulative[end] - cumulative[start]) / 2
    return bisect_left(cumulative, target, start, end + 1)


def _meets_candidate_spacing(
    *,
    speed_mps: float,
    elapsed_seconds: float,
    distance_meters: float,
) -> bool:
    if speed_mps <= POST_CANDIDATE_WALK_MAX_MPS:
        return distance_meters >= POST_CANDIDATE_WALK_DISTANCE_METERS
    if speed_mps <= POST_CANDIDATE_LOCAL_MAX_MPS:
        return (
            elapsed_seconds >= POST_CANDIDATE_LOCAL_ELAPSED_SECONDS
            and distance_meters >= POST_CANDIDATE_LOCAL_DISTANCE_METERS
        )
    if speed_mps <= POST_CANDIDATE_ROAD_MAX_MPS:
        return (
            elapsed_seconds >= POST_CANDIDATE_ROAD_ELAPSED_SECONDS
            and distance_meters >= POST_CANDIDATE_ROAD_DISTANCE_METERS
        )
    return False


# ---------------------------------------------------------------------------
# Display track
# ---------------------------------------------------------------------------
def _display_retained_indices(
    points: list[SessionTrackPoint],
    coordinates: list[TimedGpsCoordinate],
    *,
    required_indices: set[int],
) -> set[int]:
    """Return the points that survive onto the drawn track.

    Compaction and simplification both apply per travel-mode run, because that
    is exactly where the timeline splits one drawn segment from the next. The
    read path re-simplifies with post anchors added, which can only introduce
    further split points and therefore only ever keeps more.
    """
    retained: set[int] = set()
    for start, end in _travel_mode_runs(points):
        run = list(range(start, end))
        run_required = {index for index in run if index in required_indices}

        compacted = [
            run[offset]
            for offset in compact_stationary_indices(coordinates[start:end])
        ]
        compacted = sorted(set(compacted) | run_required)
        if len(compacted) <= 2:
            retained.update(compacted)
            continue

        simplified_required = {
            offset
            for offset, index in enumerate(compacted)
            if index in run_required
        }
        retained.update(
            compacted[offset]
            for offset in simplify_line_indices(
                [
                    (points[index].longitude, points[index].latitude)
                    for index in compacted
                ],
                required_indices=simplified_required,
            )
        )
    return retained


def _travel_mode_runs(points: list[SessionTrackPoint]) -> list[tuple[int, int]]:
    """Return half-open index ranges of consecutive equal travel modes."""
    runs: list[tuple[int, int]] = []
    start = 0
    for index in range(1, len(points)):
        if points[index].travel_mode != points[index - 1].travel_mode:
            runs.append((start, index))
            start = index
    runs.append((start, len(points)))
    return runs


def _distance_meters(
    latitude_a: float,
    longitude_a: float,
    latitude_b: float,
    longitude_b: float,
) -> float:
    latitude_delta = radians(latitude_b - latitude_a)
    longitude_delta = radians(longitude_b - longitude_a)
    a = (
        sin(latitude_delta / 2) ** 2
        + cos(radians(latitude_a))
        * cos(radians(latitude_b))
        * sin(longitude_delta / 2) ** 2
    )
    return EARTH_RADIUS_METERS * 2 * asin(sqrt(a))
