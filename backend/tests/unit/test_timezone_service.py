from __future__ import annotations

from zoneinfo import ZoneInfo

import pytest

from services import timezone_service
from services.timezone_service import longitude_fallback_timezone, resolve_timezone


@pytest.mark.unit
@pytest.mark.parametrize(
    ('latitude', 'longitude', 'expected'),
    [
        pytest.param(35.6762, 139.6503, 'Asia/Tokyo', id='tokyo'),
        # Baarle-Nassau (NL) and Baarle-Hertog (BE) enclaves are a few hundred
        # metres apart; only boundary data tells them apart.
        pytest.param(51.4452, 4.9295, 'Europe/Amsterdam', id='baarle-nassau'),
        pytest.param(51.4419, 4.9265, 'Europe/Brussels', id='baarle-hertog'),
        pytest.param(30.0, -40.0, 'Etc/GMT+3', id='open-ocean'),
        # Either side of the date line: Samoa is UTC+13, American Samoa UTC-11.
        pytest.param(-13.8333, -171.7667, 'Pacific/Apia', id='samoa'),
        pytest.param(-14.2756, -170.7020, 'Pacific/Pago_Pago', id='american-samoa'),
        pytest.param(-17.7134, 178.0650, 'Pacific/Fiji', id='fiji'),
    ],
)
def test_resolve_timezone(latitude: float, longitude: float, expected: str) -> None:
    zone = resolve_timezone(latitude, longitude)

    assert zone == expected
    ZoneInfo(zone)


@pytest.mark.unit
@pytest.mark.parametrize(
    ('longitude', 'expected'),
    [
        (0.0, 'Etc/GMT'),
        (7.4, 'Etc/GMT'),
        (135.0, 'Etc/GMT-9'),
        (-40.0, 'Etc/GMT+3'),
        (180.0, 'Etc/GMT-12'),
        (-180.0, 'Etc/GMT+12'),
    ],
)
def test_longitude_fallback_timezone_inverts_the_etc_sign(
    longitude: float, expected: str
) -> None:
    assert longitude_fallback_timezone(longitude) == expected
    ZoneInfo(expected)


class _FinderStub:
    def __init__(self, zone: str | None) -> None:
        self.zone = zone

    def timezone_at(self, *, lng: float, lat: float) -> str | None:
        return self.zone


@pytest.mark.unit
@pytest.mark.parametrize('lookup_result', [None, '', 'Not/AZone'])
def test_resolve_timezone_falls_back_to_longitude_zone(
    monkeypatch: pytest.MonkeyPatch, lookup_result: str | None
) -> None:
    monkeypatch.setattr(timezone_service, '_finder', _FinderStub(lookup_result))

    assert resolve_timezone(35.0, 135.0) == 'Etc/GMT-9'
    assert resolve_timezone(35.0, -75.0) == 'Etc/GMT+5'
    assert resolve_timezone(0.0, 0.0) == 'Etc/GMT'


@pytest.mark.unit
def test_finder_is_created_once(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(timezone_service, '_finder', None)

    resolve_timezone(35.6762, 139.6503)
    first = timezone_service._finder
    resolve_timezone(52.37, 4.89)

    assert first is not None
    assert timezone_service._finder is first
