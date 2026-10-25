"""Pure spherical interpolation shared by live display and final recording."""

import math
from dataclasses import dataclass
from datetime import datetime


def arc_point(start, end, fraction):
    def vector(point):
        lon, lat = map(math.radians, point)
        return (
            math.cos(lat) * math.cos(lon),
            math.cos(lat) * math.sin(lon),
            math.sin(lat),
        )

    a, b = vector(start), vector(end)
    angle = math.acos(max(-1, min(1, sum(x * y for x, y in zip(a, b)))))
    if angle < 1e-9:
        return tuple(start)
    # A stable orthogonal great circle also handles exactly antipodal airports.
    tangent = tuple(y - math.cos(angle) * x for x, y in zip(a, b))
    norm = math.sqrt(sum(v * v for v in tangent))
    if norm < 1e-9:
        axis = (0, 0, 1) if abs(a[2]) < 0.9 else (1, 0, 0)
        tangent = (
            a[1] * axis[2] - a[2] * axis[1],
            a[2] * axis[0] - a[0] * axis[2],
            a[0] * axis[1] - a[1] * axis[0],
        )
        norm = math.sqrt(sum(v * v for v in tangent))
    v = [
        math.cos(angle * fraction) * x + math.sin(angle * fraction) * t / norm
        for x, t in zip(a, tangent)
    ]
    return (
        math.degrees(math.atan2(v[1], v[0])),
        math.degrees(math.atan2(v[2], math.hypot(v[0], v[1]))),
    )


def arc(start, end, begin=0.0, finish=1.0, count=65):
    return [
        arc_point(start, end, begin + (finish - begin) * i / (count - 1))
        for i in range(count)
    ]


@dataclass(frozen=True)
class FlightEstimate:
    progress: float
    position_at: datetime
    arrival_at: datetime
    basis: str


def estimate(flight, now):
    session = flight.session
    if (
        session is None
        or session.deleted_at
        or session.ended_at
        or flight.stop_reason
        or flight.completion_source
        or flight.arrival_airport is None
    ):
        return None
    end = flight.actual_arrival or flight.estimated_arrival
    basis = 'PROVIDER_TIMES'
    if end is None and flight.scheduled_arrival:
        end = session.started_at + (
            flight.scheduled_arrival - flight.scheduled_departure
        )
        basis = 'SCHEDULED_DURATION'
    if end is None or end <= session.started_at:
        return None
    fraction = max(
        0.0, min(0.99, (now - session.started_at) / (end - session.started_at))
    )
    return FlightEstimate(fraction, min(now, end), end, basis)
