"""Server-owned travel intent, endpoint resolution and bounded explicit calculations."""

import hashlib
import json
import math
import threading
import time
import uuid
from collections import OrderedDict
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

from fastapi import HTTPException
from pydantic import ValidationError
from sqlalchemy import select

from models.api.geojson import GeoJsonLineString
from models.api.planning import (
    ROAD_MODES,
    ConnectionIntent,
    Endpoint,
    ExistingLocationInput,
    FlightCandidate,
    FlightIntent,
    FlightLookup,
    FlightLookupResponse,
    SegmentIntent,
    SegmentResponse,
)
from models.api.locations import LocationPlaceInput
from models.database.base import utcnow
from models.database.itinerary import (
    ItineraryPlanningArtifact,
    ItinerarySegmentFlight,
    ItinerarySegmentRoute,
    ItineraryTravelSegment,
)
from models.database.locations import Location
from models.database.places import Place
from models.database.travel import TravelMode
from services.connection_endpoints import endpoint_location, endpoint_identity
from services.flight_providers import DisabledFlightProvider, FlightProviderBase
from services.route_providers.route_provider import (
    RouteProviderError,
    RouteProviderLimitError,
)


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


@dataclass
class ResolvedSegment:
    intent: SegmentIntent
    id: uuid.UUID
    source: str
    version: int
    start: Endpoint | None
    end: Endpoint | None
    via: Endpoint | None
    lookup: FlightLookup | None
    lookup_owner: uuid.UUID | None
    result: dict | None
    input_hash: str = ''


class CalculationGate:
    """Bound per-process abuse and coalesce duplicate requests without retaining DB sessions."""

    def __init__(self):
        self.lock = threading.Lock()
        self.active = set()
        self.recent = OrderedDict()

    def enter(self, actor, trip, key):
        now = time.monotonic()
        scope = (actor, trip)
        with self.lock:
            for old in list(self.recent):
                if now - self.recent[old][0] > 60:
                    del self.recent[old]
            entry = self.recent.get(scope, (now, 0))
            if scope in self.active or entry[1] >= 20:
                raise HTTPException(
                    429, 'Calculation busy or limit reached. Try again later.'
                )
            self.active.add(scope)
            self.recent[scope] = (entry[0], entry[1] + 1)
            while len(self.recent) > 10000:
                self.recent.popitem(last=False)

    def leave(self, actor, trip):
        with self.lock:
            self.active.discard((actor, trip))


calculation_gate = CalculationGate()


