"""Optional AeroDataBox adapter. Credentials and raw responses never leave the server."""

import json
import math
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from pydantic import ValidationError

from services.flight_providers.flight_provider import (
    FlightMovement,
    FlightProviderBase,
    FlightUnavailable,
)

from models.api.planning import (
    Endpoint,
    FlightLookup,
    FlightLookupRequest,
    normalize_flight_number,
)


def airport_snapshot(data: dict) -> Endpoint:
    if not isinstance(data, dict):
        raise ValueError('Invalid airport')
    location = data.get('location') or {}
    if not isinstance(location, dict):
        location = {}
    return Endpoint(
        latitude=location.get('lat'),
        longitude=location.get('lon'),
        name=data.get('name', ''),
        iata_code=data.get('iata'),
        icao_code=data.get('icao'),
        timezone=data.get('timeZone'),
    )


def movement_instant(movement: dict, field='scheduledTime'):
    if not isinstance(movement, dict):
        return None
    times = movement.get(field) or {}
    if not isinstance(times, dict):
        return None
    for key in ('local', 'utc'):
        value = times.get(key)
        if not isinstance(value, str):
            continue
        try:
            instant = datetime.fromisoformat(value.replace('Z', '+00:00'))
        except ValueError:
            continue
        if instant.tzinfo is not None and instant.utcoffset() is not None:
            return instant
    return None


def parse_flights(payload: object, intent: FlightLookupRequest) -> list[FlightLookup]:
    if not isinstance(payload, list):
        raise FlightUnavailable('Invalid flight provider response')
    results = []
    for raw in payload[:100]:
        if not isinstance(raw, dict):
            continue
        try:
            if normalize_flight_number(raw.get('number')) != intent.flight_number:
                continue
            departure, arrival = raw['departure'], raw['arrival']
            start, end = (
                airport_snapshot(departure['airport']),
                airport_snapshot(arrival['airport']),
            )
            dep, arr = movement_instant(departure), movement_instant(arrival)
            if dep:
                local_dep = dep
                if start.timezone:
                    try:
                        local_dep = dep.astimezone(ZoneInfo(start.timezone))
                    except ZoneInfoNotFoundError:
                        pass
                elif (departure.get('scheduledTime') or {}).get('local'):
                    local_text = departure['scheduledTime']['local']
                    if datetime.fromisoformat(local_text).tzinfo is not None:
                        local_dep = datetime.fromisoformat(local_text)
                if local_dep.date() != intent.departure_date:
                    continue
            lookup = FlightLookup(
                flight_number=intent.flight_number,
                provider='aerodatabox',
                departure_date=intent.departure_date,
                fetched_at=datetime.now(timezone.utc),
                airline_name=(raw.get('airline') or {}).get('name'),
                departure_airport=start,
                arrival_airport=end,
                scheduled_departure=dep,
                scheduled_arrival=arr,
            )
            results.append(lookup)
        except KeyError, TypeError, ValueError, ValidationError:
            continue
    return results


class AeroDataBoxFlightProvider(FlightProviderBase):
    name = 'aerodatabox'

    def __init__(self, *, api_key: str | None, base_url: str, rapidapi_host: str):
        self._api_key = (api_key or '').strip()
        self.base_url = base_url.rstrip('/')
        self.rapidapi_host = rapidapi_host

    def is_configured(self) -> bool:
        return bool(self._api_key)

    def lookup(
        self, intent: FlightLookupRequest, *, timeout: float = 10
    ) -> list[FlightLookup]:
        return parse_flights(self._request(intent, timeout=timeout), intent)

    def track(
        self, intent: FlightLookupRequest, *, timeout: float = 10
    ) -> list[FlightMovement]:
        return parse_movements(
            self._request(intent, timeout=timeout), intent, datetime.now(timezone.utc)
        )

    def _request(self, intent, *, timeout):
        if not self.is_configured():
            raise FlightUnavailable(
                'Flight lookup is not configured', result='CONFIGURATION_ERROR'
            )
        query = urlencode(
            {
                'dateLocalRole': 'Departure',
                'withLocation': 'false',
                'withAircraftImage': 'false',
                'withFlightPlan': 'false',
            }
        )
        request = Request(
            f'{self.base_url}/flights/number/{intent.flight_number}/{intent.departure_date}?{query}',
            headers={
                'X-RapidAPI-Key': self._api_key,
                'X-RapidAPI-Host': self.rapidapi_host,
            },
        )
        try:
            with urlopen(request, timeout=min(10, timeout)) as response:
                if response.status == 204:
                    return []
                body = response.read(2_000_001)
                if len(body) > 2_000_000:
                    raise FlightUnavailable('Invalid flight provider response')
                return json.loads(body)
        except HTTPError as exc:
            if exc.code == 404:
                return []
            seconds = retry_after_seconds(exc.headers or {}, datetime.now(timezone.utc))
            raise FlightUnavailable(
                'Flight provider request limit reached.'
                if exc.code == 429
                else 'Flight lookup unavailable',
                seconds if seconds is not None else (2700 if exc.code == 429 else None),
                result='RATE_LIMITED'
                if exc.code == 429
                else 'CONFIGURATION_ERROR'
                if exc.code in (401, 403)
                else 'UNAVAILABLE',
            ) from None
        except URLError, TimeoutError, OSError, ValueError:
            raise FlightUnavailable('Flight lookup unavailable') from None


