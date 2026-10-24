"""Flight facts, durable polling, and atomic generation of editable GPS history.

Reads are pure: the monitor and owner completion write flight recordings.
Every lifecycle mutation takes the same trip lock as GPS editing and uploads.
"""

import logging
import uuid
from collections import defaultdict
from datetime import timedelta
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from fastapi import HTTPException
from sqlalchemy import exists, select

from models.api.flights import (
    FlightAirportResponse,
    FlightJourneyResponse,
    TrackedFlightResponse,
)
from models.api.planning import (
    FlightLookup,
    FlightLookupRequest,
    normalize_flight_number,
)
from models.database.base import utcnow
from models.database.gps_tracking import GpsTrackSample, GpsTrackingSession
from models.database.itinerary import ItinerarySegmentFlight, ItineraryTravelSegment
from models.database.places import Place
from models.database.tracked_flights import TrackedFlight
from models.database.trips import Trip, TripRole
from services.flight_providers.flight_provider import FlightUnavailable
from services.flight_airports import resolve_flight_airport
from services.gps.flight_geometry import arc, estimate
from services.gps.flight_polling import FLIGHT_POLLING_POLICIES
from services.trip_access import get_trip_read_access

logger = logging.getLogger(__name__)


def airport_response(place):
    return (
        FlightAirportResponse(
            **{key: getattr(place, key) for key in FlightAirportResponse.model_fields}
        )
        if place
        else None
    )


def airport_coordinates(place):
    return (place.longitude, place.latitude)