class PlanningService:
    def __init__(
        self,
        db,
        location_service,
        route_provider=None,
        flight_provider: FlightProviderBase | None = None,
    ):
        self.db = db
        self.locations = location_service
        self.provider = route_provider
        self.flights = (
            flight_provider if flight_provider is not None else DisabledFlightProvider()
        )

    def infer_mode(self, start, end, trip_id):
        direct_car_hash = fingerprint(
            {
                'mode': 'CAR',
                'flight': None,
                'schedule': None,
                'points': [
                    (start.longitude, start.latitude),
                    None,
                    (end.longitude, end.latitude),
                ],
            }
        )
        estimate = self.db.scalar(
            select(ItinerarySegmentRoute.duration_seconds)
            .where(
                ItinerarySegmentRoute.trip_id == trip_id,
                ItinerarySegmentRoute.input_hash == direct_car_hash,
                ItinerarySegmentRoute.status == 'READY',
            )
            .order_by(ItinerarySegmentRoute.generated_at.desc())
            .limit(1)
        )
        return default_mode(start, end, car_seconds=estimate)

    def endpoint(self, value, trip_id=None):
        if value is None:
            return None
        if isinstance(value, ExistingLocationInput):
            row = self.db.get(Location, value.location_id)
            if row is None or row.trip_id != trip_id:
                raise HTTPException(422, 'Location does not belong to this trip')
            return self.location_endpoint(row)
        if isinstance(value, LocationPlaceInput):
            row = self.db.get(Place, value.place_id)
            if row is None:
                raise HTTPException(422, 'Place not found')
            return self.place_endpoint(row)
        return Endpoint(latitude=value.latitude, longitude=value.longitude)

    def place_endpoint(self, place):
        return Endpoint(
            place_id=place.id,
            latitude=place.latitude,
            longitude=place.longitude,
            name=place.name,
            iata_code=place.iata_code,
            icao_code=place.icao_code,
            timezone=place.timezone,
        )

    def location_endpoint(self, location):
        endpoint = Endpoint(
            latitude=location.latitude,
            longitude=location.longitude,
            name=location.name,
            place_id=location.source_place_id,
        )
        if location.source_place_id:
            place = self.db.get(Place, location.source_place_id)
            if place:
                endpoint.iata_code, endpoint.icao_code = (
                    place.iata_code,
                    place.icao_code,
                )
                endpoint.timezone = place.timezone
        return endpoint

    def airport(self, place_id):
        if not place_id:
            return None
        place = self.db.get(Place, place_id)
        if place is None or place.feature_class != 'S' or place.feature_code != 'AIRP':
            raise HTTPException(422, 'Choose an airport place')
        return self.place_endpoint(place)

    def saved_intent(self, leg):
        items = []
        for row in leg.segments:
            flight = None
            if row.flight:
                flight = FlightIntent(
                    **{
                        key: getattr(row.flight, key)
                        for key in (
                            'flight_number',
                            'departure_date',
                            'departure_airport_place_id',
                            'arrival_airport_place_id',
                            'airline_name',
                        )
                    }
                )
            items.append(
                SegmentIntent(
                    id=row.id,
                    travel_mode=row.travel_mode,
                    notes=row.notes or '',
                    from_=ExistingLocationInput(location_id=row.from_location_id)
                    if row.from_location_id
                    else None,
                    to=ExistingLocationInput(location_id=row.to_location_id)
                    if row.to_location_id
                    else None,
                    via=ExistingLocationInput(location_id=row.via_location_id)
                    if row.via_location_id
                    else None,
                    flight=flight,
                    service_company=row.service_company,
                    service_number=row.service_number,
                )
            )
        return ConnectionIntent(notes=leg.notes, segments=items)

    def artifact(self, artifact_id, kind, leg, actor, revision=None, binding=None):
        row = self.db.get(ItineraryPlanningArtifact, artifact_id)
        if (
            row is None
            or row.kind != kind
            or row.trip_id != leg.trip_id
            or row.leg_id != getattr(leg, 'artifact_leg_id', leg.id)
            or row.created_by_user_id != actor
            or row.expires_at <= utcnow()
            or (revision is not None and row.itinerary_revision != revision)
            or (binding is not None and row.input_hash != binding)
        ):
            raise HTTPException(
                409,
                'LOOKUP_EXPIRED' if kind == 'FLIGHT_CANDIDATE' else 'PREVIEW_EXPIRED',
            )
        return row

    def binding(self, leg, intent):
        # Resolve outside inputs before hashing. Place and coordinate inputs for the
        # same anchor share both equality semantics and preview cache identity.
        travel = ConnectionIntent(
            notes=intent.notes,
            segments=self.intent_segments(leg, intent),
        )
        return fingerprint(
            {
                'travel': draft_hash(travel),
                'from': endpoint_identity(leg, 'from'),
                'to': endpoint_identity(leg, 'to'),
            }
        )

    def intent_segments(self, leg, intent):
        if intent.segments is not None:
            return intent.segments
        return [
            SegmentIntent(
                travel_mode=self.infer_mode(
                    endpoint_location(leg, 'from'),
                    endpoint_location(leg, 'to'),
                    leg.trip_id,
                )
            )
        ]

    def build(self, leg, intent=None, actor=None):
        is_proposed = intent is not None
        previous_hashes = (
            {s.id: s.input_hash for s in self.build(leg)}
            if is_proposed and leg.segments
            else {}
        )
        intent = intent or self.saved_intent(leg)
        old = {row.id: row for row in leg.segments}
        result = []
        inferred = intent.segments is None
        for item in self.intent_segments(leg, intent):
            row = old.get(item.id)
            if item.id is not None and row is None:
                raise HTTPException(422, 'Segment does not belong to this connection')
            lookup, owner = None, None
            flight = item.flight or FlightIntent()
            departure, arrival = None, None
            if item.travel_mode == 'FLIGHT':
                departure = self.airport(flight.departure_airport_place_id)
                arrival = self.airport(flight.arrival_airport_place_id)
                if row and row.flight:
                    old_flight = self.saved_flight_inputs(row.flight)
                    new_flight = flight.model_dump(
                        mode='json', exclude={'candidate_id', 'airline_name'}
                    )
                    if old_flight == new_flight and row.flight.lookup:
                        try:
                            lookup = FlightLookup.model_validate(row.flight.lookup)
                            owner = row.flight.lookup_owner_user_id
                        except ValidationError:
                            pass
                if flight.candidate_id:
                    binding = fingerprint(
                        {
                            'flight_number': flight.flight_number,
                            'departure_date': flight.departure_date,
                        }
                    )
                    artifact = self.artifact(
                        flight.candidate_id,
                        'FLIGHT_CANDIDATE',
                        leg,
                        actor,
                        binding=binding,
                    )
                    lookup = FlightLookup.model_validate(artifact.payload)
                    owner = actor
                if lookup and (
                    lookup.flight_number != flight.flight_number
                    or lookup.departure_date != flight.departure_date
                ):
                    lookup, owner = None, None
                if lookup:
                    if flight.candidate_id and (
                        (
                            departure
                            and not same_endpoint(departure, lookup.departure_airport)
                        )
                        or (
                            arrival
                            and not same_endpoint(arrival, lookup.arrival_airport)
                        )
                    ):
                        raise HTTPException(
                            409, 'Flight candidate does not match the selected airports'
                        )
                    departure, arrival = (
                        lookup.departure_airport,
                        lookup.arrival_airport,
                    )
            else:
                departure, arrival = (
                    self.endpoint(item.from_, leg.trip_id),
                    self.endpoint(item.to, leg.trip_id),
                )
            source = (
                'AUTO'
                if inferred
                else (
                    'USER'
                    if row is None
                    or row.travel_mode != item.travel_mode
                    or item.mode_selected
                    else row.mode_source
                )
            )
            saved_result = None
            if row and row.route and row.route.input_version == row.input_version:
                saved_result = {
                    key: getattr(row.route, key)
                    for key in (
                        'input_hash',
                        'status',
                        'provider',
                        'geometry_geojson',
                        'distance_meters',
                        'duration_seconds',
                        'error_code',
                        'generated_at',
                    )
                }
            if saved_result and saved_result.get('generated_at'):
                saved_result['generated_at'] = saved_result['generated_at'].isoformat()
            if saved_result and saved_result['status'] == 'READY':
                try:
                    validated_geometry(saved_result['geometry_geojson'])
                except ValidationError, ValueError:
                    saved_result = None
            result.append(
                ResolvedSegment(
                    item,
                    row.id if row else uuid.uuid4(),
                    source,
                    row.input_version if row else 1,
                    departure,
                    arrival,
                    self.endpoint(item.via, leg.trip_id),
                    lookup,
                    owner,
                    saved_result,
                )
            )
        anchors = (
            self.location_endpoint(endpoint_location(leg, 'from')),
            self.location_endpoint(endpoint_location(leg, 'to')),
        )
        for seg, key, anchor in (
            (result[0], 'start', anchors[0]),
            (result[-1], 'end', anchors[1]),
        ):
            if seg.intent.travel_mode != 'FLIGHT':
                entered = getattr(seg, key)
                if is_proposed and entered and not same_endpoint(entered, anchor):
                    raise HTTPException(
                        422,
                        'Outer ground endpoints must match the connection endpoints',
                    )
                setattr(seg, key, anchor)
        for left, right in zip(result, result[1:]):
            if left.end is None and left.intent.travel_mode != 'FLIGHT':
                left.end = right.start
            if right.start is None and right.intent.travel_mode != 'FLIGHT':
                right.start = left.end
        for seg in result:
            seg.input_hash = fingerprint(
                {
                    'mode': seg.intent.travel_mode,
                    'flight': seg.intent.flight.model_dump(
                        mode='json', exclude={'candidate_id', 'airline_name'}
                    )
                    if seg.intent.travel_mode == 'FLIGHT' and seg.intent.flight
                    else None,
                    'schedule': [
                        seg.lookup.scheduled_departure,
                        seg.lookup.scheduled_arrival,
                    ]
                    if seg.lookup
                    else None,
                    'points': [
                        (p.longitude, p.latitude) if p else None
                        for p in (seg.start, seg.via, seg.end)
                    ],
                }
            )
            if seg.id in previous_hashes and previous_hashes[seg.id] != seg.input_hash:
                seg.version += 1
            if seg.result and seg.result['input_hash'] != seg.input_hash:
                seg.result = None
        return result

    @staticmethod
    def saved_flight_inputs(flight):
        return {
            key: (
                str(getattr(flight, key)) if getattr(flight, key) is not None else None
            )
            for key in (
                'flight_number',
                'departure_date',
                'departure_airport_place_id',
                'arrival_airport_place_id',
            )
        }

    @staticmethod
    def unavailable_auto_car(seg):
        return (
            seg.source == 'AUTO'
            and seg.intent.travel_mode == 'CAR'
            and seg.result is not None
            and (
                seg.result['status'] == 'UNSUPPORTED'
                or (
                    seg.result['status'] == 'FAILED'
                    and seg.result.get('error_code')
                    in {'NOT_CONFIGURED', 'ROUTE_UNAVAILABLE'}
                )
            )
        )

    def connection(self, leg, segments=None, *, infer_defaults=False):
        segments = segments if segments is not None else self.build(leg)
        responses, warnings, coordinates = [], [], []
        for index, seg in enumerate(segments):
            route = seg.result or {}
            mode = seg.intent.travel_mode
            if infer_defaults and self.unavailable_auto_car(seg):
                mode, route = 'OTHER', {}
                warnings.append('No car route is available; Other was selected.')
            supported = mode in ROAD_MODES
            state = route.get(
                'status', 'NOT_CALCULATED' if supported else 'UNSUPPORTED'
            )
            geometry = (
                route.get('geometry_geojson')
                if state == 'READY'
                else point_geometry(seg.start, seg.end, seg.via)
            )
            if mode == 'FLIGHT' and geometry is None:
                geometry = point_geometry(
                    seg.start or self.location_endpoint(endpoint_location(leg, 'from')),
                    seg.end or self.location_endpoint(endpoint_location(leg, 'to')),
                )
            duration = (
                seg.lookup.duration_seconds
                if seg.lookup
                else route.get('duration_seconds')
                if state == 'READY'
                else None
            )
            saved_intent = seg.intent.model_copy(deep=True)
            saved_intent.travel_mode = TravelMode(mode)
            if saved_intent.flight:
                saved_intent.flight.candidate_id = None
            responses.append(
                SegmentResponse(
                    id=seg.id,
                    intent=saved_intent,
                    mode_source=seg.source,
                    input_version=seg.version,
                    from_endpoint=seg.start,
                    to_endpoint=seg.end,
                    via_endpoint=seg.via,
                    geometry=geometry,
                    duration_seconds=duration,
                    distance_meters=route.get('distance_meters')
                    if state == 'READY'
                    else None,
                    route_state=state,
                    error_code=route.get('error_code'),
                    lookup=seg.lookup,
                    route_options=[
                        {
                            'geometry': item['geometry_geojson'],
                            'distance_meters': item.get('distance_meters'),
                            'duration_seconds': item.get('duration_seconds'),
                        }
                        for item in [route, *route.get('alternatives', [])]
                        if item.get('status') == 'READY'
                    ],
                )
            )
            if geometry:
                coordinates.extend(geometry['coordinates'])
            if seg.start is None or seg.end is None:
                warnings.append(f'Segment {index + 1} has unresolved endpoints')
            if route.get('error_code') == 'ROUTING_LIMIT_REACHED':
                warnings.append('Routing limit reached. Try again later.')
            if mode == 'FLIGHT' and seg.lookup and seg.lookup.duration_seconds is None:
                warnings.append(f'Segment {index + 1} has no valid flight schedule')
            if (
                mode == 'FLIGHT'
                and seg.intent.flight
                and seg.intent.flight.departure_date
                and leg.from_stop is not None
            ):
                leave_date = leg.from_stop.planned_start_date + timedelta(
                    days=leg.from_stop.planned_nights
                )
                if seg.intent.flight.departure_date < leave_date:
                    warnings.append(
                        f'Segment {index + 1} departs before the planned departure from the preceding stop'
                    )
            if (
                mode == 'FLIGHT'
                and seg.lookup
                and seg.lookup.scheduled_arrival
                and leg.to_stop is not None
            ):
                local_arrival = seg.lookup.scheduled_arrival.date()
                if local_arrival > leg.to_stop.planned_start_date:
                    warnings.append(
                        f'Segment {index + 1} arrives after the destination stop date'
                    )
        resolved_junctions = True
        for left, right in zip(segments, segments[1:]):
            if not same_endpoint(left.end, right.start):
                resolved_junctions = False
                warnings.append(
                    'Connection has an unresolved transfer or a change of airport'
                )
        all_flight = all(s.intent.travel_mode == 'FLIGHT' for s in segments)
        all_ground = all(s.intent.travel_mode != 'FLIGHT' for s in segments)
        duration, scope = None, None
        complete = all(
            r.from_endpoint and r.to_endpoint and r.duration_seconds is not None
            for r in responses
        )
        if complete and resolved_junctions:
            if all_ground:
                duration, scope = sum(r.duration_seconds for r in responses), 'JOURNEY'
            elif all_flight:
                chronological = all(
                    left.lookup.scheduled_arrival.astimezone(timezone.utc)
                    < right.lookup.scheduled_departure.astimezone(timezone.utc)
                    for left, right in zip(segments, segments[1:])
                )
                if chronological:
                    duration = int(
                        (
                            segments[-1].lookup.scheduled_arrival.astimezone(
                                timezone.utc
                            )
                            - segments[0].lookup.scheduled_departure.astimezone(
                                timezone.utc
                            )
                        ).total_seconds()
                    )
                    scope = 'FLIGHT_JOURNEY'
                else:
                    warnings.append('Connecting flight times overlap')
        coordinates = (
            coordinates
            or point_geometry(
                self.location_endpoint(endpoint_location(leg, 'from')),
                self.location_endpoint(endpoint_location(leg, 'to')),
            )['coordinates']
        )
        return {
            'segments': responses,
            'warnings': list(dict.fromkeys(warnings)),
            'duration_seconds': duration,
            'duration_scope': scope,
            'route': {
                'type': 'PROVIDER_BACKED'
                if all(r.route_state == 'READY' for r in responses)
                else 'SIMPLE',
                'geometry': GeoJsonLineString(coordinates=coordinates),
                'distance_meters': sum(r.distance_meters for r in responses)
                if all(r.distance_meters is not None for r in responses)
                else None,
                'duration_seconds': duration,
            },
        }

    def resolve_route_response(self, leg):
        return self.connection(leg)

    def persist(self, leg, intent, actor, revision):
        segments = self.build(leg, intent, actor)
        preview = None
        if intent.preview_id:
            try:
                preview = self.artifact(
                    intent.preview_id,
                    'PREVIEW',
                    leg,
                    actor,
                    revision,
                    self.binding(leg, intent),
                )
            except HTTPException:
                pass  # Expiry must not prevent saving user intent.
        # Options are indexes into the actor-owned, input-bound preview, never client geometry.
        for index, seg in enumerate(segments):
            option = seg.intent.route_option
            proposed = preview.payload['routes'][index] if preview else None
            if option and (
                not proposed or option > len(proposed.get('alternatives', []))
            ):
                raise HTTPException(
                    409,
                    detail={
                        'code': 'PREVIEW_EXPIRED',
                        'message': 'Recalculate routes before selecting this alternative',
                    },
                )
        old = {row.id: row for row in leg.segments}
        keep = []
        for index, seg in enumerate(segments):
            row = old.get(seg.id)
            if row is None:
                row = ItineraryTravelSegment(
                    id=seg.id, trip_id=leg.trip_id, leg_id=leg.id
                )
                self.db.add(row)
            row.position, row.travel_mode, row.mode_source = (
                index,
                seg.intent.travel_mode,
                seg.source,
            )
            row.notes, row.service_company, row.service_number = (
                seg.intent.notes,
                seg.intent.service_company,
                seg.intent.service_number,
            )
            row.input_version = seg.version
            for attr, value in (
                ('from_location_id', seg.intent.from_),
                ('to_location_id', seg.intent.to),
                ('via_location_id', seg.intent.via),
            ):
                if isinstance(value, ExistingLocationInput):
                    location_id = value.location_id
                elif value:
                    # Resolve trusted place identity once; locations remain trip-owned snapshots.
                    existing_id = getattr(row, attr, None)
                    existing_location = (
                        self.db.get(Location, existing_id) if existing_id else None
                    )
                    resolved = self.endpoint(value, leg.trip_id)
                    if (
                        existing_location
                        and existing_location.source_place_id == resolved.place_id
                        and (existing_location.latitude, existing_location.longitude)
                        == (resolved.latitude, resolved.longitude)
                    ):
                        location_id = existing_id
                    else:
                        location_id = self.locations.create_location_for_trip(
                            leg.trip_id, actor, value
                        ).id
                else:
                    location_id = None
                if row.travel_mode != 'FLIGHT' and (
                    (index == 0 and attr == 'from_location_id')
                    or (index == len(segments) - 1 and attr == 'to_location_id')
                ):
                    location_id = None
                setattr(row, attr, location_id)
            if row.travel_mode == 'FLIGHT':
                flight = seg.intent.flight or FlightIntent()
                if row.flight is None:
                    row.flight = ItinerarySegmentFlight(
                        segment_id=row.id, trip_id=leg.trip_id
                    )
                for key in (
                    'flight_number',
                    'departure_date',
                    'departure_airport_place_id',
                    'arrival_airport_place_id',
                    'airline_name',
                ):
                    setattr(row.flight, key, getattr(flight, key))
                row.flight.lookup = (
                    seg.lookup.model_dump(mode='json') if seg.lookup else None
                )
                row.flight.lookup_owner_user_id = seg.lookup_owner
            else:
                row.flight = None
            if preview:
                proposed = preview.payload['routes'][index]
                if proposed and proposed['input_hash'] == seg.input_hash:
                    seg.result = proposed
                    if seg.intent.route_option:
                        seg.result = (
                            proposed
                            | proposed['alternatives'][seg.intent.route_option - 1]
                        )
            keep_route = (
                row.route is not None
                and seg.result is not None
                and row.route.input_hash == seg.result['input_hash']
                and row.route.status == seg.result['status']
                and row.route.geometry_geojson == seg.result.get('geometry_geojson')
                and seg.result.get('generated_at') == row.route.generated_at.isoformat()
            )
            if not keep_route:
                row.route = None
                self.db.flush()
            if not keep_route and seg.result and row.travel_mode in ROAD_MODES:
                row.route = ItinerarySegmentRoute(
                    segment_id=row.id,
                    trip_id=leg.trip_id,
                    input_version=row.input_version,
                    **route_values(seg.result),
                )
            keep.append(row)
        leg.segments = keep
        leg.notes = intent.notes
        self.db.flush()

    def _calculate_one(self, seg, deadline):
        base = {
            'input_hash': seg.input_hash,
            'status': 'FAILED',
            'provider': None,
            'geometry_geojson': None,
            'distance_meters': None,
            'duration_seconds': None,
            'error_code': None,
            'generated_at': utcnow().isoformat(),
        }
        if not self.provider or not self.provider.is_configured():
            return base | {'error_code': 'NOT_CONFIGURED'}
        if not self.provider.supports_travel_mode(seg.intent.travel_mode):
            return base | {'status': 'UNSUPPORTED'}
        try:
            route = self.provider.get_route(
                (seg.start.longitude, seg.start.latitude),
                (seg.end.longitude, seg.end.latitude),
                seg.intent.travel_mode,
                via=(seg.via.longitude, seg.via.latitude) if seg.via else None,
                timeout=min(10, max(0.01, deadline - time.monotonic())),
            )
            geometry = validated_geometry(route.geometry_geojson)
            return base | {
                'status': 'READY',
                'provider': self.provider.name,
                'geometry_geojson': geometry,
                'distance_meters': route.distance_meters,
                'duration_seconds': route.duration_seconds,
                'alternatives': [
                    {
                        'status': 'READY',
                        'geometry_geojson': validated_geometry(item.geometry_geojson),
                        'distance_meters': item.distance_meters,
                        'duration_seconds': item.duration_seconds,
                    }
                    for item in route.alternatives[:2]
                ],
            }
        except RouteProviderLimitError:
            return base | {'error_code': 'ROUTING_LIMIT_REACHED'}
        except TimeoutError:
            return base | {'error_code': 'TIMEOUT'}
        except RouteProviderError, OSError, ValueError:
            return base | {'error_code': 'ROUTE_UNAVAILABLE'}

    def calculate(self, segments, retry_failed=False, include_alternatives=False):
        deadline = time.monotonic() + 30
        pending = [
            s
            for s in segments
            if s.intent.travel_mode in ROAD_MODES
            and s.start
            and s.end
            and (
                s.result is None
                or (retry_failed and s.result['status'] == 'FAILED')
                or (
                    include_alternatives
                    and s.result['status'] == 'READY'
                    and 'alternatives' not in s.result
                )
            )
        ]
        # Submit only two calls at a time; no executor backlog survives the deadline.
        with ThreadPoolExecutor(max_workers=2) as executor:
            for offset in range(0, len(pending), 2):
                if time.monotonic() >= deadline:
                    break
                batch = pending[offset : offset + 2]
                futures = [
                    executor.submit(self._calculate_one, seg, deadline) for seg in batch
                ]
                for seg, future in zip(batch, futures, strict=True):
                    calculated = future.result()
                    if seg.result and seg.result['status'] == 'READY':
                        # Opening the chooser must preserve the saved route selection.
                        options = []
                        if calculated['status'] == 'READY':
                            for item in [
                                calculated,
                                *calculated.get('alternatives', []),
                            ]:
                                if (
                                    item['geometry_geojson']
                                    != seg.result['geometry_geojson']
                                ):
                                    options.append(
                                        {
                                            key: value
                                            for key, value in (
                                                calculated | item
                                            ).items()
                                            if key != 'alternatives'
                                        }
                                    )
                        seg.result = seg.result | {'alternatives': options[:2]}
                    else:
                        seg.result = calculated

    def new_artifact(
        self, kind, leg_id, trip_id, actor, payload, binding, revision=None
    ):
        row = ItineraryPlanningArtifact(
            id=uuid.uuid4(),
            kind=kind,
            leg_id=leg_id,
            trip_id=trip_id,
            created_by_user_id=actor,
            itinerary_revision=revision,
            input_hash=binding,
            payload=payload,
            expires_at=utcnow() + timedelta(minutes=10),
        )
        self.db.add(row)
        return row

    def flight_lookup(self, leg, actor, intent):
        binding = fingerprint(intent.model_dump(mode='json'))
        cached = list(
            self.db.scalars(
                select(ItineraryPlanningArtifact).where(
                    ItineraryPlanningArtifact.kind == 'FLIGHT_CANDIDATE',
                    ItineraryPlanningArtifact.trip_id == leg.trip_id,
                    ItineraryPlanningArtifact.leg_id
                    == getattr(leg, 'artifact_leg_id', leg.id),
                    ItineraryPlanningArtifact.created_by_user_id == actor,
                    ItineraryPlanningArtifact.input_hash == binding,
                    ItineraryPlanningArtifact.expires_at > utcnow(),
                )
            )
        )
        if cached:
            return FlightLookupResponse(
                status='MATCHES',
                expires_at=min(r.expires_at for r in cached),
                candidates=[
                    FlightCandidate(
                        candidate_id=r.id,
                        lookup=r.payload,
                        duration_seconds=FlightLookup.model_validate(
                            r.payload
                        ).duration_seconds,
                    )
                    for r in cached
                ],
            )
        return None
