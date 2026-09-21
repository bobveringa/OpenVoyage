"""Distance rules shared conceptually with the Leaflet session editor (metres)."""

from math import asin, atan2, cos, sin, sqrt

EARTH_RADIUS_METERS = 6_371_000
MAX_MOVE_DISTANCE_METERS = 400
INSERT_DISTANCE_RATIO = 0.25
MIN_INSERT_DISTANCE_METERS = 20
MAX_INSERT_DISTANCE_METERS = 200


def distance(a, b):
    from math import radians

    lat1, lat2 = radians(a[0]), radians(b[0])
    dlat, dlon = lat2 - lat1, radians(b[1] - a[1])
    h = sin(dlat / 2) ** 2 + cos(lat1) * cos(lat2) * sin(dlon / 2) ** 2
    return 2 * EARTH_RADIUS_METERS * asin(min(1, sqrt(max(0, h))))


def bearing(a, b):
    from math import radians

    p, q, d = radians(a[0]), radians(b[0]), radians(b[1] - a[1])
    return atan2(sin(d) * cos(q), cos(p) * sin(q) - sin(p) * cos(q) * cos(d))


def segment_distance(point, a, b):
    length = distance(a, b)
    if length < 0.001:
        return distance(point, a)
    delta = distance(a, point) / EARTH_RADIUS_METERS
    angle = bearing(a, point) - bearing(a, b)
    along = atan2(sin(delta) * cos(angle), cos(delta)) * EARTH_RADIUS_METERS
    if along <= 0:
        return distance(point, a)
    if along >= length:
        return distance(point, b)
    return abs(asin(max(-1, min(1, sin(delta) * sin(angle))))) * EARTH_RADIUS_METERS


def insert_distance_limit(a, b):
    return min(
        MAX_INSERT_DISTANCE_METERS,
        max(MIN_INSERT_DISTANCE_METERS, distance(a, b) * INSERT_DISTANCE_RATIO),
    )