class FlightTrackingService:
    def __init__(self, db, *, update_frequency='balanced'):
        self.db = db
        self.polling_policy = FLIGHT_POLLING_POLICIES[update_frequency]
        self.attempted_requests = 0

    def lock(self, trip_id):
        self.db.execute(select(Trip.id).where(Trip.id == trip_id).with_for_update())

    def flights(self, trip_id):
        return list(
            self.db.scalars(
                select(TrackedFlight)
                .where(TrackedFlight.trip_id == trip_id)
                .order_by(TrackedFlight.scheduled_departure, TrackedFlight.id)
                .execution_options(populate_existing=True)
            )
        )

    def sync_itinerary(self, trip_id):
        """Called inside itinerary writes, and by the monitor to adopt old plans."""
        self.lock(trip_id)
        existing = self.flights(trip_id)
        linked = set()
        repaired_airports = False
        rows = self.db.execute(
            select(ItineraryTravelSegment, ItinerarySegmentFlight)
            .join(
                ItinerarySegmentFlight,
                ItinerarySegmentFlight.segment_id == ItineraryTravelSegment.id,
            )
            .where(ItineraryTravelSegment.trip_id == trip_id)
        ).all()
        for segment, plan in rows:
            if not plan.lookup:
                retained = next(
                    (
                        f
                        for f in existing
                        if f.itinerary_travel_segment_id == segment.id
                        and f.flight_number == plan.flight_number
                        and f.departure_airport_place_id
                        == plan.departure_airport_place_id
                        and f.scheduled_departure.astimezone(
                            ZoneInfo(f.departure_airport.timezone)
                        ).date()
                        == plan.departure_date
                    ),
                    None,
                )
                if retained:
                    linked.add(retained.id)
                continue
            lookup = FlightLookup.model_validate(plan.lookup)
            for side in ('departure', 'arrival'):
                key = f'{side}_airport_place_id'
                if getattr(plan, key) is None:
                    airport = resolve_flight_airport(
                        self.db, getattr(lookup, f'{side}_airport')
                    )
                    if airport:
                        setattr(plan, key, airport.id)
                        repaired_airports = True
            if not plan.departure_airport_place_id or not plan.arrival_airport_place_id:
                continue
            airport = self.db.get(Place, plan.departure_airport_place_id)
            if not lookup.scheduled_departure or not airport or not airport.timezone:
                continue
            try:
                ZoneInfo(airport.timezone)
            except ZoneInfoNotFoundError:
                continue
            number = normalize_flight_number(lookup.flight_number)
            flight = next(
                (
                    f
                    for f in existing
                    if (
                        f.flight_number,
                        f.scheduled_departure,
                        f.departure_airport_place_id,
                    )
                    == (number, lookup.scheduled_departure, airport.id)
                ),
                None,
            )
            if flight is None:
                flight = TrackedFlight(
                    id=uuid.uuid4(),
                    trip_id=trip_id,
                    itinerary_connection_id=segment.connection_id,
                    flight_number=number,
                    departure_airport_place_id=airport.id,
                    arrival_airport_place_id=plan.arrival_airport_place_id,
                    airline_name=lookup.airline_name,
                    scheduled_departure=lookup.scheduled_departure,
                    scheduled_arrival=lookup.scheduled_arrival,
                    status='SCHEDULED',
                    last_check_result='NOT_CHECKED',
                    next_check_at=self.polling_policy.first_check(lookup.scheduled_departure),
                )
                self.db.add(flight)
                existing.append(flight)
            flight.itinerary_travel_segment_id = segment.id
            linked.add(flight.id)
            if (
                not self.terminal(flight)
                and flight.session is None
                and flight.last_check_result != 'CONFIGURATION_ERROR'
                and flight.status != 'CANCELLED'
                and flight.next_check_at is None
                and self.next_check(flight, utcnow()) is not None
            ):
                flight.next_check_at = self.polling_policy.first_check(
                    flight.estimated_departure or flight.scheduled_departure
                )
        for flight in existing:
            if flight.id not in linked:
                flight.itinerary_travel_segment_id = None
                if flight.gps_tracking_session_id is None:
                    flight.next_check_at = None
            elif flight.next_check_at is not None and not self.terminal(flight):
                # Apply preset changes to existing flights, including retained
                # schedules. Never shorten account backoff or resume disabled checks.
                if flight.last_check_result == 'NOT_CHECKED':
                    flight.next_check_at = self.polling_policy.first_check(flight.scheduled_departure)
                elif flight.last_check_result == 'OK' and flight.checked_at:
                    flight.next_check_at = self.next_check(flight, flight.checked_at)
        if repaired_airports:
            # Older saved candidates omitted these derived IDs. Invalidate any
            # editor holding that older intent before it can erase the match.
            trip = self.db.get(Trip, trip_id, populate_existing=True)
            trip.itinerary_revision += 1
        self.db.flush()

    @staticmethod
    def terminal(flight):
        return bool(
            flight.completion_source
            or flight.stop_reason
            or (
                flight.session
                and (flight.session.deleted_at or flight.session.ended_at)
            )
        )

    def stop(self, session, reason):
        flight = self.db.scalar(
            select(TrackedFlight).where(
                TrackedFlight.gps_tracking_session_id == session.id
            )
        )
        if flight:
            flight.next_check_at = None
            if not flight.completion_source:
                flight.stop_reason = reason

    def _start(self, flight, boundary, observed_at):
        if flight.gps_tracking_session_id is not None:
            return
        sessions = list(
            self.db.scalars(
                select(GpsTrackingSession).where(
                    GpsTrackingSession.trip_id == flight.trip_id,
                    GpsTrackingSession.source == 'FLIGHT_ESTIMATE',
                    GpsTrackingSession.deleted_at.is_(None),
                )
            )
        )
        later = next(
            (
                f
                for f in self.flights(flight.trip_id)
                if (f.scheduled_departure, f.id)
                > (flight.scheduled_departure, flight.id)
                and f.gps_tracking_session_id
            ),
            None,
        )
        if later:
            # A delayed response for an earlier leg must never stop the newer leg.
            flight.stop_reason = 'NEXT_FLIGHT_DEPARTED'
            flight.next_check_at = None
            return
        previous = next((s for s in sessions if s.ended_at is None), None)
        if previous and boundary < previous.started_at:
            boundary = observed_at
        # A late out-of-order confirmation cannot overlap immutable history.
        if any(s.ended_at and boundary < s.ended_at for s in sessions):
            boundary = max([observed_at, *(s.ended_at for s in sessions if s.ended_at)])
        if previous:
            previous.ended_at = boundary
            self.stop(previous, 'NEXT_FLIGHT_DEPARTED')
            self.db.flush()  # release the partial unique index before INSERT
        session = GpsTrackingSession(
            id=uuid.uuid4(),
            trip_id=flight.trip_id,
            source='FLIGHT_ESTIMATE',
            started_at=boundary,
            recorded_by_user_id=None,
        )
        self.db.add(session)
        self.db.flush()
        flight.session = session
        flight.gps_tracking_session_id = session.id
        self.db.add(
            self._sample(
                flight, boundary, airport_coordinates(flight.departure_airport)
            )
        )

    @staticmethod
    def _sample(flight, at, coordinate):
        return GpsTrackSample(
            id=uuid.uuid4(),
            trip_id=flight.trip_id,
            session_id=flight.gps_tracking_session_id,
            recorded_at=at,
            longitude=coordinate[0],
            latitude=coordinate[1],
            travel_mode='FLIGHT',
            is_display_retained=True,
        )

    def finalize(self, flight, arrival_at, source):
        session = flight.session
        if (
            self.terminal(flight)
            or session is None
            or flight.arrival_airport is None
            or arrival_at <= session.started_at
        ):
            return False
        points = arc(
            airport_coordinates(flight.departure_airport),
            airport_coordinates(flight.arrival_airport),
        )
        # The departure point is already stored. No regeneration, even on retries.
        self.db.add_all(
            [
                self._sample(
                    flight,
                    session.started_at + (arrival_at - session.started_at) * i / 64,
                    point,
                )
                for i, point in enumerate(points)
                if i
            ]
        )
        session.ended_at = arrival_at
        flight.completion_source = source
        flight.status = 'ARRIVED'
        flight.next_check_at = None
        return True

    def apply_updates(self, trip_id, updates, observed_at):
        """Apply all known arrivals before any later departure, under one lock."""
        self.lock(trip_id)
        flights = self.flights(trip_id)
        actionable = []
        for flight in flights:
            facts = updates.get(flight.id)
            if facts is None or self.terminal(flight):
                continue
            was_arrived = flight.status == 'ARRIVED'
            flight.checked_at, flight.last_check_result = observed_at, 'OK'
            # Keep independently confirmed actuals when later responses weaken.
            flight.actual_departure = flight.actual_departure or facts.actual_departure
            flight.actual_arrival = flight.actual_arrival or facts.actual_arrival
            if facts.estimated_departure:
                flight.estimated_departure = facts.estimated_departure
            if facts.estimated_arrival and not was_arrived:
                flight.estimated_arrival = facts.estimated_arrival
            if (
                facts.diverted
                or flight.arrival_airport_place_id is None
                or flight.status == 'DIVERTED'
            ):
                landing = self._resolve_airport(facts.landing_airport)
                original = (
                    self.db.get(
                        ItinerarySegmentFlight, flight.itinerary_travel_segment_id
                    )
                    if flight.itinerary_travel_segment_id
                    else None
                )
                original_id = (
                    original.arrival_airport_place_id
                    if original
                    else flight.arrival_airport_place_id
                    if flight.status != 'DIVERTED'
                    else None
                )
                if (
                    landing
                    and landing.id != original_id
                    and (
                        original_id is not None
                        or flight.arrival_airport_place_id == landing.id
                    )
                ):
                    flight.arrival_airport = landing
                    flight.arrival_airport_place_id = landing.id
                elif facts.diverted and flight.status != 'DIVERTED':
                    flight.arrival_airport = None
                    flight.arrival_airport_place_id = None
                if facts.diverted:
                    flight.status = 'DIVERTED'
                    flight.estimated_arrival = None
            elif facts.landing_airport:
                landing = self._resolve_airport(facts.landing_airport)
                if landing:
                    flight.arrival_airport = landing
                    flight.arrival_airport_place_id = landing.id
            if facts.arrival_confirmed or was_arrived:
                flight.status = 'ARRIVED'
                if not was_arrived:
                    # A confirmed arrival lacking a time has an estimated boundary.
                    flight.estimated_arrival = flight.actual_arrival or observed_at
            elif flight.session:
                if not facts.diverted and flight.status != 'DIVERTED':
                    flight.status = 'IN_FLIGHT'
            elif facts.departure_confirmed:
                flight.status = 'IN_FLIGHT'
            elif facts.status != 'UNKNOWN' and not facts.diverted:
                flight.status = facts.status
            actionable.append((flight, facts))
        # Existing sessions can finish first; then process new movements in original order.
        for flight, facts in actionable:
            if flight.status == 'ARRIVED' and flight.session:
                self.finalize(
                    flight,
                    flight.actual_arrival or flight.estimated_arrival,
                    'PROVIDER',
                )
        for flight, facts in actionable:
            if self.terminal(flight):
                continue
            if facts.departure_confirmed or flight.status == 'ARRIVED':
                self._start(flight, flight.actual_departure or observed_at, observed_at)
                if flight.status == 'ARRIVED' and flight.session:
                    self.finalize(
                        flight,
                        flight.actual_arrival or flight.estimated_arrival,
                        'PROVIDER',
                    )
            if not self.terminal(flight):
                flight.next_check_at = self.next_check(flight, observed_at)
        self.db.flush()

    def _resolve_airport(self, endpoint):
        return resolve_flight_airport(self.db, endpoint)

    def next_check(self, flight, now):
        return self.polling_policy.next_check(flight, now)

    def poll_due(
        self, provider, now=None, *, cancelled=lambda: False,
        verify_ownership=lambda: None, configuration_is_current=lambda: True,
        log_context=None,
    ):
        now = now or utcnow()
        self.attempted_requests = 0
        if cancelled():
            return 0
        verify_ownership()
        # Bootstrap old plans and detach removed unstarted records without reading APIs.
        trip_ids = set(
            self.db.scalars(
                select(ItineraryTravelSegment.trip_id)
                .join(
                    ItinerarySegmentFlight,
                    ItinerarySegmentFlight.segment_id == ItineraryTravelSegment.id,
                )
                .where(
                    ItineraryTravelSegment.travel_mode == 'FLIGHT',
                    ItinerarySegmentFlight.lookup.is_not(None),
                    ~exists(
                        select(TrackedFlight.id).where(
                            TrackedFlight.itinerary_travel_segment_id
                            == ItineraryTravelSegment.id
                        )
                    ),
                )
            )
        )
        trip_ids.update(
            self.db.scalars(
                select(TrackedFlight.trip_id).where(
                    TrackedFlight.next_check_at.is_not(None)
                )
            )
        )
        for trip_id in sorted(trip_ids):
            if cancelled():
                return 0
            verify_ownership()
            self.sync_itinerary(trip_id)
            self.db.commit()
        due = list(
            self.db.scalars(
                select(TrackedFlight)
                .where(TrackedFlight.next_check_at <= now)
                .order_by(TrackedFlight.scheduled_departure, TrackedFlight.id)
            )
        )
        groups = defaultdict(list)
        for flight in due:
            if (
                self.terminal(flight)
                or (
                    flight.itinerary_travel_segment_id is None
                    and flight.session is None
                )
                or self.next_check(flight, now) is None
            ):
                flight.next_check_at = None
                continue
            local_date = flight.scheduled_departure.astimezone(
                ZoneInfo(flight.departure_airport.timezone)
            ).date()
            groups[(flight.flight_number, local_date)].append(flight)
        self.db.commit()
        all_updates = defaultdict(dict)
        failures = {}
        calls = 0
        for (number, date), grouped in groups.items():
            if cancelled():
                break
            verify_ownership()
            try:
                if provider is None or not provider.is_configured():
                    raise FlightUnavailable(result='CONFIGURATION_ERROR')
                calls += 1
                self.attempted_requests = calls
                facts = provider.track(
                    FlightLookupRequest(flight_number=number, departure_date=date)
                )
                verify_ownership()
                for flight in grouped:
                    match = next(
                        (
                            m
                            for m in facts
                            if m.scheduled_departure == flight.scheduled_departure
                            and (
                                m.departure_airport.iata_code
                                == flight.departure_airport.iata_code
                                if flight.departure_airport.iata_code
                                else m.departure_airport.icao_code
                                == flight.departure_airport.icao_code
                            )
                        ),
                        None,
                    )
                    if match:
                        all_updates[flight.trip_id][flight.id] = match
                    else:
                        failures[flight.id] = (flight, FlightUnavailable())
                if any(flight.id in failures for flight in grouped):
                    logger.warning('flight_monitor.provider_unavailable', extra={
                        **(log_context or {}), 'provider': getattr(provider, 'name', 'unconfigured'),
                        'attempted_requests': calls, 'outcome': 'UNAVAILABLE',
                    })
            except FlightUnavailable as exc:
                verify_ownership()
                logger.warning('flight_monitor.provider_refusal', extra={
                    **(log_context or {}), 'provider': getattr(provider, 'name', 'unconfigured'),
                    'attempted_requests': calls, 'outcome': exc.result,
                })
                for flight in grouped:
                    failures[flight.id] = (flight, exc)
                # Quota/configuration refusal applies to the provider account.
                if exc.result in ('RATE_LIMITED', 'CONFIGURATION_ERROR'):
                    for remaining in groups.values():
                        for flight in remaining:
                            if flight.id not in all_updates[flight.trip_id]:
                                if exc.result == 'CONFIGURATION_ERROR':
                                    failures.setdefault(flight.id, (flight, exc))
                                else:
                                    failures[flight.id] = (flight, exc)
                    break
        # No provider failure writes or trip locks during the HTTP phase.
        # Verify even after cancellation: valid facts may only be saved on the
        # physical connection that still owns monitoring.
        verify_ownership()
        if any(exc.result == 'CONFIGURATION_ERROR' for _, exc in failures.values()):
            if not configuration_is_current():
                failures = {
                    key: (flight, exc) for key, (flight, exc) in failures.items()
                    if exc.result != 'CONFIGURATION_ERROR'
                }
        failures_by_trip = defaultdict(list)
        for flight, exc in failures.values():
            failures_by_trip[flight.trip_id].append((flight, exc))
        # Consistent lock order for the whole batch, including successful facts.
        for trip_id in sorted(all_updates.keys() | failures_by_trip.keys()):
            verify_ownership()
            if all_updates[trip_id]:
                self.apply_updates(trip_id, all_updates[trip_id], now)
            for flight, exc in failures_by_trip[trip_id]:
                self._failure(flight, now, exc)
        verify_ownership()
        self.db.commit()
        return calls

    def _failure(self, flight, now, exc):
        self.lock(flight.trip_id)
        self.db.refresh(flight)
        if self.terminal(flight):
            return
        flight.last_check_result = exc.result
        if exc.result == 'CONFIGURATION_ERROR':
            flight.next_check_at = None
        elif exc.result == 'RATE_LIMITED':
            seconds = (
                exc.retry_after_seconds if exc.retry_after_seconds is not None else 2700
            )
            flight.next_check_at = now + timedelta(seconds=max(1, seconds))
        else:
            flight.next_check_at = self.next_check(flight, now)

    def complete(self, trip_id, flight_id, user_id, payload):
        access = get_trip_read_access(self.db, trip_id=trip_id, current_user_id=user_id)
        if access is None:
            raise HTTPException(404, 'Trip not found')
        if access.membership is None or access.membership.role != TripRole.OWNER:
            raise HTTPException(403, 'The user does not have enough privileges')
        self.lock(trip_id)
        flight = self.db.scalar(
            select(TrackedFlight)
            .where(TrackedFlight.id == flight_id, TrackedFlight.trip_id == trip_id)
            .execution_options(populate_existing=True)
        )
        if flight is None:
            raise HTTPException(404, 'Flight not found')
        if flight.session is None or flight.session.deleted_at or flight.stop_reason:
            raise HTTPException(409, 'Flight recording is stopped or deleted')
        if flight.completion_source:
            return flight
        if flight.session.ended_at:
            raise HTTPException(409, 'Flight recording is stopped')
        if not flight.session.started_at < payload.estimated_arrival <= utcnow():
            raise HTTPException(
                422, 'Estimated arrival must be after departure and no later than now'
            )
        if flight.arrival_airport_place_id is None:
            airport = (
                self.db.get(Place, payload.arrival_airport_place_id)
                if payload.arrival_airport_place_id
                else None
            )
            if airport is None:
                raise HTTPException(
                    409,
                    {
                        'code': 'flight_arrival_airport_required',
                        'message': 'Choose the landing airport before finishing this diverted flight, or stop its recording.',
                    },
                )
            if airport.feature_code != 'AIRP':
                raise HTTPException(422, 'Choose an existing airport')
            flight.arrival_airport = airport
            flight.arrival_airport_place_id = airport.id
        flight.estimated_arrival = payload.estimated_arrival
        self.finalize(flight, payload.estimated_arrival, 'OWNER')
        self.db.commit()
        return flight

    def cards(self, access, posts, now=None):
        now = now or utcnow()
        live = access.membership is not None or access.trip.share_live_location
        boundary = max((p.occurred_at for p in posts), default=None)
        flights = self.flights(access.trip.id)
        grouped = defaultdict(list)
        first_departures = {}
        for flight in flights:
            if flight.itinerary_travel_segment_id or flight.session:
                first_departures.setdefault(
                    flight.itinerary_connection_id, flight.scheduled_departure
                )
        visible = []
        for flight in flights:
            session = flight.session
            if session is None and flight.itinerary_travel_segment_id is None:
                continue
            if live:
                if first_departures[flight.itinerary_connection_id] > now + timedelta(
                    hours=24
                ):
                    continue
            elif session is None or session.deleted_at:
                continue
            elif boundary is None:
                if session.ended_at is None:
                    continue
            elif session.started_at > boundary:
                continue
            visible.append(flight)
        for flight in visible:
            session = flight.session
            deleted = bool(session and session.deleted_at)
            full = live or (
                session
                and session.ended_at
                and (boundary is None or session.ended_at <= boundary)
            )
            e = estimate(flight, now if live else boundary) if not deleted else None
            # Historical readers see only facts within their published-post boundary.
            actual_dep = (
                flight.actual_departure
                if live
                or full
                or (flight.actual_departure and flight.actual_departure <= boundary)
                else None
            )
            actual_arr = flight.actual_arrival if full else None
            reason = flight.stop_reason if full and not deleted else None
            if reason == 'NEXT_FLIGHT_DEPARTED':
                if not any(
                    (f.scheduled_departure, f.id)
                    > (flight.scheduled_departure, flight.id)
                    and f.session
                    and f.session.started_at
                    <= (now if live or boundary is None else boundary)
                    for f in visible
                ):
                    reason = None
            completed = bool(flight.completion_source and full and not deleted)
            data = TrackedFlightResponse(
                id=flight.id,
                flight_number=flight.flight_number,
                airline_name=flight.airline_name,
                departure_airport=airport_response(flight.departure_airport),
                arrival_airport=airport_response(flight.arrival_airport)
                if full
                else None,
                status=flight.status if full else 'IN_FLIGHT',
                scheduled_departure=flight.scheduled_departure,
                scheduled_arrival=flight.scheduled_arrival,
                estimated_departure=flight.estimated_departure if live else None,
                estimated_arrival=flight.estimated_arrival if full else None,
                actual_departure=actual_dep,
                actual_arrival=actual_arr,
                completion_source=flight.completion_source if completed else None,
                stop_reason=reason,
                progress=None
                if deleted or flight.stop_reason
                else 1
                if completed
                else e.progress
                if e
                else None,
                estimate_basis=e.basis if e else None,
                position_at=e.position_at if e else None,
                status_updated_at=flight.checked_at if full else None,
                update_state='UNAVAILABLE'
                if flight.last_check_result != 'OK'
                else 'STALE'
                if not flight.checked_at
                or now - flight.checked_at > timedelta(minutes=60)
                else 'CURRENT',
                visible_to_members_only=bool(
                    access.membership
                    and not access.trip.share_live_location
                    and (
                        not session
                        or not session.ended_at
                        or boundary is None
                        or session.ended_at > boundary
                    )
                ),
                can_complete=bool(
                    access.membership
                    and access.membership.role == TripRole.OWNER
                    and session
                    and not self.terminal(flight)
                ),
                gps_tracking_session_id=session.id if session and not deleted else None,
            )
            grouped[flight.itinerary_connection_id].append(data)
        return [
            FlightJourneyResponse(itinerary_connection_id=key, flights=value)
            for key, value in grouped.items()
        ]
