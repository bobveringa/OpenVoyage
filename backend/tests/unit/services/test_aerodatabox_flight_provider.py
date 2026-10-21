import json
from io import BytesIO
from unittest.mock import MagicMock, Mock
from urllib.error import HTTPError, URLError

import pytest

from models.api.planning import FlightLookupRequest
from services.flight_providers import AeroDataBoxFlightProvider, FlightUnavailable

MODULE = 'services.flight_providers.aerodatabox_flight_provider.urlopen'
INTENT = FlightLookupRequest(flight_number='kl 597', departure_date='2026-11-18')


def provider(api_key='test-secret'):
    return AeroDataBoxFlightProvider(
        api_key=api_key,
        base_url='https://proxy.example.test/api/',
        rapidapi_host='custom.example.test',
    )


def test_requests_use_configured_endpoint_and_headers(monkeypatch):
    response = MagicMock()
    response.__enter__.return_value = response
    response.status = 200
    response.read.return_value = json.dumps([]).encode()
    request = Mock(return_value=response)
    monkeypatch.setattr(MODULE, request)
    assert provider().lookup(INTENT, timeout=3) == []
    args, kwargs = request.call_args
    assert args[0].full_url.startswith(
        'https://proxy.example.test/api/flights/number/KL597/2026-11-18?'
    )
    assert args[0].get_header('X-rapidapi-host') == 'custom.example.test'
    assert args[0].get_header('X-rapidapi-key') == 'test-secret'
    assert kwargs['timeout'] == 3


@pytest.mark.parametrize('key', [None, '', '   '])
def test_missing_key_never_calls_network(monkeypatch, key):
    network = Mock(side_effect=AssertionError('Network without key'))
    monkeypatch.setattr(MODULE, network)
    assert not provider(key).is_configured()
    with pytest.raises(FlightUnavailable, match='not configured'):
        provider(key).lookup(INTENT)
    network.assert_not_called()


@pytest.mark.parametrize('status', [204, 404])
def test_not_found_is_empty(monkeypatch, status):
    if status == 404:
        network = Mock(side_effect=HTTPError('url', 404, 'missing', {}, BytesIO()))
    else:
        response = MagicMock()
        response.__enter__.return_value = response
        response.status = status
        network = Mock(return_value=response)
    monkeypatch.setattr(MODULE, network)
    assert provider().lookup(INTENT) == []


def test_rate_limit_preserves_retry_without_returning_raw_error(monkeypatch):
    monkeypatch.setattr(
        MODULE,
        Mock(
            side_effect=HTTPError(
                'url',
                429,
                'test-secret',
                {'Retry-After': '30'},
                BytesIO(b'private payload'),
            )
        ),
    )
    with pytest.raises(FlightUnavailable) as caught:
        provider().lookup(INTENT)
    assert caught.value.reason == 'Flight lookup limit reached'
    assert caught.value.retry_after_seconds == 30
    assert 'test-secret' not in str(caught.value)


@pytest.mark.parametrize(
    'body',
    [b'not json', b'{}', b'x' * 2_000_001],
    ids=['invalid-json', 'invalid-shape', 'oversized'],
)
def test_invalid_payloads_are_unavailable(monkeypatch, body):
    response = MagicMock()
    response.__enter__.return_value = response
    response.status = 200
    response.read.return_value = body
    monkeypatch.setattr(MODULE, Mock(return_value=response))
    with pytest.raises(FlightUnavailable):
        provider().lookup(INTENT)


def test_network_failure_hides_details(monkeypatch):
    monkeypatch.setattr(MODULE, Mock(side_effect=URLError('test-secret')))
    with pytest.raises(FlightUnavailable) as caught:
        provider().lookup(INTENT)
    assert str(caught.value) == 'Flight lookup unavailable'
