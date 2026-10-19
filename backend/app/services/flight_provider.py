"""Optional AeroDataBox adapter. Credentials and raw responses never leave the server."""

import json
from datetime import datetime, timezone
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from pydantic import ValidationError

from models.api.planning import (
    Endpoint,
    FlightLookup,
    FlightLookupRequest,
    normalize_flight_number,
)


class FlightUnavailable(Exception):
    def __init__(self, reason='Flight lookup unavailable', retry_after_seconds=None):
        self.reason = reason
        self.retry_after_seconds = retry_after_seconds


def airport_snapshot(data: dict) -> Endpoint:
    location = data.get('location') or {}
    return Endpoint(
        latitude=location.get('lat'),
        longitude=location.get('lon'),
        name=data.get('name', ''),
        iata_code=data.get('iata'),
        icao_code=data.get('icao'),
        timezone=data.get('timeZone'),
    )


def scheduled_instant(movement: dict):
    times = movement.get('scheduledTime') or {}
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
            dep, arr = scheduled_instant(departure), scheduled_instant(arrival)
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


class FlightProvider:
    def __init__(self, api_key: str | None):
        self._api_key = api_key or ''

    def lookup(
        self, intent: FlightLookupRequest, *, timeout: float = 10
    ) -> list[FlightLookup]:
        if not self._api_key:
            raise FlightUnavailable('Flight lookup is not configured')
        query = urlencode(
            {
                'dateLocalRole': 'Departure',
                'withLocation': 'false',
                'withAircraftImage': 'false',
                'withFlightPlan': 'false',
            }
        )
        request = Request(
            f'https://aerodatabox.p.rapidapi.com/flights/number/{intent.flight_number}/{intent.departure_date}?{query}',
            headers={
                'X-RapidAPI-Key': self._api_key,
                'X-RapidAPI-Host': 'aerodatabox.p.rapidapi.com',
            },
        )
        try:
            with urlopen(request, timeout=min(10, timeout)) as response:
                if response.status == 204:
                    return []
                body = response.read(2_000_001)
                if len(body) > 2_000_000:
                    raise FlightUnavailable('Invalid flight provider response')
                return parse_flights(json.loads(body), intent)
        except HTTPError as exc:
            if exc.code == 404:
                return []
            retry = exc.headers.get('Retry-After', '')
            raise FlightUnavailable(
                'Flight lookup limit reached'
                if exc.code == 429
                else 'Flight lookup unavailable',
                int(retry) if retry.isdigit() else None,
            ) from None
        except URLError, TimeoutError, OSError, ValueError:
            raise FlightUnavailable('Flight lookup unavailable') from None
