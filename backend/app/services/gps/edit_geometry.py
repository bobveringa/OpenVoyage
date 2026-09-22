"""Distance rules shared with the Leaflet session editor (metres)."""

from math import asin, atan2, cos, degrees, radians, sin, sqrt

EARTH_RADIUS_METERS = 6_371_000
MIN_EDIT_RADIUS_METERS = 500


def distance(a, b):
    lat1, lat2 = radians(a[0]), radians(b[0])
    dlat, dlon = lat2 - lat1, radians(b[1] - a[1])
    h = sin(dlat / 2) ** 2 + cos(lat1) * cos(lat2) * sin(dlon / 2) ** 2
    return 2 * EARTH_RADIUS_METERS * asin(min(1, sqrt(max(0, h))))


def bearing(a, b):
    p, q, d = radians(a[0]), radians(b[0]), radians(b[1] - a[1])
    return atan2(sin(d) * cos(q), cos(p) * sin(q) - sin(p) * cos(q) * cos(d))


def destination(a, angle, meters):
    distance_radians = meters / EARTH_RADIUS_METERS
    latitude, longitude = radians(a[0]), radians(a[1])
    target_latitude = asin(
        sin(latitude) * cos(distance_radians)
        + cos(latitude) * sin(distance_radians) * cos(angle)
    )
    target_longitude = longitude + atan2(
        sin(angle) * sin(distance_radians) * cos(latitude),
        cos(distance_radians) - sin(latitude) * sin(target_latitude),
    )
    return (degrees(target_latitude), (degrees(target_longitude) + 540) % 360 - 180)


def insertion_area(a, b):
    length = distance(a, b)
    return destination(a, bearing(a, b), length / 2), max(
        MIN_EDIT_RADIUS_METERS, length
    )


def move_area_radius(origin, connections):
    return max(
        [
            MIN_EDIT_RADIUS_METERS,
            *(distance(origin, connection) * 1.5 for connection in connections),
        ]
    )
