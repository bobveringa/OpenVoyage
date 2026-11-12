"""Trim the ends of route lines that start or finish inside a privacy zone.

On route lines a zone is a buffer around the line's ends, not an area the line
must avoid. Only the first and last point are checked:

- an end inside a zone is cut back to where the line leaves that zone,
- a line that only passes through a zone is left alone,
- a line entirely inside a zone disappears.

Coordinates are GeoJSON ``[longitude, latitude]`` pairs. Zones are
``(latitude, longitude, radius_meters)``.
"""

from __future__ import annotations

import math

from services.gps.geometry import (
    METERS_PER_DEGREE_LATITUDE,
    is_within_radius,
    normalize_longitude_delta,
)

Zone = tuple[float, float, float]
Line = list[list[float]]

# The cut lands just outside the zone's edge, never on it.
_EDGE_MARGIN_METERS = 1.0


def inside(point, zone: Zone) -> bool:
    return is_within_radius(point[1], point[0], zone[0], zone[1], float(zone[2]))


def inside_any(point, zones) -> bool:
    return any(inside(point, zone) for zone in zones)


def _crossing(a, b, zone: Zone) -> list[float]:
    """The point between ``a`` (inside) and ``b`` (outside) on the zone's edge.

    Works in a flat projection around the zone's centre, which is exact
    enough at zone sizes and keeps the cut on the straight piece of line.
    """
    center_lat, center_lon, radius = zone
    scale = METERS_PER_DEGREE_LATITUDE
    cos_lat = math.cos(math.radians(center_lat))

    def project(point):
        return (
            normalize_longitude_delta(point[0] - center_lon) * scale * cos_lat,
            (point[1] - center_lat) * scale,
        )

    (ax, ay), (bx, by) = project(a), project(b)
    dx, dy = bx - ax, by - ay
    r = float(radius) + _EDGE_MARGIN_METERS
    qa = dx * dx + dy * dy
    qb = 2 * (ax * dx + ay * dy)
    qc = ax * ax + ay * ay - r * r
    if qa == 0:
        return list(b)
    t = (-qb + math.sqrt(max(0.0, qb * qb - 4 * qa * qc))) / (2 * qa)
    t = min(1.0, max(0.0, t))
    x, y = ax + t * dx, ay + t * dy
    longitude = center_lon + x / (scale * cos_lat) if cos_lat else b[0]
    longitude = normalize_longitude_delta(longitude)
    return [longitude, center_lat + y / scale]


def _leave(line: Line, zone: Zone) -> Line:
    """The part of ``line`` after it first leaves ``zone``; empty if it never does."""
    for index, point in enumerate(line):
        if not inside(point, zone):
            if index == 0:
                return list(line)
            return [_crossing(line[index - 1], point, zone), *line[index:]]
    return []


def trim_start(lines: list[Line], zones) -> tuple[list[Line], bool]:
    """Cut the start of a path made of ``lines`` out of every zone it starts in.

    Lines that lie entirely inside a zone are dropped from the front. Returns
    the remaining lines and whether anything was cut.
    """
    lines = [list(line) for line in lines if line]
    remaining = list(zones)
    cut = False
    while lines:
        zone = next((z for z in remaining if inside(lines[0][0], z)), None)
        if zone is None:
            break
        remaining.remove(zone)
        cut = True
        while lines:
            rest = _leave(lines[0], zone)
            if rest:
                lines[0] = rest
                break
            lines.pop(0)
    return lines, cut


def trim_end(lines: list[Line], zones) -> tuple[list[Line], bool]:
    reversed_lines, cut = trim_start(
        [list(reversed(line)) for line in reversed(lines)], zones
    )
    return [list(reversed(line)) for line in reversed(reversed_lines)], cut
