"""Optional address and hotel search for stays, through our server.

The provider sees the server, never the traveller's browser. It receives the
search text and the stop's rough area (coordinates rounded to about a
kilometre), or the exact point of a dropped pin for reverse lookups.
"""

from __future__ import annotations

import json
import logging
import math
import threading
import time
from dataclasses import dataclass
from typing import Any, Protocol
from urllib.parse import urlencode, urlsplit
from urllib.request import Request, urlopen

from core.app_settings import (
    ADDRESS_SEARCH_GRAPHHOPPER_API_KEY,
    ADDRESS_SEARCH_GRAPHHOPPER_BASE_URL_KEY,
    ADDRESS_SEARCH_NOMINATIM_BASE_URL_KEY,
    ADDRESS_SEARCH_PHOTON_BASE_URL_KEY,
    ADDRESS_SEARCH_PROVIDER_KEY,
)
from core.version import APP_VERSION
from services.gps.geometry import haversine_meters

logger = logging.getLogger(__name__)

REQUEST_TIMEOUT_SECONDS = 5.0
MAX_RESPONSE_BYTES = 2 * 1024 * 1024
USER_AGENT = f'OpenVoyage/{APP_VERSION} (self-hosted travel blog; stay address search)'
PUBLIC_NOMINATIM_HOST = 'nominatim.openstreetmap.org'
# Rough area only: two decimals is about a kilometre.
NEAR_DECIMALS = 2
# Providers only use the stop as a hint; results this close come first.
NEAR_STOP_KM = 50


class AddressSearchOffError(Exception):
    """The admin hasn't switched on an address search provider."""


class AddressSearchUnavailableError(Exception):
    """The provider failed, or (public Nominatim) a request came too soon."""

    def __init__(self, message: str = 'Address search unavailable.', *, retry_soon: bool = False):
        super().__init__(message)
        self.retry_soon = retry_soon


@dataclass(frozen=True)
class AddressResult:
    name: str
    address: str | None
    latitude: float
    longitude: float


class AddressProvider(Protocol):
    def search(
        self, query: str, near: tuple[float, float] | None, limit: int
    ) -> list[AddressResult]: ...

    def reverse(self, latitude: float, longitude: float) -> AddressResult | None: ...


def fetch_json(url: str, headers: dict[str, str] | None = None) -> Any:
    """GET a JSON document. Tests replace this; they never call a provider."""
    request = Request(url, headers={'User-Agent': USER_AGENT, 'Accept': 'application/json', **(headers or {})})
    try:
        with urlopen(request, timeout=REQUEST_TIMEOUT_SECONDS) as response:  # noqa: S310 - admin-set URL
            body = response.read(MAX_RESPONSE_BYTES + 1)
    except Exception as exc:
        raise AddressSearchUnavailableError() from exc
    if len(body) > MAX_RESPONSE_BYTES:
        raise AddressSearchUnavailableError()
    try:
        return json.loads(body)
    except ValueError as exc:
        raise AddressSearchUnavailableError() from exc


def _rough(near: tuple[float, float] | None) -> tuple[float, float] | None:
    if near is None:
        return None
    return round(near[0], NEAR_DECIMALS), round(near[1], NEAR_DECIMALS)


def _join(*parts: object, separator: str = ' ') -> str:
    return separator.join(str(part).strip() for part in parts if part and str(part).strip())


def _result(
    name: object,
    *,
    street: object = None,
    housenumber: object = None,
    postcode: object = None,
    city: object = None,
    country: object = None,
    latitude: object,
    longitude: object,
) -> AddressResult | None:
    try:
        lat, lon = float(latitude), float(longitude)  # type: ignore[arg-type]
    except TypeError, ValueError:
        return None
    if not (math.isfinite(lat) and math.isfinite(lon) and -90 <= lat <= 90 and -180 <= lon <= 180):
        return None
    street_line = _join(street, housenumber)
    address = _join(street_line, _join(postcode, city), country, separator=', ') or None
    label = _join(name) or street_line or _join(city) or address
    if not label:
        return None
    return AddressResult(name=label[:255], address=address, latitude=lat, longitude=lon)


def _base(url: str) -> str:
    return url.rstrip('/')


class PhotonProvider:
    """Photon (komoot) or a self-hosted Photon. Searches as you type."""

    def __init__(self, base_url: str) -> None:
        self.base_url = _base(base_url)

    def search(self, query, near, limit):
        params: dict[str, object] = {'q': query, 'limit': limit}
        if (rough := _rough(near)) is not None:
            params.update(lat=rough[0], lon=rough[1])
        return self._results(fetch_json(f'{self.base_url}/api?{urlencode(params)}'))[:limit]

    def reverse(self, latitude, longitude):
        data = fetch_json(f'{self.base_url}/reverse?{urlencode({"lat": latitude, "lon": longitude, "limit": 1})}')
        results = self._results(data)
        return results[0] if results else None

    def _results(self, data: Any) -> list[AddressResult]:
        if not isinstance(data, dict) or not isinstance(data.get('features'), list):
            raise AddressSearchUnavailableError()
        results = []
        for feature in data['features']:
            if not isinstance(feature, dict):
                continue
            props = feature.get('properties') or {}
            coordinates = (feature.get('geometry') or {}).get('coordinates') or [None, None]
            if not isinstance(props, dict) or not isinstance(coordinates, list) or len(coordinates) < 2:
                continue
            result = _result(
                props.get('name'),
                street=props.get('street'),
                housenumber=props.get('housenumber'),
                postcode=props.get('postcode'),
                city=props.get('city') or props.get('town') or props.get('village'),
                country=props.get('country'),
                latitude=coordinates[1],
                longitude=coordinates[0],
            )
            if result:
                results.append(result)
        return results


