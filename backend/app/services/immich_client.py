from __future__ import annotations

import http.client
import ipaddress
import json
import socket
import ssl
import time
import uuid
from dataclasses import dataclass
from typing import Any
from urllib.parse import urlencode, urljoin, urlsplit, urlunsplit


IMMICH_SCHEMA_VERSION = '3.0.0'
REQUIRED_PERMISSIONS = frozenset(
    {'album.read', 'asset.read', 'asset.view', 'asset.download', 'user.read'}
)
PROHIBITED_METADATA_ADDRESSES = frozenset(
    {
        ipaddress.ip_address('169.254.169.254'),
        ipaddress.ip_address('100.100.100.200'),
        ipaddress.ip_address('fd00:ec2::254'),
    }
)


class ImmichClientError(RuntimeError):
    pass


class ImmichPolicyError(ImmichClientError):
    pass


class ImmichInvalidConnectionError(ImmichClientError):
    pass


class ImmichCredentialsError(ImmichClientError):
    def __init__(self, message: str, *, status: int) -> None:
        super().__init__(message)
        self.status = status


class ImmichNotFoundError(ImmichClientError):
    pass


class ImmichUnavailableError(ImmichClientError):
    pass


class ImmichTimeoutError(ImmichClientError):
    pass


@dataclass(frozen=True)
class ValidatedServer:
    origin: str
    scheme: str
    host: str
    port: int
    addresses: tuple[str, ...]

    @property
    def api_url(self) -> str:
        return f'{self.origin}/api'


@dataclass(frozen=True)
class ImmichIdentity:
    user_id: uuid.UUID


@dataclass(frozen=True)
class ImmichAsset:
    id: uuid.UUID
    media_type: str
    original_mime_type: str | None


@dataclass(frozen=True)
class ImmichAssetPage:
    items: list[ImmichAsset]
    next_page: int | None


class ImmichMediaStream:
    def __init__(
        self,
        connection: http.client.HTTPConnection,
        response: http.client.HTTPResponse,
        deadline: float,
    ) -> None:
        self.connection = connection
        self.response = response
        self.deadline = deadline
        self.content_type = response.getheader('Content-Type')

    def read(self, size: int = 64 * 1024) -> bytes:
        remaining = self.deadline - time.monotonic()
        if remaining <= 0:
            raise ImmichTimeoutError('Immich request timed out')
        if self.connection.sock is not None:
            self.connection.sock.settimeout(remaining)
        try:
            return self.response.read(size)
        except TimeoutError as exc:
            raise ImmichTimeoutError('Immich request timed out') from exc
        except OSError as exc:
            raise ImmichUnavailableError('Immich media download failed') from exc

    def close(self) -> None:
        self.response.close()
        self.connection.close()

    def __enter__(self) -> 'ImmichMediaStream':
        return self

    def __exit__(self, *_args: object) -> None:
        self.close()


class _PinnedHTTPConnection(http.client.HTTPConnection):
    def __init__(self, host: str, port: int, address: str, timeout: float) -> None:
        super().__init__(host, port, timeout=timeout)
        self._address = address

    def connect(self) -> None:
        self.sock = socket.create_connection(
            (self._address, self.port),
            self.timeout,
            self.source_address,
        )


class _PinnedHTTPSConnection(http.client.HTTPSConnection):
    def __init__(self, host: str, port: int, address: str, timeout: float) -> None:
        super().__init__(
            host,
            port,
            timeout=timeout,
            context=ssl.create_default_context(),
        )
        self._address = address

    def connect(self) -> None:
        sock = socket.create_connection(
            (self._address, self.port),
            self.timeout,
            self.source_address,
        )
        self.sock = self._context.wrap_socket(sock, server_hostname=self.host)


def normalize_server_url(value: str) -> str:
    raw = value.strip()
    try:
        parsed = urlsplit(raw)
        port = parsed.port
    except ValueError as exc:
        raise ImmichPolicyError('Immich server URL is invalid') from exc

    if parsed.scheme.lower() not in {'http', 'https'} or not parsed.hostname:
        raise ImmichPolicyError('Immich server URL must use HTTP or HTTPS')
    if parsed.username is not None or parsed.password is not None:
        raise ImmichPolicyError('Immich server URL must not contain credentials')
    if parsed.query or parsed.fragment:
        raise ImmichPolicyError('Immich server URL must not contain a query or fragment')
    if parsed.path.rstrip('/') not in {'', '/api'}:
        raise ImmichPolicyError('Immich server URL must be an origin with optional /api')

    scheme = parsed.scheme.lower()
    try:
        host = parsed.hostname.lower().rstrip('.').encode('idna').decode('ascii')
    except UnicodeError as exc:
        raise ImmichPolicyError('Immich server URL is invalid') from exc
    if not host:
        raise ImmichPolicyError('Immich server URL is invalid')
    default_port = 443 if scheme == 'https' else 80
    normalized_port = port or default_port
    host_part = f'[{host}]' if ':' in host else host
    netloc = host_part if normalized_port == default_port else f'{host_part}:{normalized_port}'
    return urlunsplit((scheme, netloc, '', '', ''))


