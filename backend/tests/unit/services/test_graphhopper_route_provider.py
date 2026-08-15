from __future__ import annotations

import json
from io import BytesIO
from urllib.error import HTTPError
from urllib.parse import parse_qs, urlsplit

import pytest

from models.database.travel import TravelMode
from services.route_providers import (
    GraphHopperRouteProvider,
    RouteProviderConfigurationError,
    RouteProviderError,
    RouteProviderResponseError,
)
from services.route_providers import graphhopper_route_provider


class FakeResponse:
    def __init__(self, payload: dict | str) -> None:
        if isinstance(payload, str):
            self.content = payload.encode('utf-8')
        else:
            self.content = json.dumps(payload).encode('utf-8')

    def __enter__(self) -> FakeResponse:
        return self

    def __exit__(self, *_args: object) -> None:
        return None

    def read(self) -> bytes:
        return self.content


def _provider(
    *,
    api_key: str = 'test-key',
    base_url: str = 'https://example.test/api/1',
) -> GraphHopperRouteProvider:
    return GraphHopperRouteProvider(api_key=api_key, base_url=base_url)


def test_get_route_calls_graphhopper_and_parses_response(monkeypatch) -> None:
    captured: dict[str, object] = {}

    def fake_urlopen(request, *, timeout: int):
        captured['url'] = request.full_url
        captured['user_agent'] = request.headers['User-agent']
        captured['timeout'] = timeout
        return FakeResponse(
            {
                'paths': [
                    {
                        'points': {
                            'type': 'LineString',
                            'coordinates': [
                                [5.4697, 51.4416],
                                [5.1214, 52.0907],
                            ],
                        },
                        'distance': 1234.6,
                        'time': 98765,
                    }
                ]
            }
        )

    monkeypatch.setattr(graphhopper_route_provider, 'urlopen', fake_urlopen)

    result = _provider().get_route(
        coordinates_from=(5.4697, 51.4416),
        coordinates_to=(5.1214, 52.0907),
        travel_mode=TravelMode.CAR,
    )
    parsed_url = urlsplit(str(captured['url']))
    query = parse_qs(parsed_url.query)

    assert parsed_url.scheme == 'https'
    assert parsed_url.netloc == 'example.test'
    assert parsed_url.path == '/api/1/route'
    assert query['point'] == ['51.4416,5.4697', '52.0907,5.1214']
    assert query['vehicle'] == ['car']
    assert query['points_encoded'] == ['false']
    assert query['key'] == ['test-key']
    assert captured['user_agent'] == 'openvoyage-backend'
    assert captured['timeout'] == GraphHopperRouteProvider.timeout_seconds
    assert result.geometry_geojson == {
        'type': 'LineString',
        'coordinates': [[5.4697, 51.4416], [5.1214, 52.0907]],
    }
    assert result.distance_meters == 1235
    assert result.duration_seconds == 99


def test_get_route_rejects_unsupported_travel_mode() -> None:
    with pytest.raises(RouteProviderConfigurationError):
        _provider().get_route(
            coordinates_from=(5.4697, 51.4416),
            coordinates_to=(5.1214, 52.0907),
            travel_mode=TravelMode.TRAIN,
        )


def test_get_route_requires_api_key() -> None:
    with pytest.raises(RouteProviderConfigurationError):
        _provider(api_key='').get_route(
            coordinates_from=(5.4697, 51.4416),
            coordinates_to=(5.1214, 52.0907),
            travel_mode=TravelMode.CAR,
        )


def test_get_route_rejects_malformed_graphhopper_response(monkeypatch) -> None:
    monkeypatch.setattr(
        graphhopper_route_provider,
        'urlopen',
        lambda *_args, **_kwargs: FakeResponse({'paths': []}),
    )

    with pytest.raises(RouteProviderResponseError):
        _provider().get_route(
            coordinates_from=(5.4697, 51.4416),
            coordinates_to=(5.1214, 52.0907),
            travel_mode=TravelMode.CAR,
        )


def test_get_route_wraps_graphhopper_http_errors(monkeypatch) -> None:
    def fake_urlopen(*_args, **_kwargs):
        raise HTTPError(
            url='https://example.test/api/1/route',
            code=429,
            msg='Too Many Requests',
            hdrs={},
            fp=BytesIO(b'{"message": "rate limit exceeded"}'),
        )

    monkeypatch.setattr(graphhopper_route_provider, 'urlopen', fake_urlopen)

    with pytest.raises(RouteProviderError, match='rate limit exceeded'):
        _provider().get_route(
            coordinates_from=(5.4697, 51.4416),
            coordinates_to=(5.1214, 52.0907),
            travel_mode=TravelMode.CAR,
        )
