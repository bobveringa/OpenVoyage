"""Server-owned travel intent, endpoint resolution and bounded explicit calculations."""

import uuid
from dataclasses import replace
from datetime import timedelta, timezone
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from fastapi import HTTPException
from pydantic import ValidationError
from sqlalchemy import select

from models.api.geojson import GeoJsonLineString
from models.api.planning import (
    ROAD_MODES,
    ConnectionIntent,
    Endpoint,
    ExistingLocationInput,
    FlightIntent,
    FlightLookup,
    SegmentIntent,
    SegmentResponse,
    PlanningWarning,
)
from models.api.locations import LocationPlaceInput
from models.database.itinerary import (
    ItinerarySegmentFlight,
    ItinerarySegmentRoute,
    ItineraryTravelSegment,
)
from models.database.locations import Location
from models.database.places import Place
from models.database.travel import TravelMode
from services.planning_models import PreparedConnection, ResolvedSegment
from services.flight_airports import resolve_flight_airport
from services.planning_calculator import RouteCalculator
from services.planning_artifacts import PlanningArtifactStore
from services.planning_geometry import (
    default_mode,
    draft_hash,
    fingerprint,
    point_geometry,
    route_values,
    same_endpoint,
    select_route,
    validated_geometry,
)
from services.connection_endpoints import endpoint_location, endpoint_identity
from services.flight_providers import DisabledFlightProvider, FlightProviderBase


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
        self.calculator = RouteCalculator(route_provider)
        self.artifacts = PlanningArtifactStore(db)
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

    def saved_intent(self, connection):
        items = []
        for row in connection.segments:
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
        return ConnectionIntent(notes=connection.notes, segments=items)

    def binding(self, connection, intent):
        # Resolve outside inputs before hashing. Place and coordinate inputs for the
        # same anchor share both equality semantics and preview cache identity.
        travel = ConnectionIntent(
            notes=intent.notes,
            segments=self.intent_segments(connection, intent),
        )
        return fingerprint(
            {
                'travel': draft_hash(travel),
                'from': endpoint_identity(connection, 'from'),
                'to': endpoint_identity(connection, 'to'),
            }
        )

    def intent_segments(self, connection, intent):
        if intent.segments is not None:
            return intent.segments
        return [
            SegmentIntent(
                travel_mode=self.infer_mode(
                    endpoint_location(connection, 'from'),
                    endpoint_location(connection, 'to'),
                    connection.trip_id,
                )
            )
        ]

    def build(self, connection, intent=None, actor=None):
        is_proposed = intent is not None
        previous_hashes = (
            {s.id: s.input_hash for s in self.build(connection)}
            if is_proposed and connection.segments
            else {}
        )
        intent = intent or self.saved_intent(connection)
        old = {row.id: row for row in connection.segments}
        result = []
        inferred = intent.segments is None
        for item in self.intent_segments(connection, intent):
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
                    artifact = self.artifacts.get(
                        flight.candidate_id,
                        'FLIGHT_CANDIDATE',
                        connection,
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
                    self.endpoint(item.from_, connection.trip_id),
                    self.endpoint(item.to, connection.trip_id),
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
                    self.endpoint(item.via, connection.trip_id),
                    lookup,
                    owner,
                    saved_result,
                )
            )
        anchors = (
            self.location_endpoint(endpoint_location(connection, 'from')),
            self.location_endpoint(endpoint_location(connection, 'to')),
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
            seg.input_hash = self.segment_input_hash(seg)
            if seg.id in previous_hashes and previous_hashes[seg.id] != seg.input_hash:
                seg.version += 1
            if seg.result and seg.result['input_hash'] != seg.input_hash:
                seg.result = None
        return result

    @staticmethod
    def segment_input_hash(segment: ResolvedSegment) -> str:
        return fingerprint(
            {
                'mode': segment.intent.travel_mode,
                'flight': segment.intent.flight.model_dump(
                    mode='json', exclude={'candidate_id', 'airline_name'}
                )
                if segment.intent.travel_mode == 'FLIGHT' and segment.intent.flight
                else None,
                'schedule': [
                    segment.lookup.scheduled_departure,
                    segment.lookup.scheduled_arrival,
                ]
                if segment.lookup
                else None,
                'points': [
                    (p.longitude, p.latitude) if p else None
                    for p in (segment.start, segment.via, segment.end)
                ],
            }
        )

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

    def prepare_connection(
        self,
        connection,
        intent: ConnectionIntent | None,
        segments: list[ResolvedSegment],
    ) -> PreparedConnection:
        """Finalize automatic choices once for previewing, saving and refreshing.

        Explicit transport choices stay unchanged. Keep calculation inputs intact
        so the original request can still reuse its cached provider results.
        """
        infer_defaults = intent is None or intent.segments is None
        existing = {row.id: row for row in connection.segments}
        prepared, warnings = [], []
        for segment in segments:
            if infer_defaults and self.unavailable_auto_car(segment):
                segment = replace(
                    segment,
                    intent=segment.intent.model_copy(
                        update={'travel_mode': TravelMode.OTHER}
                    ),
                    result=None,
                )
                segment.input_hash = self.segment_input_hash(segment)
                if segment.id in existing:
                    segment.version = max(
                        segment.version, existing[segment.id].input_version + 1
                    )
                warnings.append(
                    PlanningWarning(
                        code='AUTO_CAR_UNAVAILABLE',
                        message='No car route is available; Other was selected.',
                        segment_id=segment.id,
                    )
                )
            prepared.append(segment)
        normalized_intent = ConnectionIntent(
            notes=intent.notes if intent is not None else connection.notes,
            segments=[segment.intent for segment in prepared],
        )
        return PreparedConnection(
            intent=normalized_intent,
            segments=prepared,
            warnings=warnings,
            binding=self.binding(connection, normalized_intent),
        )

    def connection(self, connection, segments=None, *, warnings=()):
        segments = segments if segments is not None else self.build(connection)
        responses, warnings, coordinates = [], list(warnings), []
        for index, seg in enumerate(segments):
            options_route = seg.result or {}
            route = select_route(seg.result, seg.intent.route_option, seg.id) or {}
            mode = seg.intent.travel_mode
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
                    seg.start
                    or self.location_endpoint(endpoint_location(connection, 'from')),
                    seg.end
                    or self.location_endpoint(endpoint_location(connection, 'to')),
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
                        for item in [
                            options_route,
                            *options_route.get('alternatives', []),
                        ]
                        if item.get('status') == 'READY'
                    ],
                )
            )
            if geometry:
                coordinates.extend(geometry['coordinates'])
            if seg.start is None or seg.end is None:
                warnings.append(
                    PlanningWarning(
                        code='UNRESOLVED_ENDPOINTS',
                        message=f'Segment {index + 1} has unresolved endpoints',
                        segment_id=seg.id,
                    )
                )
            if route.get('error_code') == 'ROUTING_LIMIT_REACHED':
                warnings.append(
                    PlanningWarning(
                        code='ROUTING_LIMIT_REACHED',
                        message='Routing limit reached. Try again later.',
                        segment_id=seg.id,
                    )
                )
            if mode == 'FLIGHT' and seg.lookup and seg.lookup.duration_seconds is None:
                warnings.append(
                    PlanningWarning(
                        code='INVALID_FLIGHT_SCHEDULE',
                        message=f'Segment {index + 1} has no valid flight schedule',
                        segment_id=seg.id,
                    )
                )
            if (
                mode == 'FLIGHT'
                and seg.intent.flight
                and seg.intent.flight.departure_date
                and connection.from_stop is not None
            ):
                leave_date = connection.from_stop.planned_start_date + timedelta(
                    days=connection.from_stop.planned_nights
                )
                if seg.intent.flight.departure_date < leave_date:
                    warnings.append(
                        PlanningWarning(
                            code='DEPARTURE_BEFORE_STOP_END',
                            message=f'Segment {index + 1} departs before the planned departure from the preceding stop',
                            segment_id=seg.id,
                        )
                    )
            if (
                mode == 'FLIGHT'
                and seg.lookup
                and seg.lookup.scheduled_arrival
                and connection.to_stop is not None
            ):
                arrival = seg.lookup.scheduled_arrival
                airport_timezone = seg.lookup.arrival_airport.timezone
                if airport_timezone:
                    try:
                        arrival = arrival.astimezone(ZoneInfo(airport_timezone))
                    except ZoneInfoNotFoundError, ValueError:
                        pass
                local_arrival = arrival.date()
                if local_arrival > connection.to_stop.planned_start_date:
                    warnings.append(
                        PlanningWarning(
                            code='ARRIVAL_AFTER_STOP_START',
                            message=f'Segment {index + 1} arrives after the destination stop date',
                            segment_id=seg.id,
                        )
                    )
        resolved_junctions = True
        for left, right in zip(segments, segments[1:]):
            if not same_endpoint(left.end, right.start):
                resolved_junctions = False
                warnings.append(
                    PlanningWarning(
                        code='UNRESOLVED_TRANSFER',
                        message='Connection has an unresolved transfer or a change of airport',
                        segment_id=right.id,
                    )
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
                    warnings.append(
                        PlanningWarning(
                            code='OVERLAPPING_FLIGHTS',
                            message='Connecting flight times overlap',
                        )
                    )
        coordinates = (
            coordinates
            or point_geometry(
                self.location_endpoint(endpoint_location(connection, 'from')),
                self.location_endpoint(endpoint_location(connection, 'to')),
            )['coordinates']
        )
        return {
            'segments': responses,
            'warnings': warnings,
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

    def resolve_route_response(self, connection):
        return self.connection(connection)

    def persist(self, connection, intent, actor, revision):
        segments = self.build(connection, intent, actor)
        preview = None
        if intent.preview_id:
            try:
                preview = self.artifacts.get(
                    intent.preview_id,
                    'PREVIEW',
                    connection,
                    actor,
                    revision,
                    self.binding(connection, intent),
                )
            except HTTPException:
                pass  # Expiry must not prevent saving user intent.
        # Options are indexes into the actor-owned, input-bound preview, never client geometry.
        for index, seg in enumerate(segments):
            option = seg.intent.route_option
            proposed = preview.payload['routes'][index] if preview else None
            if option and (
                not proposed
                or proposed['input_hash'] != seg.input_hash
                or option > len(proposed.get('alternatives', []))
            ):
                raise HTTPException(
                    409,
                    detail={
                        'code': 'PREVIEW_EXPIRED',
                        'message': 'Recalculate routes before selecting this alternative',
                    },
                )
            if proposed and proposed['input_hash'] == seg.input_hash:
                seg.result = select_route(proposed, option, seg.id)
        prepared = self.prepare_connection(connection, intent, segments)
        segments = prepared.segments
        old = {row.id: row for row in connection.segments}
        keep = []
        for index, seg in enumerate(segments):
            row = old.get(seg.id)
            if row is None:
                row = ItineraryTravelSegment(
                    id=seg.id, trip_id=connection.trip_id, connection_id=connection.id
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
                    resolved = self.endpoint(value, connection.trip_id)
                    if (
                        existing_location
                        and existing_location.source_place_id == resolved.place_id
                        and (existing_location.latitude, existing_location.longitude)
                        == (resolved.latitude, resolved.longitude)
                    ):
                        location_id = existing_id
                    else:
                        location_id = self.locations.create_location_for_trip(
                            connection.trip_id, actor, value
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
                        segment_id=row.id, trip_id=connection.trip_id
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
                if seg.lookup:
                    for side in ('departure', 'arrival'):
                        key = f'{side}_airport_place_id'
                        if getattr(row.flight, key) is None:
                            airport = resolve_flight_airport(
                                self.db, getattr(seg.lookup, f'{side}_airport')
                            )
                            if airport:
                                setattr(row.flight, key, airport.id)
            else:
                row.flight = None
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
                    trip_id=connection.trip_id,
                    input_version=row.input_version,
                    **route_values(seg.result),
                )
            keep.append(row)
        connection.segments = keep
        connection.notes = prepared.intent.notes
        self.db.flush()

    def calculate(
        self, segments, retry_failed=False, include_alternatives=False, *, force=False
    ):
        self.calculator.calculate(
            segments, retry_failed, include_alternatives, force=force
        )
