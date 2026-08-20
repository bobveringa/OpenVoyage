"""Pure stationary-run compaction for display-only GPS geometry."""

from __future__ import annotations

from collections import deque
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import datetime

from services.gps.geometry import haversine_meters

STOP_DWELL_SECONDS = 90
MIN_STOP_RADIUS_METERS = 25.0
ACCURACY_RADIUS_FACTOR = 1.5
MAX_STOP_RADIUS_METERS = 100.0
CLEARLY_MOVING_MPS = 2.0
DEPARTURE_CONFIRMATION_FIXES = 2


@dataclass(frozen=True)
class TimedGpsCoordinate:
    """One chronological GPS coordinate eligible for display compaction."""

    recorded_at: datetime
    latitude: float
    longitude: float
    accuracy_meters: float | None
    speed_mps: float | None


def compact_stationary_indices(
    samples: Sequence[TimedGpsCoordinate],
) -> list[int]:
    """Return ordered input indices that retain useful display geometry.

    A spatially compatible run is held unchanged until it has lasted long
    enough to be a stop. Confirmed stops collapse to their best-accuracy input
    coordinate; a single outside fix is treated as drift until departure is
    confirmed by speed or a second outside fix.
    """
    if not samples:
        return []

    retained: list[int] = []
    remaining = deque(range(len(samples)))
    pending: list[int] = []
    pending_representative: int | None = None
    stationary_representative: int | None = None
    departure: list[int] = []

    while remaining:
        index = remaining.popleft()
        candidate = samples[index]

        if stationary_representative is None:
            if pending_representative is None:
                pending = [index]
                pending_representative = index
                continue

            representative = samples[pending_representative]
            if _is_compatible(representative, candidate):
                pending.append(index)
                if _has_better_accuracy(candidate, representative):
                    pending_representative = index

                first = samples[pending[0]]
                if (
                    candidate.recorded_at - first.recorded_at
                ).total_seconds() >= STOP_DWELL_SECONDS:
                    stationary_representative = pending_representative
                    pending = []
                    pending_representative = None
                continue

            retained.extend(pending)
            pending = [index]
            pending_representative = index
            continue

        representative = samples[stationary_representative]
        if _is_compatible(representative, candidate):
            departure = []
            if _has_better_accuracy(candidate, representative):
                stationary_representative = index
            continue

        departure.append(index)
        if (
            _is_clearly_moving(candidate)
            or len(departure) >= DEPARTURE_CONFIRMATION_FIXES
        ):
            retained.append(stationary_representative)
            stationary_representative = None
            pending = []
            pending_representative = None
            remaining.extendleft(reversed(departure))
            departure = []

    if stationary_representative is not None:
        retained.append(stationary_representative)
    else:
        retained.extend(pending)

    return retained


def _is_compatible(
    representative: TimedGpsCoordinate,
    candidate: TimedGpsCoordinate,
) -> bool:
    if _is_clearly_moving(candidate):
        return False
    return (
        haversine_meters(
            representative.latitude,
            representative.longitude,
            candidate.latitude,
            candidate.longitude,
        )
        <= _stop_radius_meters(representative, candidate)
    )


def _is_clearly_moving(sample: TimedGpsCoordinate) -> bool:
    return sample.speed_mps is not None and sample.speed_mps > CLEARLY_MOVING_MPS


def _stop_radius_meters(
    representative: TimedGpsCoordinate,
    candidate: TimedGpsCoordinate,
) -> float:
    known_accuracy = max(
        representative.accuracy_meters or 0.0,
        candidate.accuracy_meters or 0.0,
    )
    return min(
        max(
            known_accuracy * ACCURACY_RADIUS_FACTOR,
            MIN_STOP_RADIUS_METERS,
        ),
        MAX_STOP_RADIUS_METERS,
    )


def _has_better_accuracy(
    candidate: TimedGpsCoordinate,
    representative: TimedGpsCoordinate,
) -> bool:
    if candidate.accuracy_meters is None:
        return False
    if representative.accuracy_meters is None:
        return True
    return candidate.accuracy_meters < representative.accuracy_meters