class NominatimProvider:
    """Nominatim. The public server allows at most one request a second and no
    search-as-you-type, so the stay form searches on Enter only."""

    _lock = threading.Lock()
    _last_public_request = 0.0

    def __init__(self, base_url: str) -> None:
        self.base_url = _base(base_url)
        self.public = urlsplit(self.base_url).hostname == PUBLIC_NOMINATIM_HOST

    def search(self, query, near, limit):
        params: dict[str, object] = {
            'q': query, 'format': 'jsonv2', 'addressdetails': 1, 'limit': limit,
        }
        if (rough := _rough(near)) is not None:
            lat, lon = rough
            # Prefer results near the stop without excluding the rest.
            params['viewbox'] = f'{lon - 0.5},{lat + 0.5},{lon + 0.5},{lat - 0.5}'
        data = self._get(f'{self.base_url}/search?{urlencode(params)}')
        if not isinstance(data, list):
            raise AddressSearchUnavailableError()
        return [result for item in data if (result := self._parse(item))][:limit]

    def reverse(self, latitude, longitude):
        params = {'lat': latitude, 'lon': longitude, 'format': 'jsonv2', 'addressdetails': 1}
        data = self._get(f'{self.base_url}/reverse?{urlencode(params)}')
        if isinstance(data, dict) and 'error' in data:
            return None
        return self._parse(data)

    def _get(self, url: str) -> Any:
        if self.public:
            with NominatimProvider._lock:
                now = time.monotonic()
                if now - NominatimProvider._last_public_request < 1.0:
                    # Answer straight away instead of queueing behind the limit.
                    raise AddressSearchUnavailableError('Try again in a moment.', retry_soon=True)
                NominatimProvider._last_public_request = now
        return fetch_json(url)

    @staticmethod
    def _parse(item: Any) -> AddressResult | None:
        if not isinstance(item, dict):
            return None
        address = item.get('address') if isinstance(item.get('address'), dict) else {}
        return _result(
            item.get('name') or None,
            street=address.get('road') or address.get('pedestrian'),
            housenumber=address.get('house_number'),
            postcode=address.get('postcode'),
            city=address.get('city') or address.get('town') or address.get('village'),
            country=address.get('country'),
            latitude=item.get('lat'),
            longitude=item.get('lon'),
        )


class GraphHopperProvider:
    """GraphHopper's geocoding API, with its own key (not the routing key)."""

    def __init__(self, base_url: str, api_key: str) -> None:
        self.base_url = _base(base_url)
        self.api_key = api_key

    def search(self, query, near, limit):
        params: dict[str, object] = {'q': query, 'limit': limit, 'locale': 'en', 'key': self.api_key}
        if (rough := _rough(near)) is not None:
            params['point'] = f'{rough[0]},{rough[1]}'
        return self._results(fetch_json(f'{self.base_url}/geocode?{urlencode(params)}'))[:limit]

    def reverse(self, latitude, longitude):
        params = {'reverse': 'true', 'point': f'{latitude},{longitude}', 'limit': 1, 'locale': 'en', 'key': self.api_key}
        results = self._results(fetch_json(f'{self.base_url}/geocode?{urlencode(params)}'))
        return results[0] if results else None

    @staticmethod
    def _results(data: Any) -> list[AddressResult]:
        if not isinstance(data, dict) or not isinstance(data.get('hits'), list):
            raise AddressSearchUnavailableError()
        results = []
        for hit in data['hits']:
            if not isinstance(hit, dict):
                continue
            point = hit.get('point') or {}
            result = _result(
                hit.get('name'),
                street=hit.get('street'),
                housenumber=hit.get('housenumber'),
                postcode=hit.get('postcode'),
                city=hit.get('city'),
                country=hit.get('country'),
                latitude=point.get('lat') if isinstance(point, dict) else None,
                longitude=point.get('lng') if isinstance(point, dict) else None,
            )
            if result:
                results.append(result)
        return results


def near_stop_first(
    results: list[AddressResult], near: tuple[float, float] | None
) -> list[AddressResult]:
    """Results near the stop first, each group in the provider's own order."""
    if near is None:
        return results
    return sorted(
        results,
        key=lambda result: haversine_meters(near[0], near[1], result.latitude, result.longitude)
        > NEAR_STOP_KM * 1000,
    )


def address_provider(app_settings) -> AddressProvider:
    """The configured provider. Raises when search is off or can't be set up."""
    try:
        name = app_settings.get_value(ADDRESS_SEARCH_PROVIDER_KEY)
        if name in (None, 'none'):
            raise AddressSearchOffError()
        if name == 'photon':
            return PhotonProvider(app_settings.get_value(ADDRESS_SEARCH_PHOTON_BASE_URL_KEY))
        if name == 'nominatim':
            return NominatimProvider(app_settings.get_value(ADDRESS_SEARCH_NOMINATIM_BASE_URL_KEY))
        if name == 'graphhopper':
            api_key = app_settings.get_value(ADDRESS_SEARCH_GRAPHHOPPER_API_KEY)
            if not api_key:
                raise AddressSearchUnavailableError()
            return GraphHopperProvider(
                app_settings.get_value(ADDRESS_SEARCH_GRAPHHOPPER_BASE_URL_KEY), api_key
            )
    except (AddressSearchOffError, AddressSearchUnavailableError):
        raise
    except Exception as exc:  # unreadable stored settings
        logger.error('address_search_settings_unreadable')
        raise AddressSearchUnavailableError() from exc
    raise AddressSearchOffError()