def validate_server_policy(
    server_url: str,
    allowed_servers: list[str],
    allow_any_server: bool,
) -> ValidatedServer:
    origin = normalize_server_url(server_url)
    parsed = urlsplit(origin)
    assert parsed.hostname is not None
    port = parsed.port or (443 if parsed.scheme == 'https' else 80)

    normalized_allowlist: set[str] = set()
    for entry in allowed_servers:
        try:
            normalized_allowlist.add(normalize_server_url(entry))
        except ImmichPolicyError:
            continue

    explicitly_allowed = origin in normalized_allowlist
    if not explicitly_allowed:
        if not allow_any_server or parsed.scheme != 'https':
            raise ImmichPolicyError('Immich server is blocked by administrator policy')

    try:
        address_info = socket.getaddrinfo(
            parsed.hostname,
            port,
            type=socket.SOCK_STREAM,
        )
    except OSError as exc:
        raise ImmichUnavailableError('Immich server could not be resolved') from exc

    addresses = tuple(dict.fromkeys(item[4][0] for item in address_info))
    if not addresses:
        raise ImmichUnavailableError('Immich server could not be resolved')

    for address in addresses:
        ip = ipaddress.ip_address(address)
        if isinstance(ip, ipaddress.IPv6Address) and ip.ipv4_mapped is not None:
            ip = ip.ipv4_mapped
        if (
            ip in PROHIBITED_METADATA_ADDRESSES
            or ip.is_unspecified
            or ip.is_multicast
            or ip.is_link_local
            or ip.is_loopback
        ):
            raise ImmichPolicyError('Immich server resolves to a prohibited address')
        if not explicitly_allowed and (
            ip.is_private or ip.is_reserved or not ip.is_global
        ):
            raise ImmichPolicyError('Immich server resolves to a private address')

    return ValidatedServer(
        origin=origin,
        scheme=parsed.scheme,
        host=parsed.hostname,
        port=port,
        addresses=addresses,
    )


