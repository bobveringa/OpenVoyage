"""Pure geometry helpers for GPS tracking.

Kept free of database and session concerns so the distance, privacy-zone, and
simplification rules can be unit tested directly.
"""

from __future__ import annotations

import math

# WGS84 mean earth radius. Shared by the privacy-zone distance test and the
# equirectangular projection used for simplification, so a metre means the same
# thing in both.
EARTH_RADIUS_METERS = 6_371_008.8

# Metres per degree of latitude, derived from the same radius the distance test
# uses (about 111_195). It must not be the familiar 111_320 equatorial figure:
# that over-estimates the distance a degree covers, which shrinks the bounding
# box below the true reach of the radius and lets the prefilter reject points
# that are genuinely inside a zone. The prefilter is allowed to be generous,
# never tight.
METERS_PER_DEGREE_LATITUDE = EARTH_RADIUS_METERS * math.pi / 180.0

# Douglas-Peucker tolerance for public timeline geometry.
SIMPLIFY_TOLERANCE_METERS = 20.0

# Relative slack on the bounding box. Subtracting two nearby latitudes loses
# roughly twelve significant digits, so a point sitting exactly on the circle
# can compare a hair outside the box and be rejected before the distance test
# ever runs. Widening the box by a part in a billion cannot change any real
# outcome — Haversine still decides — but it removes the rounding hole.
_BOUNDING_BOX_SLACK = 1e-9


def normalize_longitude_delta(delta_degrees: float) -> float:
    """Return ``delta_degrees`` wrapped into ``[-180, 180]``.

    Without this a pair straddling the antimeridian looks 359.999 degrees apart
    and the bounding-box prefilter rejects it, which would silently retain a
    coordinate inside a privacy zone.
    """
    return (delta_degrees + 180.0) % 360.0 - 180.0


def haversine_meters(
    latitude_a: float,
    longitude_a: float,
    latitude_b: float,
    longitude_b: float,
) -> float:
    """Return the great-circle distance between two WGS84 coordinates."""
    lat_a = math.radians(latitude_a)
    lat_b = math.radians(latitude_b)
    delta_lat = lat_b - lat_a
    delta_lon = math.radians(normalize_longitude_delta(longitude_b - longitude_a))

    h = (
        math.sin(delta_lat / 2) ** 2
        + math.cos(lat_a) * math.cos(lat_b) * math.sin(delta_lon / 2) ** 2
    )
    return 2 * EARTH_RADIUS_METERS * math.asin(min(1.0, math.sqrt(h)))


def _within_bounding_box(
    latitude: float,
    longitude: float,
    center_latitude: float,
    center_longitude: float,
    radius_meters: float,
) -> bool:
    """Cheaply reject pairs that cannot be within ``radius_meters``.

    Conservative by construction: it only ever rejects pairs the Haversine test
    would also reject, so it is safe to run before the real distance check.
    """
    latitude_allowance = (
        radius_meters / METERS_PER_DEGREE_LATITUDE * (1.0 + _BOUNDING_BOX_SLACK)
    )
    if abs(latitude - center_latitude) > latitude_allowance:
        return False

    # Take the cosine at the highest latitude either point can occupy while
    # still being within the radius. Using the center's own latitude would
    # under-estimate the permitted longitude delta whenever the sample sits
    # closer to a pole, which can reject a point that is genuinely inside.
    bound_latitude = min(abs(center_latitude) + latitude_allowance, 90.0)
    cosine = math.cos(math.radians(bound_latitude))
    if cosine <= 0:
        # At the pole every longitude is within reach; let Haversine decide
        # rather than dividing by zero.
        return True

    longitude_allowance = (
        radius_meters
        / (METERS_PER_DEGREE_LATITUDE * cosine)
        * (1.0 + _BOUNDING_BOX_SLACK)
    )
    if longitude_allowance >= 180.0:
        return True

    delta_longitude = normalize_longitude_delta(longitude - center_longitude)
    return abs(delta_longitude) <= longitude_allowance


def is_within_radius(
    latitude: float,
    longitude: float,
    center_latitude: float,
    center_longitude: float,
    radius_meters: float,
) -> bool:
    """Return whether a coordinate falls inside a circular zone.

    A point exactly on the boundary counts as inside.
    """
    if not _within_bounding_box(
        latitude,
        longitude,
        center_latitude,
        center_longitude,
        radius_meters,
    ):
        return False

    distance = haversine_meters(
        latitude,
        longitude,
        center_latitude,
        center_longitude,
    )
    return distance <= radius_meters


def _project(
    coordinates: list[tuple[float, float]],
) -> list[tuple[float, float]]:
    """Project ``(longitude, latitude)`` degrees onto local metres.

    A local equirectangular projection about the mean latitude, so the
    simplification tolerance means the same distance at every latitude instead
    of being roughly 1.5x tighter east-west than north-south.
    """
    mean_latitude = sum(latitude for _, latitude in coordinates) / len(coordinates)
    scale = math.cos(math.radians(mean_latitude))
    return [
        (
            math.radians(longitude) * scale * EARTH_RADIUS_METERS,
            math.radians(latitude) * EARTH_RADIUS_METERS,
        )
        for longitude, latitude in coordinates
    ]


def _perpendicular_distance(
    point: tuple[float, float],
    start: tuple[float, float],
    end: tuple[float, float],
) -> float:
    px, py = point
    sx, sy = start
    ex, ey = end

    dx = ex - sx
    dy = ey - sy
    if dx == 0 and dy == 0:
        return math.hypot(px - sx, py - sy)

    return abs(dy * px - dx * py + ex * sy - ey * sx) / math.hypot(dx, dy)


def simplify_line(
    coordinates: list[tuple[float, float]],
    tolerance_meters: float = SIMPLIFY_TOLERANCE_METERS,
) -> list[tuple[float, float]]:
    """Douglas-Peucker over ``(longitude, latitude)`` pairs.

    Always keeps the first and last coordinate and never invents one, so post
    anchors, segment endpoints, and mode boundaries survive.
    """
    return [
        coordinates[index]
        for index in simplify_line_indices(coordinates, tolerance_meters)
    ]


def simplify_line_indices(
    coordinates: list[tuple[float, float]],
    tolerance_meters: float = SIMPLIFY_TOLERANCE_METERS,
    *,
    required_indices: set[int] | None = None,
) -> list[int]:
    """Return the input indices retained by Douglas-Peucker.

    ``required_indices`` supports semantically meaningful points, such as a
    long stay, that must remain visible even when they are collinear with the
    surrounding route. Splitting the simplification at those points preserves
    the usual tolerance on either side while retaining the exact source point.
    """
    if len(coordinates) <= 2:
        return list(range(len(coordinates)))

    required = {
        index for index in (required_indices or set()) if 0 <= index < len(coordinates)
    }
    projected = _project(coordinates)
    keep = [False] * len(coordinates)
    boundaries = sorted({0, *required, len(coordinates) - 1})
    for index in boundaries:
        keep[index] = True

    stack = list(zip(boundaries, boundaries[1:], strict=False))
    while stack:
        first, last = stack.pop()
        if last <= first + 1:
            continue

        farthest_index = -1
        farthest_distance = 0.0
        for index in range(first + 1, last):
            distance = _perpendicular_distance(
                projected[index],
                projected[first],
                projected[last],
            )
            if distance > farthest_distance:
                farthest_distance = distance
                farthest_index = index

        if farthest_distance > tolerance_meters:
            keep[farthest_index] = True
            stack.append((first, farthest_index))
            stack.append((farthest_index, last))

    return [index for index, kept in enumerate(keep) if kept]
