import socket
import uuid

import pytest

from services.immich_client import (
    IMMICH_SCHEMA_VERSION,
    ImmichClient,
    ImmichCredentialsError,
    ImmichInvalidConnectionError,
    ImmichNotFoundError,
    ImmichPolicyError,
    ValidatedServer,
    normalize_server_url,
    validate_server_policy,
)


def _dns(address: str):
    return [
        (
            socket.AF_INET6 if ':' in address else socket.AF_INET,
            socket.SOCK_STREAM,
            socket.IPPROTO_TCP,
            '',
            (address, 443, 0, 0) if ':' in address else (address, 443),
        )
    ]


def test_adapter_is_pinned_to_immich_v3_release() -> None:
    assert IMMICH_SCHEMA_VERSION == '3.0.0'


@pytest.mark.parametrize(
    ('raw', 'expected'),
    [
        ('HTTPS://Photos.Example.COM:443/api/', 'https://photos.example.com'),
        ('http://photos.example.com:80/', 'http://photos.example.com'),
        ('https://[2001:db8::1]:8443/api', 'https://[2001:db8::1]:8443'),
    ],
)
def test_normalize_server_url(raw: str, expected: str) -> None:
    assert normalize_server_url(raw) == expected


@pytest.mark.parametrize(
    'raw',
    [
        'ftp://photos.example.com',
        'https://user:secret@photos.example.com',
        'https://photos.example.com/subpath',
        'https://photos.example.com?key=value',
        'https://photos.example.com/#fragment',
    ],
)
def test_normalize_server_url_rejects_unsafe_shapes(raw: str) -> None:
    with pytest.raises(ImmichPolicyError):
        normalize_server_url(raw)


def test_explicit_allowlist_permits_private_http(monkeypatch) -> None:
    monkeypatch.setattr(socket, 'getaddrinfo', lambda *_args, **_kwargs: _dns('192.168.1.20'))

    server = validate_server_policy(
        'http://immich.lan',
        ['http://immich.lan/api'],
        False,
    )

    assert server.origin == 'http://immich.lan'
    assert server.addresses == ('192.168.1.20',)


def test_allow_any_accepts_only_public_https(monkeypatch) -> None:
    monkeypatch.setattr(socket, 'getaddrinfo', lambda *_args, **_kwargs: _dns('93.184.216.34'))
    assert (
        validate_server_policy('https://photos.example.com', [], True).origin
        == 'https://photos.example.com'
    )
    with pytest.raises(ImmichPolicyError):
        validate_server_policy('http://photos.example.com', [], True)


@pytest.mark.parametrize(
    'address',
    [
        '127.0.0.1',
        '169.254.169.254',
        '100.100.100.200',
        'fd00:ec2::254',
        '::1',
        '224.0.0.1',
    ],
)
def test_prohibited_addresses_are_denied_even_when_allowlisted(
    monkeypatch,
    address: str,
) -> None:
    monkeypatch.setattr(socket, 'getaddrinfo', lambda *_args, **_kwargs: _dns(address))
    with pytest.raises(ImmichPolicyError):
        validate_server_policy('https://photos.example.com', ['https://photos.example.com'], False)


def test_allow_any_rejects_private_dns_answers(monkeypatch) -> None:
    monkeypatch.setattr(socket, 'getaddrinfo', lambda *_args, **_kwargs: _dns('10.0.0.4'))
    with pytest.raises(ImmichPolicyError):
        validate_server_policy('https://photos.example.com', [], True)


class _ContractClient(ImmichClient):
    def __init__(self, responses):
        super().__init__(
            ValidatedServer(
                origin='https://photos.example.com',
                scheme='https',
                host='photos.example.com',
                port=443,
                addresses=('93.184.216.34',),
            ),
            'secret',
        )
        self.responses = responses
        self.requests = []

    def _request_json(self, method, path, *, body=None):
        self.requests.append((method, path, body))
        response = self.responses[path]
        if isinstance(response, Exception):
            raise response
        return response


def test_validation_checks_identity_version_and_exact_minimum_permissions() -> None:
    user_id = uuid.uuid4()
    client = _ContractClient(
        {
            '/server/version': {'major': 3, 'minor': 0, 'patch': 0},
            '/users/me': {'id': str(user_id)},
            '/api-keys/me': {
                'permissions': [
                    'album.read',
                    'asset.read',
                    'asset.view',
                    'asset.download',
                    'user.read',
                ]
            },
        }
    )

    assert client.validate_connection().user_id == user_id


def test_validation_rejects_missing_permission() -> None:
    client = _ContractClient(
        {
            '/server/version': {'major': 3},
            '/users/me': {'id': str(uuid.uuid4())},
            '/api-keys/me': {'permissions': ['album.read']},
        }
    )
    with pytest.raises(ImmichInvalidConnectionError) as exc_info:
        client.validate_connection()

    assert str(exc_info.value) == (
        'Immich API key is missing required permissions: asset.download, asset.read, '
        'asset.view, user.read'
    )
    assert [request[1] for request in client.requests] == [
        '/server/version',
        '/api-keys/me',
    ]


def test_validation_explains_rejected_api_key() -> None:
    client = _ContractClient(
        {
            '/server/version': {'major': 3},
            '/api-keys/me': ImmichCredentialsError('unauthorized', status=401),
        }
    )

    with pytest.raises(ImmichInvalidConnectionError, match='rejected the API key.*HTTP 401'):
        client.validate_connection()


def test_validation_explains_permission_denial_with_required_permissions() -> None:
    client = _ContractClient(
        {
            '/server/version': {'major': 3},
            '/api-keys/me': ImmichCredentialsError('forbidden', status=403),
        }
    )

    with pytest.raises(ImmichInvalidConnectionError) as exc_info:
        client.validate_connection()

    assert str(exc_info.value) == (
        'Immich denied permission to inspect the API key (HTTP 403); required API key '
        'permissions are: album.read, asset.download, asset.read, asset.view, user.read'
    )


def test_validation_explains_wrong_server_url() -> None:
    client = _ContractClient(
        {'/server/version': ImmichNotFoundError('not found')}
    )

    with pytest.raises(ImmichInvalidConnectionError, match='No Immich API was found'):
        client.validate_connection()


def test_asset_search_uses_v3_album_filter_without_dropping_stacks() -> None:
    album_id = uuid.uuid4()
    client = _ContractClient(
        {
            '/search/metadata': {
                'assets': {'items': [], 'nextPage': '2'},
            }
        }
    )

    result = client.search_assets(album_id, page=1, page_size=20)

    assert result.next_page == 2
    body = client.requests[0][2]
    assert body == {
        'albumIds': [str(album_id)],
        'order': 'desc',
        'page': 1,
        'size': 20,
        'visibility': 'timeline',
        'withDeleted': False,
        'withExif': False,
        'withPeople': False,
    }
    assert 'withStacked' not in body
