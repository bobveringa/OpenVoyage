"""FlightAware AeroAPI v4 schedules and confirmed flight movements."""

import json
import re
from collections.abc import Callable
from datetime import datetime, time, timedelta, timezone
from time import monotonic
from threading import Lock
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urlencode
from urllib.request import Request, urlopen
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from models.api.planning import (
    Endpoint,
    FlightLookup,
    FlightLookupRequest,
    normalize_flight_number,
)
from services.flight_providers.aerodatabox_flight_provider import retry_after_seconds
from services.flight_providers.flight_provider import (
    FlightMovement,
    FlightProviderBase,
    FlightUnavailable,
)

DEFAULT_BASE_URL = 'https://aeroapi.flightaware.com/aeroapi'
# Public airport metadata survives per-job adapter construction. Flight facts and
# credentials are never cached here; custom API destinations have separate entries.
_AIRPORT_CACHE = {}
_AIRPORT_CACHE_LOCK = Lock()


def instant(raw, *fields):
    for field in fields:
        value = raw.get(field)
        if isinstance(value, str):
            try:
                result = datetime.fromisoformat(value.replace('Z', '+00:00'))
                if result.tzinfo is not None and result.utcoffset() is not None:
                    return result
            except ValueError:
                pass
    return None


def matches(raw, number):
    identifiers = [raw.get(key) for key in ('ident', 'ident_iata', 'ident_icao')]
    for field in ('codeshares', 'codeshares_iata'):
        if isinstance(raw.get(field), list):
            identifiers.extend(raw[field])
    for value in identifiers:
        if not isinstance(value, str):
            continue
        try:
            if normalize_flight_number(value) == number:
                return True
        except ValueError:
            pass
    return False


