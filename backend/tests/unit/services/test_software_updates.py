import json
from datetime import timedelta
from http.client import IncompleteRead
from unittest.mock import MagicMock
from urllib.error import HTTPError, URLError

import pytest
from fastapi.testclient import TestClient

from api.deps import get_db
from core.version import APP_VERSION
from main import app
from models.database.base import utcnow
from services import software_update_service as updates


@pytest.mark.parametrize(('installed', 'latest', 'expected'), [
    ('0.5.0', '0.6.0', 'update_available'),
    ('0.9.0', '0.10.0', 'update_available'),
    ('0.5.0', '0.5.0', 'up_to_date'),
    ('0.5.0+abc', '0.5.0+def', 'up_to_date'),
    ('0.6.0', '0.5.0', 'ahead'),
    ('0.5.0-rc.1', '0.5.0', 'update_available'),
    ('development', '0.5.0', 'unknown'),
    ('0.5.0', None, 'unknown'),
])
def test_compare_versions(installed, latest, expected):
    assert updates.compare_versions(installed, latest) == expected


def release_payload(**changes):
    return {
        'tag_name': 'v0.6.0', 'draft': False, 'prerelease': False,
        'html_url': 'https://github.com/bobveringa/OpenVoyage/releases/tag/v0.6.0',
        'published_at': '2026-10-29T12:00:00Z', **changes,
    }


def mock_response(monkeypatch, body):
    response = MagicMock()
    response.__enter__.return_value = response
    response.read.return_value = body
    response.headers = {'ETag': '"release-1"'}
    fetch = MagicMock(return_value=response)
    monkeypatch.setattr(updates, 'urlopen', fetch)
    return fetch


def test_fetch_normalizes_version_and_uses_bounded_conditional_request(monkeypatch):
    fetch = mock_response(monkeypatch, json.dumps(release_payload()).encode())
    result = updates.fetch_latest_release('"previous"')
    assert result.release.version == '0.6.0'
    assert result.etag == '"release-1"'
    request = fetch.call_args.args[0]
    assert request.full_url == updates.GITHUB_RELEASE_URL
    assert request.get_header('If-none-match') == '"previous"'
    assert fetch.call_args.kwargs['timeout'] == 5
    fetch.return_value.read.assert_called_once_with(updates.MAX_RESPONSE_BYTES + 1)


@pytest.mark.parametrize('body', [
    b'not JSON', b'[]', b'x' * (updates.MAX_RESPONSE_BYTES + 1),
    json.dumps(release_payload(prerelease=True)).encode(),
    json.dumps(release_payload(tag_name='v0.6.0-rc.1')).encode(),
    json.dumps(release_payload(html_url='https://example.com/release')).encode(),
    json.dumps(release_payload(tag_name='not-a-version')).encode(),
], ids=['not-json', 'array', 'too-large', 'prerelease', 'rc-tag', 'external-url', 'invalid-tag'])
def test_rejects_invalid_or_unstable_releases(monkeypatch, body):
    mock_response(monkeypatch, body)
    with pytest.raises(updates.UpdateCheckError, match='invalid_response'):
        updates.fetch_latest_release()


@pytest.mark.parametrize(('error', 'code'), [
    (TimeoutError(), 'timeout'), (URLError('offline'), 'github_unavailable'),
    (URLError(TimeoutError()), 'timeout'),
    (HTTPError(updates.GITHUB_RELEASE_URL, 500, 'error', {}, None), 'github_unavailable'),
])
def test_network_failures_have_safe_error_codes(monkeypatch, error, code):
    monkeypatch.setattr(updates, 'urlopen', MagicMock(side_effect=error))
    with pytest.raises(updates.UpdateCheckError, match=code):
        updates.fetch_latest_release()


def test_rate_limit_and_conditional_responses(monkeypatch):
    fetch = MagicMock(side_effect=HTTPError(updates.GITHUB_RELEASE_URL, 429, 'limited', {'Retry-After': '900'}, None))
    monkeypatch.setattr(updates, 'urlopen', fetch)
    with pytest.raises(updates.UpdateCheckError) as caught:
        updates.fetch_latest_release()
    assert caught.value.code == 'rate_limited'
    assert caught.value.retry_at >= utcnow() + timedelta(minutes=14)
    fetch.side_effect = HTTPError(updates.GITHUB_RELEASE_URL, 304, 'unchanged', {}, None)
    assert updates.fetch_latest_release('"etag"').not_modified
    with pytest.raises(updates.UpdateCheckError, match='invalid_response'):
        updates.fetch_latest_release()
    fetch.side_effect = HTTPError(updates.GITHUB_RELEASE_URL, 404, 'no release', {}, None)
    assert updates.fetch_latest_release().release is None


def test_truncated_response_is_a_safe_failed_check(monkeypatch):
    fetch = mock_response(monkeypatch, b'')
    fetch.return_value.read.side_effect = IncompleteRead(b'partial', 100)
    with pytest.raises(updates.UpdateCheckError, match='github_unavailable'):
        updates.fetch_latest_release()


def test_public_version_has_no_database_or_github_dependency(monkeypatch):
    def unavailable():
        raise AssertionError('Database must not be used')
    app.dependency_overrides[get_db] = unavailable
    monkeypatch.setattr(updates, 'urlopen', MagicMock(side_effect=AssertionError('GitHub must not be used')))
    try:
        response = TestClient(app).get('/api/v1/server/version')
        assert response.status_code == 200
        assert response.json() == {'version': APP_VERSION}
        assert response.headers['cache-control'] == 'no-store'
    finally:
        app.dependency_overrides.pop(get_db, None)
