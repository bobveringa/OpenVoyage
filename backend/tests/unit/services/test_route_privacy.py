from services.gps.geometry import haversine_meters
from services.route_privacy import trim_end, trim_start

ZONE = (52.0, 5.0, 1000)


def distance(point, zone=ZONE):
    return haversine_meters(point[1], point[0], zone[0], zone[1])


def test_a_start_inside_a_zone_is_cut_at_the_edge_just_outside():
    line = [[5.0, 52.0], [5.005, 52.0], [5.03, 52.0], [5.1, 52.0]]
    (trimmed,), cut = trim_start([line], [ZONE])
    assert cut
    assert 1000 < distance(trimmed[0]) < 1002
    # The cut lies on the piece that leaves the zone, and the rest is kept.
    assert 5.005 < trimmed[0][0] < 5.03
    assert trimmed[1:] == line[2:]


def test_a_line_that_only_passes_through_a_zone_is_untouched():
    line = [[4.9, 52.0], [5.0, 52.0], [5.1, 52.0]]
    assert trim_start([line], [ZONE]) == ([line], False)
    assert trim_end([line], [ZONE]) == ([line], False)


def test_the_end_is_cut_the_other_way_round():
    line = [[5.1, 52.0], [5.0, 52.001]]
    (trimmed,), cut = trim_end([line], [ZONE])
    assert cut and trimmed[0] == line[0]
    assert 1000 < distance(trimmed[-1]) < 1002


def test_a_line_entirely_inside_a_zone_disappears():
    assert trim_start([[[5.0, 52.0], [5.001, 52.001]]], [ZONE]) == ([], True)


def test_lines_inside_the_zone_are_dropped_from_the_front():
    taxi = [[5.0, 52.0], [5.002, 52.0]]
    flight = [[5.002, 52.0], [5.2, 52.0]]
    lines, cut = trim_start([taxi, flight], [ZONE])
    assert cut and len(lines) == 1
    assert 1000 < distance(lines[0][0]) < 1002


def test_overlapping_zones_cut_out_of_each():
    big = (52.0, 5.02, 2000)
    lines, _ = trim_start([[[5.0, 52.0], [5.2, 52.0]]], [ZONE, big])
    assert 2000 < distance(lines[0][0], big) < 2002
