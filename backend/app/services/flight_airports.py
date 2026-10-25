"""Resolve trusted flight-provider airport snapshots to existing airport places."""

from sqlalchemy import or_, select
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from models.database.places import Place
from models.api.planning import Endpoint, FlightLookup


def lookup_airport_endpoint(db, code: str) -> Endpoint | None:
    """Return one complete local airport by exact IATA/ICAO code, or allow fallback."""
    matches = list(db.scalars(
        select(Place).where(
            Place.feature_class == 'S',
            Place.feature_code == 'AIRP',
            or_(Place.iata_code == code, Place.icao_code == code),
        ).limit(2)
    ))
    if len(matches) != 1:
        return None
    place = matches[0]
    if not place.timezone:
        return None
    try:
        ZoneInfo(place.timezone)
        return Endpoint(
            latitude=place.latitude,
            longitude=place.longitude,
            name=place.name,
            place_id=place.id,
            iata_code=place.iata_code,
            icao_code=place.icao_code,
            timezone=place.timezone,
        )
    except ValueError, TypeError, ZoneInfoNotFoundError:
        return None


def resolve_flight_airport(db, endpoint):
    if endpoint is None:
        return None
    references = []
    if endpoint.place_id:
        references.append(Place.id == endpoint.place_id)
    if endpoint.iata_code:
        references.append(Place.iata_code == endpoint.iata_code.upper())
    if endpoint.icao_code:
        references.append(Place.icao_code == endpoint.icao_code.upper())
    if not references:
        return None
    matches = list(
        db.scalars(
            select(Place).where(Place.feature_class == 'S', Place.feature_code == 'AIRP', or_(*references)).limit(2)
        )
    )
    return matches[0] if len(matches) == 1 else None


def resolve_flight_lookup_airports(db, lookup: FlightLookup) -> FlightLookup:
    airports = {}
    for side in ('departure_airport', 'arrival_airport'):
        endpoint = getattr(lookup, side)
        place = resolve_flight_airport(db, endpoint)
        if place:
            airports[side] = endpoint.model_copy(update={'place_id': place.id})
    return lookup.model_copy(update=airports)