class FlightAwareFlightProvider(FlightProviderBase):
    name = 'flightaware'

    def __init__(
        self, *, api_key: str | None, base_url: str = DEFAULT_BASE_URL,
        airport_resolver: Callable[[str], Endpoint | None] | None = None,
    ):
        self._api_key = (api_key or '').strip()
        self.base_url = base_url.rstrip('/')
        self._airport_resolver = airport_resolver

    def is_configured(self) -> bool:
        return bool(self._api_key)

    def _request(self, path, deadline, params=None):
        if not self.is_configured():
            raise FlightUnavailable(
                'Flight lookup is not configured', result='CONFIGURATION_ERROR'
            )
        remaining = deadline - monotonic()
        if remaining <= 0:
            raise FlightUnavailable('Flight lookup unavailable')
        query = '?' + urlencode(params) if params else ''
        request = Request(
            self.base_url + path + query,
            headers={'x-apikey': self._api_key, 'Accept': 'application/json'},
        )
        try:
            with urlopen(request, timeout=remaining) as response:
                if response.status == 204:
                    return None
                body = response.read(2_000_001)
                if len(body) > 2_000_000:
                    raise FlightUnavailable('Invalid flight provider response')
                return json.loads(body)
        except HTTPError as exc:
            if exc.code == 404:
                return None
            delay = retry_after_seconds(exc.headers or {}, datetime.now(timezone.utc))
            raise FlightUnavailable(
                'Flight provider request limit reached.'
                if exc.code == 429
                else 'Flight lookup unavailable',
                delay if delay is not None else (2700 if exc.code == 429 else None),
                result='RATE_LIMITED'
                if exc.code == 429
                else 'CONFIGURATION_ERROR'
                if exc.code in (401, 403)
                else 'UNAVAILABLE',
            ) from None
        except URLError, TimeoutError, OSError, ValueError:
            raise FlightUnavailable('Flight lookup unavailable') from None

    def _airport(self, raw, side, airports, deadline):
        reference = raw.get(side)
        if isinstance(reference, str):  # /schedules uses airport codes, not objects.
            reference = {
                'code': reference,
                'code_icao': raw.get(side + '_icao'),
                'code_iata': raw.get(side + '_iata'),
            }
        if not isinstance(reference, dict):
            raise ValueError('Invalid airport')
        code = (
            reference.get('code_icao')
            or reference.get('code_iata')
            or reference.get('code')
        )
        if not isinstance(code, str) or not re.fullmatch(r'[A-Z0-9]{3,4}', code):
            raise ValueError('Invalid airport code')
        if code not in airports:
            # Bound supplementary requests as well as the flights response.
            if len(airports) >= 8:
                raise FlightUnavailable('Too many flight airport candidates')
            # Local places take precedence, even over cached remote metadata.
            # Keep place identities scoped to this operation, not the global cache.
            local = self._airport_resolver(code) if self._airport_resolver else None
            if local is not None:
                local = local.model_copy(update={
                    'iata_code': local.iata_code or reference.get('code_iata'),
                    'icao_code': local.icao_code or reference.get('code_icao'),
                })
                airports[code] = local
                return local
            with _AIRPORT_CACHE_LOCK:
                cached = _AIRPORT_CACHE.get((self.base_url, code))
            if cached and cached[0] > monotonic():
                airports[code] = cached[1]
            else:
                airports[code] = self._request(
                    '/airports/' + quote(code, safe=''), deadline
                )
        details = airports[code]
        if isinstance(details, Endpoint):
            return details
        if not isinstance(details, dict):
            raise ValueError('Invalid airport details')
        endpoint = Endpoint(
            latitude=details.get('latitude'),
            longitude=details.get('longitude'),
            name=reference.get('name') or details.get('name') or '',
            iata_code=reference.get('code_iata') or details.get('code_iata'),
            icao_code=reference.get('code_icao') or details.get('code_icao'),
            timezone=reference.get('timezone') or details.get('timezone'),
        )
        cache_key = (self.base_url, code)
        with _AIRPORT_CACHE_LOCK:
            if cache_key not in _AIRPORT_CACHE or _AIRPORT_CACHE[cache_key][1] is not details:
                if len(_AIRPORT_CACHE) >= 256:
                    _AIRPORT_CACHE.pop(next(iter(_AIRPORT_CACHE)))
                _AIRPORT_CACHE[cache_key] = (monotonic() + 6 * 3600, details)
        return endpoint

    def _flights(self, intent, deadline, *, schedules=False):
        now = datetime.now(timezone.utc)
        start = datetime.combine(
            intent.departure_date, time(), timezone.utc
        ) - timedelta(hours=14)
        end = start + timedelta(hours=50)
        params = {'max_pages': 1}
        collection = 'flights'
        if schedules:
            # IATA codes may contain a digit (W6); ICAO airline codes are letters.
            parts = re.fullmatch(
                r'([A-Z]{3}|[A-Z0-9]{2})([0-9]{1,4})', intent.flight_number
            )
            if not parts:
                return []
            params.update(airline=parts[1], flight_number=parts[2])
            path = f'/schedules/{start.isoformat()}/{end.isoformat()}'
            collection = 'scheduled'
        else:
            history = start < now - timedelta(days=9)
            path = (
                ('/history' if history else '')
                + '/flights/'
                + quote(intent.flight_number, safe='')
            )
            params.update(
                ident_type='designator', start=start.isoformat(), end=end.isoformat()
            )
            if not history:
                params['end'] = min(
                    end, now + timedelta(days=2, seconds=-1)
                ).isoformat()
        payload = self._request(path, deadline, params)
        if payload is None:
            return []
        if not isinstance(payload, dict) or not isinstance(
            payload.get(collection), list
        ):
            raise FlightUnavailable('Invalid flight provider response')
        return [
            raw
            for raw in payload[collection][:100]
            if isinstance(raw, dict) and matches(raw, intent.flight_number)
        ]

    def _departures(self, intent, deadline, *, schedules=False):
        airports = {}
        for raw in self._flights(intent, deadline, schedules=schedules):
            scheduled = instant(raw, 'scheduled_out', 'scheduled_off')
            if scheduled is None:
                continue
            reference = raw.get('origin')
            try:
                if isinstance(reference, dict) and reference.get('timezone'):
                    if (
                        scheduled.astimezone(ZoneInfo(reference['timezone'])).date()
                        != intent.departure_date
                    ):
                        continue
                origin = self._airport(raw, 'origin', airports, deadline)
                if (
                    not origin.timezone
                    or scheduled.astimezone(ZoneInfo(origin.timezone)).date()
                    != intent.departure_date
                ):
                    continue
            except TypeError, ValueError, ZoneInfoNotFoundError:
                continue
            yield raw, scheduled, origin, airports

    def lookup(
        self, intent: FlightLookupRequest, *, timeout: float = 10
    ) -> list[FlightLookup]:
        deadline = monotonic() + min(timeout, 10)
        schedules = intent.departure_date > datetime.now(
            timezone.utc
        ).date() + timedelta(days=1)
        results = []
        seen = set()
        for raw, scheduled, origin, airports in self._departures(
            intent, deadline, schedules=schedules
        ):
            try:
                destination = self._airport(raw, 'destination', airports, deadline)
                key = (
                    scheduled,
                    origin.icao_code or origin.iata_code,
                    destination.icao_code or destination.iata_code,
                )
                if key in seen:
                    continue
                results.append(
                    FlightLookup(
                        flight_number=intent.flight_number,
                        departure_date=intent.departure_date,
                        provider=self.name,
                        fetched_at=datetime.now(timezone.utc),
                        departure_airport=origin,
                        arrival_airport=destination,
                        scheduled_departure=scheduled,
                        scheduled_arrival=instant(raw, 'scheduled_in', 'scheduled_on'),
                    )
                )
                seen.add(key)
            except TypeError, ValueError:
                continue
        return results

    def track(
        self, intent: FlightLookupRequest, *, timeout: float = 10
    ) -> list[FlightMovement]:
        deadline = monotonic() + min(timeout, 10)
        observed = datetime.now(timezone.utc)
        results = []
        for raw, scheduled, origin, airports in self._departures(intent, deadline):
            # Gate-out is taxiing; only runway-off confirms airborne movement.
            departure = instant(raw, 'actual_off')
            arrival = instant(raw, 'actual_on', 'actual_in')
            departure = departure if departure and departure <= observed else None
            arrival = (
                arrival
                if arrival
                and arrival <= observed
                and (departure is None or arrival > departure)
                else None
            )
            diverted = raw.get('diverted') is True
            delay = raw.get('departure_delay')
            status = (
                'CANCELLED'
                if raw.get('cancelled') is True
                else 'DIVERTED'
                if diverted
                else 'ARRIVED'
                if arrival
                else 'IN_FLIGHT'
                if departure
                else 'DELAYED'
                if isinstance(delay, int | float) and delay > 0
                else 'SCHEDULED'
            )
            landing = None
            if arrival or diverted:
                try:
                    landing = self._airport(raw, 'destination', airports, deadline)
                except TypeError, ValueError:
                    pass
            results.append(
                FlightMovement(
                    scheduled_departure=scheduled,
                    departure_airport=origin,
                    status=status,
                    departure_confirmed=bool(departure or arrival),
                    arrival_confirmed=bool(arrival),
                    actual_departure=departure,
                    actual_arrival=arrival,
                    estimated_departure=None
                    if departure
                    else instant(raw, 'estimated_off', 'estimated_out'),
                    estimated_arrival=None
                    if arrival
                    else instant(raw, 'estimated_on', 'estimated_in'),
                    landing_airport=landing,
                    diverted=diverted,
                )
            )
        return results
