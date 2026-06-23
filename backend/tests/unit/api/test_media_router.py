from __future__ import annotations

import pytest

from api.routers.media import parse_range_header


@pytest.mark.unit
def test_parse_range_header_with_explicit_end() -> None:
    assert parse_range_header('bytes=2-5', 10) == (2, 5)


@pytest.mark.unit
def test_parse_range_header_with_open_end() -> None:
    assert parse_range_header('bytes=7-', 10) == (7, 9)


@pytest.mark.unit
def test_parse_range_header_with_suffix() -> None:
    assert parse_range_header('bytes=-4', 10) == (6, 9)


@pytest.mark.unit
def test_parse_range_header_rejects_unsatisfiable_range() -> None:
    with pytest.raises(ValueError):
        parse_range_header('bytes=10-12', 10)