STATUS_MAP = {
    'Expected': 'SCHEDULED',
    'CheckIn': 'CHECK_IN',
    'Boarding': 'BOARDING',
    'GateClosed': 'GATE_CLOSED',
    'Delayed': 'DELAYED',
    'Departed': 'IN_FLIGHT',
    'EnRoute': 'IN_FLIGHT',
    'Approaching': 'IN_FLIGHT',
    'Arrived': 'ARRIVED',
    'Canceled': 'CANCELLED',
    'Diverted': 'DIVERTED',
}


def _tracking_times(movement, confirmed, observed_at, *, after=None):
    candidates = [
        movement_instant(movement, key) for key in ('runwayTime', 'revisedTime')
    ]
    actual = next(
        (
            value
            for value in candidates
            if confirmed
            and value
            and value <= observed_at
            and (after is None or value > after)
        ),
        None,
    )
    estimated = next(
        (
            value
            for value in [*candidates, movement_instant(movement, 'predictedTime')]
            if value and (after is None or value > after)
        ),
        None,
    )
    return actual, estimated if actual is None else None


def parse_movements(payload, intent, observed_at):
    """Track even when a diversion has no usable arrival airport or timing."""
    if not isinstance(payload, list):
        raise FlightUnavailable('Invalid flight provider response')
    results = []
    for raw in payload[:100]:
        if not isinstance(raw, dict):
            continue
        try:
            if normalize_flight_number(raw.get('number')) != intent.flight_number:
                continue
            dep, arr = raw.get('departure') or {}, raw.get('arrival') or {}
            if not isinstance(dep, dict):
                continue
            if not isinstance(arr, dict):
                arr = {}
            scheduled = movement_instant(dep)
            start = airport_snapshot(dep.get('airport') or {})
            if scheduled is None or not start.timezone:
                continue
            if (
                scheduled.astimezone(ZoneInfo(start.timezone)).date()
                != intent.departure_date
            ):
                continue
        except TypeError, ValueError, ZoneInfoNotFoundError:
            continue
        try:
            landing = airport_snapshot(arr.get('airport') or {})
        except TypeError, ValueError:
            landing = None
        raw_status = raw.get('status')
        status = (
            STATUS_MAP.get(raw_status, 'UNKNOWN')
            if isinstance(raw_status, str)
            else 'UNKNOWN'
        )
        departed = status in ('IN_FLIGHT', 'ARRIVED')
        arrived = status == 'ARRIVED'
        actual_dep, estimated_dep = _tracking_times(dep, departed, observed_at)
        actual_arr, estimated_arr = _tracking_times(
            arr, arrived, observed_at, after=actual_dep
        )
        results.append(
            FlightMovement(
                scheduled_departure=scheduled,
                departure_airport=start,
                status=status,
                departure_confirmed=departed,
                arrival_confirmed=arrived,
                actual_departure=actual_dep,
                actual_arrival=actual_arr,
                estimated_departure=estimated_dep,
                estimated_arrival=estimated_arr,
                landing_airport=landing if status in ('ARRIVED', 'DIVERTED') else None,
                diverted=status == 'DIVERTED',
            )
        )
    return results


def retry_after_seconds(headers, observed_at):
    """Respect Retry-After and RapidAPI's duration/epoch reset headers."""
    headers = {key.lower(): str(value).strip() for key, value in headers.items()}
    delays = []
    retry = headers.get('retry-after', '')
    if retry.isdigit():
        delays.append(int(retry))
    elif retry:
        try:
            delays.append(
                max(
                    0,
                    math.ceil(
                        (parsedate_to_datetime(retry) - observed_at).total_seconds()
                    ),
                )
            )
        except ValueError, TypeError, OverflowError:
            pass
    for key in ('x-ratelimit-reset', 'x-ratelimit-requests-reset'):
        try:
            reset = float(headers[key])
        except KeyError, ValueError, TypeError:
            continue
        if math.isfinite(reset) and reset >= 0:
            delays.append(
                max(
                    0,
                    math.ceil(
                        reset - observed_at.timestamp()
                        if reset >= 1_000_000_000
                        else reset
                    ),
                )
            )
    return max(delays) if delays else None
