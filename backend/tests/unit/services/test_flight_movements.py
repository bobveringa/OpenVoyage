import pytest

from services.gps.flight_geometry import arc, arc_point


def test_dateline_and_antipodal_geometry_is_finite_and_keeps_endpoints():
    points = arc((179, 20), (-179, 20))
    assert points[0] == pytest.approx((179, 20))
    assert points[-1] == pytest.approx((-179, 20))
    assert abs(arc_point((179, 20), (-179, 20), 0.5)[0]) == pytest.approx(180)
    assert len(arc((0, 0), (180, 0))) == 65
