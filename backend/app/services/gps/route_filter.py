"""Conservative cleanup for the drawn GPS route.

The raw GPS samples remain stored. Only the drawn route is thinned, so a
future rendering change can recover detail without asking the device to
record the trip again.
"""

from __future__ import annotations

from collections.abc import Sequence

from services.gps.geometry import haversine_meters
from services.gps.stationary_compaction import TimedGpsCoordinate

MIN_DISPLAY_SPACING_METERS = 150.0
SPIKE_RETURN_RADIUS_METERS = 10_000.0
SPIKE_LEG_MIN_METERS = 500.0
SPIKE_SPEED_MPS = 200.0 / 3.6


def route_filter_indices(
    points: Sequence[TimedGpsCoordinate],
    *,
    required_indices: set[int],
) -> list[int]:
    """Keep endpoints, editorial anchors, and useful route shape points.

    A lone long detour that returns within the APK's 10 km three-point window
    at over 200 km/h is removed before applying its 150 m spacing. Required
    points remain so long stays and suggestions stay on the drawn route.
    """
    if len(points) <= 2:
        return list(range(len(points)))

    plausible = [0]
    for index in range(1, len(points) - 1):
        if index not in required_indices and _is_return_spike(
            points[plausible[-1]], points[index], points[index + 1]
        ):
            continue
        plausible.append(index)
    plausible.append(len(points) - 1)

    retained = [plausible[0]]
    for index in plausible[1:-1]:
        if (
            index in required_indices
            or _distance(points[retained[-1]], points[index])
            > MIN_DISPLAY_SPACING_METERS
        ):
            retained.append(index)
    retained.append(plausible[-1])
    return retained


def _is_return_spike(
    before: TimedGpsCoordinate,
    middle: TimedGpsCoordinate,
    after: TimedGpsCoordinate,
) -> bool:
    first_seconds = (middle.recorded_at - before.recorded_at).total_seconds()
    second_seconds = (after.recorded_at - middle.recorded_at).total_seconds()
    if first_seconds <= 0 or second_seconds <= 0:
        return False
    first_leg = _distance(before, middle)
    second_leg = _distance(middle, after)
    return (
        first_leg >= SPIKE_LEG_MIN_METERS
        and second_leg >= SPIKE_LEG_MIN_METERS
        and _distance(before, after) <= SPIKE_RETURN_RADIUS_METERS
        and (
            first_leg / first_seconds > SPIKE_SPEED_MPS
            or second_leg / second_seconds > SPIKE_SPEED_MPS
        )
    )


def _distance(a: TimedGpsCoordinate, b: TimedGpsCoordinate) -> float:
    return haversine_meters(a.latitude, a.longitude, b.latitude, b.longitude)
