import pytest
from fastapi import HTTPException

from api.routers.immich import _decode_asset_cursor, _encode_asset_cursor


def test_asset_cursor_round_trip() -> None:
    cursor = _encode_asset_cursor(12)

    assert cursor is not None
    assert cursor != '12'
    assert _decode_asset_cursor(cursor) == 12


def test_missing_asset_cursor_starts_at_first_page() -> None:
    assert _decode_asset_cursor(None) == 1


@pytest.mark.parametrize('cursor', ['', 'invalid', _encode_asset_cursor(0)])
def test_invalid_asset_cursor_is_rejected(cursor: str | None) -> None:
    assert cursor is not None

    with pytest.raises(HTTPException) as exc_info:
        _decode_asset_cursor(cursor)

    assert exc_info.value.status_code == 422