class ImmichClient:
    def __init__(self, server: ValidatedServer, api_key: str) -> None:
        self.server = server
        self.api_key = api_key

    def validate_connection(self) -> ImmichIdentity:
        try:
            version = self._request_json('GET', '/server/version')
        except ImmichCredentialsError as exc:
            raise self._connection_credentials_error(exc, 'read the server version') from exc
        except ImmichNotFoundError as exc:
            raise ImmichInvalidConnectionError(
                'No Immich API was found at this URL; enter the Immich server origin '
                '(for example, https://photos.example.com)'
            ) from exc

        if not isinstance(version, dict) or version.get('major') != 3:
            detected = version.get('major') if isinstance(version, dict) else None
            detected_detail = f'; detected major version {detected}' if detected is not None else ''
            raise ImmichInvalidConnectionError(
                f'Immich major version 3 is required (schema {IMMICH_SCHEMA_VERSION})'
                f'{detected_detail}'
            )

        try:
            key = self._request_json('GET', '/api-keys/me')
        except ImmichCredentialsError as exc:
            raise self._connection_credentials_error(exc, 'inspect the API key') from exc
        except ImmichNotFoundError as exc:
            raise ImmichInvalidConnectionError(
                'This Immich server does not expose API key permission details; '
                f'Immich v3 is required (schema {IMMICH_SCHEMA_VERSION})'
            ) from exc

        permissions = key.get('permissions') if isinstance(key, dict) else None
        if not isinstance(permissions, list):
            raise ImmichInvalidConnectionError(
                'Immich returned an invalid API key permission response; '
                f'Immich v3 is required (schema {IMMICH_SCHEMA_VERSION})'
            )
        permission_set = {item for item in permissions if isinstance(item, str)}
        missing = REQUIRED_PERMISSIONS - permission_set
        if 'all' not in permission_set and missing:
            raise ImmichInvalidConnectionError(
                'Immich API key is missing required permissions: '
                + ', '.join(sorted(missing))
            )

        try:
            user = self._request_json('GET', '/users/me')
        except ImmichCredentialsError as exc:
            raise self._connection_credentials_error(exc, 'read the current user') from exc
        except ImmichNotFoundError as exc:
            raise ImmichInvalidConnectionError(
                'This Immich server does not expose the current-user endpoint; '
                f'Immich v3 is required (schema {IMMICH_SCHEMA_VERSION})'
            ) from exc

        if not isinstance(user, dict) or not isinstance(user.get('id'), str):
            raise ImmichInvalidConnectionError('Immich returned an invalid account identity')
        try:
            return ImmichIdentity(user_id=uuid.UUID(user['id']))
        except (ValueError, TypeError) as exc:
            raise ImmichInvalidConnectionError('Immich returned an invalid account identity') from exc

    @staticmethod
    def _connection_credentials_error(
        exc: ImmichCredentialsError,
        operation: str,
    ) -> ImmichInvalidConnectionError:
        if exc.status == 401:
            return ImmichInvalidConnectionError(
                'Immich rejected the API key (HTTP 401); verify that it is correct, active, '
                'and belongs to this server'
            )
        return ImmichInvalidConnectionError(
            f'Immich denied permission to {operation} (HTTP 403); required API key '
            'permissions are: '
            + ', '.join(sorted(REQUIRED_PERMISSIONS))
        )

    def list_albums(self) -> list[dict[str, Any]]:
        payload = self._request_json('GET', '/albums')
        if not isinstance(payload, list):
            raise ImmichUnavailableError('Immich returned an unexpected album response')
        albums = []
        for item in payload:
            if not isinstance(item, dict):
                continue
            album_id = item.get('id')
            name = item.get('albumName')
            if isinstance(album_id, str) and isinstance(name, str):
                try:
                    albums.append({'id': uuid.UUID(album_id), 'name': name})
                except ValueError as exc:
                    raise ImmichUnavailableError(
                        'Immich returned an unexpected album response'
                    ) from exc
        return albums

    def get_album(self, album_id: uuid.UUID) -> dict[str, Any]:
        payload = self._request_json('GET', f'/albums/{album_id}')
        if not isinstance(payload, dict) or not isinstance(payload.get('albumName'), str):
            raise ImmichUnavailableError('Immich returned an unexpected album response')
        return {'id': album_id, 'name': payload['albumName']}

    def search_assets(
        self,
        album_id: uuid.UUID,
        *,
        page: int,
        page_size: int = 20,
        asset_id: uuid.UUID | None = None,
    ) -> ImmichAssetPage:
        body: dict[str, Any] = {
            'albumIds': [str(album_id)],
            'order': 'desc',
            'page': page,
            'size': page_size if asset_id is None else 1,
            'visibility': 'timeline',
            'withDeleted': False,
            'withExif': False,
            'withPeople': False,
        }
        if asset_id is not None:
            body['id'] = str(asset_id)
        payload = self._request_json('POST', '/search/metadata', body=body)
        try:
            assets = payload['assets']
            items_payload = assets['items']
            next_page_raw = assets['nextPage']
        except (KeyError, TypeError) as exc:
            raise ImmichUnavailableError('Immich returned an unexpected asset response') from exc
        if not isinstance(items_payload, list):
            raise ImmichUnavailableError('Immich returned an unexpected asset response')
        items: list[ImmichAsset] = []
        for item in items_payload:
            if not isinstance(item, dict) or item.get('type') not in {'IMAGE', 'VIDEO'}:
                continue
            try:
                remote_id = uuid.UUID(item['id'])
            except (KeyError, TypeError, ValueError):
                continue
            items.append(
                ImmichAsset(
                    id=remote_id,
                    media_type=item['type'],
                    original_mime_type=(
                        item.get('originalMimeType')
                        if isinstance(item.get('originalMimeType'), str)
                        else None
                    ),
                )
            )
        try:
            next_page = int(next_page_raw) if next_page_raw is not None else None
        except (TypeError, ValueError) as exc:
            raise ImmichUnavailableError(
                'Immich returned an unexpected asset response'
            ) from exc
        return ImmichAssetPage(items=items, next_page=next_page)

    def get_asset(self, album_id: uuid.UUID, asset_id: uuid.UUID) -> ImmichAsset:
        page = self.search_assets(album_id, page=1, asset_id=asset_id)
        for asset in page.items:
            if asset.id == asset_id:
                return asset
        raise ImmichNotFoundError('Immich asset is not accessible in this album')

    def get_media_bytes(
        self,
        asset_id: uuid.UUID,
        *,
        size: str,
    ) -> tuple[bytes, str | None]:
        with self.open_media(asset_id, size=size, timeout=30) as stream:
            chunks: list[bytes] = []
            while chunk := stream.read():
                chunks.append(chunk)
            return b''.join(chunks), stream.content_type

    def open_media(
        self,
        asset_id: uuid.UUID,
        *,
        size: str,
        timeout: int,
    ) -> ImmichMediaStream:
        if size == 'original':
            path = f'/assets/{asset_id}/original'
            query = None
        elif size in {'thumbnail', 'preview', 'fullsize'}:
            path = f'/assets/{asset_id}/thumbnail'
            query = {'size': size}
        else:
            raise ValueError('Unsupported Immich media size')
        connection, response, deadline = self._request(
            'GET',
            path,
            query=query,
            timeout=timeout,
            redirect_asset_id=asset_id,
        )
        return ImmichMediaStream(connection, response, deadline)

    def _request_json(
        self,
        method: str,
        path: str,
        *,
        body: dict[str, Any] | None = None,
    ) -> Any:
        connection, response, deadline = self._request(
            method,
            path,
            body=body,
            timeout=30,
        )
        chunks: list[bytes] = []
        stream = ImmichMediaStream(connection, response, deadline)
        with stream:
            while chunk := stream.read():
                chunks.append(chunk)
        payload = b''.join(chunks)
        try:
            return json.loads(payload)
        except (json.JSONDecodeError, UnicodeDecodeError) as exc:
            raise ImmichUnavailableError('Immich returned an unexpected response') from exc

    def _request(
        self,
        method: str,
        path: str,
        *,
        body: dict[str, Any] | None = None,
        query: dict[str, str] | None = None,
        timeout: int,
        redirect_asset_id: uuid.UUID | None = None,
    ) -> tuple[http.client.HTTPConnection, http.client.HTTPResponse, float]:
        deadline = time.monotonic() + timeout
        target = f'{self.server.api_url}{path}'
        if query:
            target = f'{target}?{urlencode(query)}'
        encoded_body = json.dumps(body).encode('utf-8') if body is not None else None

        for redirect_count in range(4):
            parsed = urlsplit(target)
            connection = self._connection(deadline)
            headers = {
                'Accept': 'application/json',
                'Host': parsed.netloc,
                'User-Agent': f'OpenVoyage Immich/{IMMICH_SCHEMA_VERSION}',
                'x-api-key': self.api_key,
            }
            if encoded_body is not None:
                headers['Content-Type'] = 'application/json'
            request_target = parsed.path + (f'?{parsed.query}' if parsed.query else '')
            try:
                connection.request(method, request_target, body=encoded_body, headers=headers)
                response = connection.getresponse()
            except TimeoutError as exc:
                connection.close()
                raise ImmichTimeoutError('Immich request timed out') from exc
            except (OSError, http.client.HTTPException) as exc:
                connection.close()
                raise ImmichUnavailableError('Immich is unavailable') from exc

            if response.status in {301, 302, 303, 307, 308}:
                location = response.getheader('Location')
                response.close()
                connection.close()
                if redirect_asset_id is None or redirect_count >= 3 or not location:
                    raise ImmichUnavailableError('Immich returned an unsafe redirect')
                target = self._validated_redirect(target, location, redirect_asset_id)
                continue

            if 200 <= response.status < 300:
                return connection, response, deadline

            status = response.status
            response.close()
            connection.close()
            if status == 401:
                raise ImmichCredentialsError(
                    'Immich rejected the API key (HTTP 401); it may be invalid or revoked',
                    status=status,
                )
            if status == 403:
                raise ImmichCredentialsError(
                    'Immich denied the request (HTTP 403); the API key lacks permission '
                    'for this operation',
                    status=status,
                )
            if status == 404:
                raise ImmichNotFoundError('Immich resource was not found')
            if status == 408:
                raise ImmichTimeoutError('Immich request timed out')
            raise ImmichUnavailableError('Immich returned an unexpected response')

        raise ImmichUnavailableError('Immich returned too many redirects')

    def _connection(self, deadline: float) -> http.client.HTTPConnection:
        remaining = min(5.0, deadline - time.monotonic())
        if remaining <= 0:
            raise ImmichTimeoutError('Immich request timed out')
        address = self.server.addresses[0]
        if self.server.scheme == 'https':
            return _PinnedHTTPSConnection(
                self.server.host,
                self.server.port,
                address,
                remaining,
            )
        return _PinnedHTTPConnection(
            self.server.host,
            self.server.port,
            address,
            remaining,
        )

    def _validated_redirect(
        self,
        current_url: str,
        location: str,
        asset_id: uuid.UUID,
    ) -> str:
        target = urljoin(current_url, location)
        parsed = urlsplit(target)
        if urlunsplit((parsed.scheme, parsed.netloc, '', '', '')) != self.server.origin:
            raise ImmichUnavailableError('Immich returned an unsafe redirect')
        allowed_paths = {
            f'/api/assets/{asset_id}/thumbnail',
            f'/api/assets/{asset_id}/original',
        }
        if parsed.path not in allowed_paths or parsed.username or parsed.password or parsed.fragment:
            raise ImmichUnavailableError('Immich returned an unsafe redirect')
        return target
