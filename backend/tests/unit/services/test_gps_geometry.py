from __future__ import annotations

import math

import pytest

from services.gps.geometry import (
    haversine_meters,
    is_within_radius,
    normalize_longitude_delta,
    simplify_line,
)

# Eindhoven, used as an ordinary mid-latitude reference point.
HOME_LATITUDE = 51.4416
HOME_LONGITUDE = 5.4697


@pytest.mark.unit
def test_haversine_is_zero_at_the_same_point() -> None:
    assert haversine_meters(
        HOME_LATITUDE,
        HOME_LONGITUDE,
        HOME_LATITUDE,
        HOME_LONGITUDE,
    ) == pytest.approx(0.0, abs=1e-9)


@pytest.mark.unit
def test_haversine_matches_a_known_north_south_distance() -> None:
    # One degree of latitude is very close to 111.19 km on a sphere.
    distance = haversine_meters(0.0, 0.0, 1.0, 0.0)
    assert distance == pytest.approx(111_195, rel=1e-3)


@pytest.mark.unit
def test_haversine_crosses_the_antimeridian_by_the_short_way() -> None:
    distance = haversine_meters(0.0, 179.999, 0.0, -179.999)
    assert distance == pytest.approx(222.4, rel=1e-2)


@pytest.mark.unit
@pytest.mark.parametrize('longitude_delta', [-540.0, -180.0, 0.0, 180.0, 540.0])
def test_normalize_longitude_delta_stays_in_range(longitude_delta: float) -> None:
    assert -180.0 <= normalize_longitude_delta(longitude_delta) <= 180.0


@pytest.mark.unit
def test_center_and_boundary_count_as_inside_and_outside_does_not() -> None:
    radius = 500.0
    assert is_within_radius(
        HOME_LATITUDE,
        HOME_LONGITUDE,
        HOME_LATITUDE,
        HOME_LONGITUDE,
        radius,
    )

    # A point exactly on the circle counts as inside. Taking the radius from
    # the measured distance avoids depending on a rounded metres-per-degree
    # constant, which would put the point a fraction of a millimetre out.
    boundary_latitude = HOME_LATITUDE + radius / 111_195.0
    boundary_distance = haversine_meters(
        boundary_latitude,
        HOME_LONGITUDE,
        HOME_LATITUDE,
        HOME_LONGITUDE,
    )
    assert is_within_radius(
        boundary_latitude,
        HOME_LONGITUDE,
        HOME_LATITUDE,
        HOME_LONGITUDE,
        boundary_distance,
    )

    outside_latitude = HOME_LATITUDE + (radius * 1.05) / 111_195.0
    assert not is_within_radius(
        outside_latitude,
        HOME_LONGITUDE,
        HOME_LATITUDE,
        HOME_LONGITUDE,
        radius,
    )


@pytest.mark.unit
def test_zone_filters_across_the_antimeridian() -> None:
    """A prefilter that skips longitude normalization retains this coordinate.

    The raw delta is 359.998 degrees, so a naive bounding box rejects the pair
    and the point is never distance-tested — it would be stored despite sitting
    about 110 metres from the zone center.
    """
    assert haversine_meters(0.0, 179.999, 0.0, -179.999) < 500.0
    assert is_within_radius(0.0, -179.999, 0.0, 179.999, 500.0)


@pytest.mark.unit
def test_zone_near_the_pole_catches_a_sample_at_higher_latitude() -> None:
    """Taking cosine at the zone's own latitude would reject this point.

    Close to a pole the parallels shrink fast enough that the permitted
    longitude delta at the sample's latitude is much larger than at the
    center's, so the bound has to be computed at the higher of the two.
    """
    center_latitude = 89.99
    radius = 1_000.0
    sample_latitude = 89.995

    # Offset east far enough that it only stays inside because the parallel is
    # tiny at this latitude.
    metres_per_degree_longitude = 111_320.0 * math.cos(math.radians(sample_latitude))
    sample_longitude = 300.0 / metres_per_degree_longitude

    assert (
        haversine_meters(
            sample_latitude,
            sample_longitude,
            center_latitude,
            0.0,
        )
        <= radius
    )
    assert is_within_radius(
        sample_latitude,
        sample_longitude,
        center_latitude,
        0.0,
        radius,
    )


