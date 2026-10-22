"""Pure geometry, input binding and transport inference helpers."""

import hashlib
import json
import math
from datetime import datetime

from models.api.geojson import GeoJsonLineString
from models.api.planning import ConnectionIntent, Endpoint
from fastapi import HTTPException


def select_route(result: dict | None, option: int, segment_id=None) -> dict | None:
    """Resolve a selection against the original, stable option order."""
    if not option:
        return result
    if result is None or option > len(result.get('alternatives', [])):
        raise HTTPException(
            409,
            detail={
                'code': 'PREVIEW_EXPIRED',
                'message': 'Recalculate routes before selecting this alternative',
                'segment_id': str(segment_id) if segment_id else None,
            },
        )
    return result | result['alternatives'][option - 1]


def fingerprint(value) -> str:
    return hashlib.sha256(
        json.dumps(value, sort_keys=True, default=str, separators=(',', ':')).encode()
    ).hexdigest()


def draft_hash(intent: ConnectionIntent) -> str:
    return fingerprint(
        intent.model_dump(
            mode='json',
            by_alias=True,
            exclude={
                'preview_id': True,
                'notes': True,
                'segments': {'__all__': {'route_option', 'mode_selected', 'notes'}},
            },
        )
    )


def validated_geometry(value):
    geometry = GeoJsonLineString.model_validate(value).model_dump(mode='json')
    if any(
        not math.isfinite(lon)
        or not math.isfinite(lat)
        or not -180 <= lon <= 180
        or not -90 <= lat <= 90
        for lon, lat in geometry['coordinates']
    ):
        raise ValueError('Route geometry coordinates are invalid')
    return geometry


def route_values(result):
    values = {key: value for key, value in result.items() if key != 'alternatives'}
    if isinstance(values.get('generated_at'), str):
        values['generated_at'] = datetime.fromisoformat(values['generated_at'])
    return values


def default_mode(start, end, car_seconds=None, no_road=False) -> str:
    lat1, lat2 = math.radians(start.latitude), math.radians(end.latitude)
    dlat, dlon = lat2 - lat1, math.radians(end.longitude - start.longitude)
    h = (
        math.sin(dlat / 2) ** 2
        + math.cos(lat1) * math.cos(lat2) * math.sin(dlon / 2) ** 2
    )
    km = 6371.0088 * 2 * math.asin(math.sqrt(min(1, max(0, h))))
    return (
        'FLIGHT'
        if km >= 1000 or (car_seconds is not None and car_seconds >= 43200) or no_road
        else 'CAR'
    )


def same_endpoint(a: Endpoint | None, b: Endpoint | None) -> bool:
    if a is None or b is None:
        return False
    if a.place_id and a.place_id == b.place_id:
        return True
    for code in ('icao_code', 'iata_code'):
        left, right = getattr(a, code), getattr(b, code)
        if left and right:
            return left.upper() == right.upper()
    if a.place_id and b.place_id and a.place_id != b.place_id:
        return False
    return (a.latitude, a.longitude) == (b.latitude, b.longitude)


def point_geometry(a, b, via=None):
    if a is None or b is None:
        return None
    return {
        'type': 'LineString',
        'coordinates': [
            [p.longitude, p.latitude] for p in (a, via, b) if p is not None
        ],
    }