@pytest.mark.unit
def test_prefilter_never_rejects_what_haversine_accepts() -> None:
    """Exhaustive agreement check, swept densely across the zone boundary.

    The sweep deliberately walks the last fraction of a percent of the radius
    in both axes. A prefilter built on a metres-per-degree constant that
    disagrees with the distance test only fails inside that thin band, and a
    coarser grid steps straight over it.
    """
    radius = 1_000.0
    latitude_span = radius / 111_195.0
    centers = (0.0, 45.0, 51.44, 60.0, 89.0, 89.99, 90.0, -89.99, -45.0)
    fractions = (0.0, 0.5, 0.9, 0.99, 0.999, 1.0, 1.001, 1.01, 1.1)

    for center_latitude in centers:
        cosine = max(math.cos(math.radians(center_latitude)), 1e-9)
        longitude_span = radius / (111_195.0 * cosine)
        for latitude_fraction in fractions:
            for longitude_fraction in fractions:
                for latitude_sign, longitude_sign in ((1, 1), (-1, 1), (1, -1)):
                    latitude = center_latitude + (
                        latitude_sign * latitude_fraction * latitude_span
                    )
                    if not -90.0 <= latitude <= 90.0:
                        continue
                    longitude = normalize_longitude_delta(
                        longitude_sign * longitude_fraction * longitude_span
                    )
                    truly_inside = (
                        haversine_meters(latitude, longitude, center_latitude, 0.0)
                        <= radius
                    )
                    reported = is_within_radius(
                        latitude,
                        longitude,
                        center_latitude,
                        0.0,
                        radius,
                    )
                    assert reported == truly_inside, (
                        center_latitude,
                        latitude,
                        longitude,
                    )


@pytest.mark.unit
def test_prefilter_agrees_with_haversine_across_the_antimeridian() -> None:
    """The same sweep with the zone sitting on the +/-180 seam."""
    radius = 1_000.0
    center_longitude = 179.9995
    latitude_span = radius / 111_195.0

    for latitude_fraction in (0.0, 0.5, 0.99, 1.0, 1.01):
        for longitude_offset in (-0.02, -0.005, 0.0, 0.005, 0.02):
            latitude = latitude_fraction * latitude_span
            longitude = normalize_longitude_delta(center_longitude + longitude_offset)
            truly_inside = (
                haversine_meters(latitude, longitude, 0.0, center_longitude) <= radius
            )
            assert (
                is_within_radius(
                    latitude,
                    longitude,
                    0.0,
                    center_longitude,
                    radius,
                )
                == truly_inside
            ), (latitude, longitude)


@pytest.mark.unit
def test_simplify_keeps_endpoints_and_drops_collinear_points() -> None:
    line = [(0.0, 0.0), (0.5, 0.0), (1.0, 0.0)]
    assert simplify_line(line) == [(0.0, 0.0), (1.0, 0.0)]


@pytest.mark.unit
def test_simplify_never_invents_a_coordinate() -> None:
    line = [(0.0, 0.0), (0.01, 0.05), (0.02, 0.0), (0.03, 0.08), (0.04, 0.0)]
    simplified = simplify_line(line)
    assert all(coordinate in line for coordinate in simplified)
    assert simplified[0] == line[0]
    assert simplified[-1] == line[-1]


@pytest.mark.unit
def test_simplify_keeps_a_two_point_line_intact() -> None:
    line = [(4.8952, 52.3702), (5.1214, 52.0907)]
    assert simplify_line(line) == line


@pytest.mark.unit
def test_tolerance_is_a_real_distance_at_every_latitude() -> None:
    """The same metric shape must simplify identically at 0 and 60 degrees.

    This fails outright if the implementation compares raw degrees, because a
    degree of longitude at 60 degrees north is half the distance it is at the
    equator.
    """

    def shape(base_latitude: float) -> list[tuple[float, float]]:
        scale = math.cos(math.radians(base_latitude))
        # A 300 m eastward run with a 40 m northward bulge in the middle.
        east_degrees = 300.0 / (111_320.0 * scale)
        bulge_degrees = 40.0 / 111_320.0
        return [
            (0.0, base_latitude),
            (east_degrees / 2, base_latitude + bulge_degrees),
            (east_degrees, base_latitude),
        ]

    equator = simplify_line(shape(0.0))
    high_latitude = simplify_line(shape(60.0))
    assert len(equator) == len(high_latitude) == 3
