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
from sqlalchemy import delete, exists, select

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
from services.gps.flight_polling import FlightPollingPolicy
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
    def __init__(
        self, db, *, check_interval_minutes=30, check_more_often_before_departure=True
    ):
        self.db = db
        self.polling_policy = FlightPollingPolicy(
            check_interval_minutes, check_more_often_before_departure
        )
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
                    next_check_at=self.polling_policy.first_check(
                        lookup.scheduled_departure
                    ),
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
                    min(
                        flight.scheduled_departure,
                        flight.estimated_departure or flight.scheduled_departure,
                    )
                )
        for flight in existing:
            if flight.id not in linked:
                flight.itinerary_travel_segment_id = None
                if flight.gps_tracking_session_id is None:
                    flight.next_check_at = None
            elif flight.next_check_at is not None and not self.terminal(flight):
                if flight.last_check_result == 'NOT_CHECKED':
                    flight.next_check_at = self.polling_policy.first_check(
                        min(
                            flight.scheduled_departure,
                            flight.estimated_departure or flight.scheduled_departure,
                        )
                    )
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

    def cancel_final(self, session):
        flight = self.db.scalar(
            select(TrackedFlight).where(
                TrackedFlight.gps_tracking_session_id == session.id
            )
        )
        if flight:
            flight.final_track_pending = False
            flight.next_check_at = None

    def stop(self, session, reason):
        flight = self.db.scalar(
            select(TrackedFlight).where(
                TrackedFlight.gps_tracking_session_id == session.id
            )
        )
        if flight:
            flight.final_track_pending = False
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
                    GpsTrackingSession.source.in_(('FLIGHT_ESTIMATE', 'FLIGHT_TRACK')),
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
            # A conflicting timestamp cannot backfill across the active earlier leg.
            boundary = observed_at
        # A late out-of-order confirmation cannot overlap immutable history.
        if any(s.ended_at and boundary < s.ended_at for s in sessions):
            boundary = max(s.ended_at for s in sessions if s.ended_at)
        for earlier in self.flights(flight.trip_id):
            if earlier.final_track_pending and (
                earlier.scheduled_departure,
                earlier.id,
            ) < (flight.scheduled_departure, flight.id):
                self.stop(earlier.session, 'NEXT_FLIGHT_DEPARTED')
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
        self._fallback(flight, arrival_at)
        session.ended_at = arrival_at
        flight.completion_source = source
        flight.status = 'ARRIVED'
        flight.next_check_at = None
        flight.final_track_pending = source == 'PROVIDER'
        return True

    def _fallback(self, flight, arrival_at):
        session = flight.session
        if (
            session.source == 'FLIGHT_TRACK'
            or flight.arrival_airport is None
            or arrival_at <= session.started_at
        ):
            return
        # Only replace the server's provisional departure point, never settled history.
        self.db.execute(
            delete(GpsTrackSample).where(GpsTrackSample.session_id == session.id)
        )
        points = arc(
            airport_coordinates(flight.departure_airport),
            airport_coordinates(flight.arrival_airport),
        )
        self.db.add_all(
            [
                self._sample(
                    flight,
                    session.started_at + (arrival_at - session.started_at) * i / 64,
                    point,
                )
                for i, point in enumerate(points)
            ]
        )

    def observations(self, flight, until=None):
        if (
            not flight.session
            or flight.session.deleted_at
            or flight.session.source != 'FLIGHT_TRACK'
        ):
            return []
        query = select(GpsTrackSample).where(
            GpsTrackSample.session_id == flight.session.id
        )
        if until is not None:
            query = query.where(GpsTrackSample.recorded_at <= until)
        return list(self.db.scalars(query.order_by(GpsTrackSample.recorded_at)))

    def _backfill_bounds(self, flight, points):
        session = flight.session
        if not session or session.deleted_at or flight.stop_reason:
            return
        candidate = flight.actual_departure or (
            min(p.at for p in points) if points else session.started_at
        )
        first_track = (
            bool(points)
            and session.source != 'FLIGHT_TRACK'
            and not flight.actual_departure
        )
        if candidate < session.started_at or first_track:
            earlier = self.db.scalars(
                select(GpsTrackingSession).where(
                    GpsTrackingSession.trip_id == flight.trip_id,
                    GpsTrackingSession.id != session.id,
                    GpsTrackingSession.source.in_(('FLIGHT_ESTIMATE', 'FLIGHT_TRACK')),
                    GpsTrackingSession.deleted_at.is_(None),
                    GpsTrackingSession.started_at <= session.started_at,
                )
            ).all()
            boundary = max(
                (s.ended_at for s in earlier if s.ended_at), default=candidate
            )
            session.started_at = (
                max(candidate, boundary)
                if first_track
                else min(session.started_at, max(candidate, boundary))
            )
        if (
            session.ended_at
            and flight.final_track_pending
            and not flight.actual_arrival
            and points
        ):
            session.ended_at = (
                max(
                    session.started_at + timedelta(microseconds=1),
                    max(p.at for p in points),
                )
                if session.source != 'FLIGHT_TRACK'
                else max(session.ended_at, max(p.at for p in points))
            )

    def _merge_observations(self, flight, points):
        session = flight.session
        if not session or session.deleted_at or flight.stop_reason:
            return False
        points = [
            p
            for p in points
            if (flight.actual_departure is None or p.at >= flight.actual_departure)
            and (flight.actual_arrival is None or p.at <= flight.actual_arrival)
        ]
        if not points:
            return False
        self._backfill_bounds(flight, points)
        points = [
            p
            for p in points
            if session.started_at <= p.at
            and (session.ended_at is None or p.at <= session.ended_at)
        ]
        if not points:
            return False
        if session.source != 'FLIGHT_TRACK':
            self.db.execute(
                delete(GpsTrackSample).where(GpsTrackSample.session_id == session.id)
            )
            session.source = 'FLIGHT_TRACK'
            self.db.flush()
        retained = {p.recorded_at: p for p in self.observations(flight)}
        for point in points:
            if point.at in retained:
                retained[point.at].latitude = point.latitude
                retained[point.at].longitude = point.longitude
            else:
                row = self._sample(flight, point.at, (point.longitude, point.latitude))
                self.db.add(row)
                retained[point.at] = row
        self.db.flush()
        return True

    def _track_result(self, flight, result, now, *, reserved=False):
        if flight.final_track_pending:
            if now >= flight.final_track_deadline:
                flight.final_track_pending = False
                flight.next_check_at = None
                return
            if not reserved:
                flight.final_track_attempts += 1
        elif self.terminal(flight):
            return
        error = result if isinstance(result, FlightUnavailable) else None
        if error:
            flight.last_check_result = error.result
        nonempty = self._merge_observations(flight, result) if error is None else False
        if flight.final_track_pending:
            if (
                nonempty
                or flight.final_track_attempts >= 3
                or (error and error.result == 'CONFIGURATION_ERROR')
            ):
                flight.final_track_pending = False
                flight.next_check_at = None
                return
            flight.next_check_at = min(
                flight.final_track_deadline,
                now + timedelta(minutes=self.polling_policy.check_interval_minutes),
            )
        if error:
            flight.last_check_result = error.result
            if error.result == 'CONFIGURATION_ERROR':
                flight.next_check_at = None
            elif error.result == 'RATE_LIMITED':
                flight.next_check_at = now + timedelta(
                    seconds=max(
                        1,
                        error.retry_after_seconds
                        if error.retry_after_seconds is not None
                        else 2700,
                    )
                )
                if flight.final_track_pending:
                    flight.next_check_at = min(
                        flight.next_check_at, flight.final_track_deadline
                    )

    def apply_updates(self, trip_id, updates, observed_at, track_results=None):
        """Apply all known arrivals before any later departure, under one lock."""
        self.lock(trip_id)
        flights = self.flights(trip_id)
        actionable = []
        track_results = track_results or {}
        for flight in flights:
            facts = updates.get(flight.id)
            if facts is None or self.terminal(flight):
                continue
            flight.provider_flight_id = (
                facts.provider_flight_id or flight.provider_flight_id
            )
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
        # Original flight order keeps late arrivals ahead of the next departure.
        for flight, facts in actionable:
            result = track_results.get(flight.id)
            points = result if isinstance(result, list) else []
            if facts.departure_confirmed or flight.status == 'ARRIVED':
                boundary = flight.actual_departure or (
                    min(p.at for p in points)
                    if points
                    else flight.scheduled_departure
                    if flight.status == 'ARRIVED'
                    else observed_at
                )
                self._start(flight, boundary, observed_at)
            if self.terminal(flight):
                continue
            self._backfill_bounds(flight, points)
            if points:
                self._merge_observations(flight, points)
            if flight.status == 'ARRIVED' and flight.session:
                end = flight.actual_arrival or (
                    max(p.at for p in points) if points else flight.estimated_arrival
                )
                # A lone observation still establishes a usable recording boundary.
                end = max(end, flight.session.started_at + timedelta(microseconds=1))
                self.finalize(flight, end, 'PROVIDER')
                flight.final_track_deadline = observed_at + timedelta(hours=6)
                flight.next_check_at = observed_at + timedelta(
                    minutes=self.polling_policy.check_interval_minutes
                )
            else:
                flight.next_check_at = self.next_check(flight, observed_at)
            if result is not None:
                self._track_result(flight, result, observed_at)
        self.db.flush()

    def _resolve_airport(self, endpoint):
        return resolve_flight_airport(self.db, endpoint)

    def next_check(self, flight, now):
        return self.polling_policy.next_check(flight, now)

    def poll_due(
        self,
        provider,
        now=None,
        *,
        cancelled=lambda: False,
        verify_ownership=lambda: None,
        configuration_is_current=lambda: True,
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
        pending = []
        for flight in due:
            if flight.final_track_pending:
                self.lock(flight.trip_id)
                self.db.refresh(flight)
                if (
                    flight.stop_reason
                    or not flight.session
                    or flight.session.deleted_at
                    or now >= flight.final_track_deadline
                    or flight.final_track_attempts >= 3
                ):
                    flight.final_track_pending = False
                    flight.next_check_at = None
                else:
                    pending.append(flight)
                continue
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
        account_error = None
        # Status collection precedes track retrieval: slow tracks cannot delay
        # recording arrival or starting the next leg.
        for (number, date), grouped in groups.items():
            if cancelled() or account_error:
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
            except FlightUnavailable as exc:
                verify_ownership()
                logger.warning(
                    'flight_monitor.provider_refusal',
                    extra={
                        **(log_context or {}),
                        'provider': getattr(provider, 'name', 'unconfigured'),
                        'attempted_requests': calls,
                        'outcome': exc.result,
                    },
                )
                for flight in grouped:
                    failures[flight.id] = (flight, exc)
                if exc.result in ('RATE_LIMITED', 'CONFIGURATION_ERROR'):
                    account_error = exc
        if account_error:
            for flight in due:
                if flight.id not in all_updates[flight.trip_id]:
                    if account_error.result == 'CONFIGURATION_ERROR':
                        failures.setdefault(flight.id, (flight, account_error))
                    else:
                        failures[flight.id] = (flight, account_error)
        verify_ownership()
        if (
            any(exc.result == 'CONFIGURATION_ERROR' for _, exc in failures.values())
            and not configuration_is_current()
        ):
            failures = {
                key: (flight, exc)
                for key, (flight, exc) in failures.items()
                if exc.result != 'CONFIGURATION_ERROR'
            }
        failures_by_trip = defaultdict(list)
        for flight, exc in failures.values():
            failures_by_trip[flight.trip_id].append((flight, exc))
        for trip_id in sorted(all_updates.keys() | failures_by_trip.keys()):
            verify_ownership()
            self.lock(trip_id)
            if all_updates[trip_id]:
                self.apply_updates(trip_id, all_updates[trip_id], now)
            for flight, exc in failures_by_trip[trip_id]:
                self._failure(flight, now, exc)
        verify_ownership()
        self.db.commit()

        tracks = defaultdict(dict)
        reserved = set()
        track_cache = {}
        target_ids = {f.id for f in pending} | {
            key for values in all_updates.values() for key in values
        }
        for original in due:
            if original.id not in target_ids or cancelled() or account_error:
                continue
            verify_ownership()
            self.lock(original.trip_id)
            flight = self.db.scalar(
                select(TrackedFlight)
                .where(TrackedFlight.id == original.id)
                .execution_options(populate_existing=True)
            )
            if (
                flight is None
                or not flight.session
                or flight.session.deleted_at
                or flight.stop_reason
                or (self.terminal(flight) and not flight.final_track_pending)
            ):
                self.db.commit()
                continue
            if flight.final_track_pending:
                if (
                    now >= flight.final_track_deadline
                    or flight.final_track_attempts >= 3
                ):
                    flight.final_track_pending = False
                    flight.next_check_at = None
                    self.db.commit()
                    continue
                # Reserve every final attempt, including the arrival poll's,
                # before HTTP. Crashes/restarts cannot reset the attempt budget.
                flight.final_track_attempts += 1
                flight.checked_at = now
                flight.next_check_at = min(
                    flight.final_track_deadline,
                    now + timedelta(minutes=self.polling_policy.check_interval_minutes),
                )
                reserved.add(flight.id)
            provider_id = flight.provider_flight_id
            self.db.commit()
            if provider_id not in track_cache:
                try:
                    if provider is None or not provider.is_configured():
                        raise FlightUnavailable(result='CONFIGURATION_ERROR')
                    if not provider_id:
                        raise FlightUnavailable()
                    calls += 1
                    self.attempted_requests = calls
                    track_cache[provider_id] = provider.positions(provider_id)
                except FlightUnavailable as exc:
                    track_cache[provider_id] = exc
                    if exc.result in ('RATE_LIMITED', 'CONFIGURATION_ERROR'):
                        account_error = exc
                verify_ownership()
            tracks[flight.trip_id][flight.id] = track_cache[provider_id]
        verify_ownership()
        has_config_error = any(
            isinstance(r, FlightUnavailable) and r.result == 'CONFIGURATION_ERROR'
            for values in tracks.values()
            for r in values.values()
        )
        if has_config_error and not configuration_is_current():
            tracks = defaultdict(
                dict,
                {
                    trip: {
                        key: result
                        for key, result in values.items()
                        if not isinstance(result, FlightUnavailable)
                        or result.result != 'CONFIGURATION_ERROR'
                    }
                    for trip, values in tracks.items()
                },
            )
        affected_trips = tracks.keys() | (
            {f.trip_id for f in due}
            if account_error and account_error.result == 'RATE_LIMITED'
            else set()
        )
        for trip_id in sorted(affected_trips):
            verify_ownership()
            self.lock(trip_id)
            for flight in self.flights(trip_id):
                # Cancellation by any owner mutation wins over an outstanding result.
                if flight.id in tracks[trip_id] and (
                    not self.terminal(flight) or flight.final_track_pending
                ):
                    flight.last_check_result = 'OK'
                    self._track_result(
                        flight,
                        tracks[trip_id][flight.id],
                        now,
                        reserved=flight.id in reserved,
                    )
                if (
                    account_error
                    and account_error.result == 'RATE_LIMITED'
                    and flight.next_check_at is not None
                ):
                    delayed = now + timedelta(
                        seconds=max(
                            1,
                            account_error.retry_after_seconds
                            if account_error.retry_after_seconds is not None
                            else 2700,
                        )
                    )
                    flight.next_check_at = max(flight.next_check_at, delayed)
                    if flight.final_track_pending:
                        flight.next_check_at = min(
                            flight.next_check_at, flight.final_track_deadline
                        )
                    flight.last_check_result = 'RATE_LIMITED'
        verify_ownership()
        self.db.commit()
        return calls

    def _failure(self, flight, now, exc):
        self.lock(flight.trip_id)
        self.db.refresh(flight)
        if self.terminal(flight) and not flight.final_track_pending:
            return
        flight.last_check_result = exc.result
        if exc.result == 'CONFIGURATION_ERROR':
            flight.final_track_pending = False
            flight.next_check_at = None
        elif exc.result == 'RATE_LIMITED':
            seconds = (
                exc.retry_after_seconds if exc.retry_after_seconds is not None else 2700
            )
            flight.next_check_at = now + timedelta(seconds=max(1, seconds))
        else:
            flight.next_check_at = (
                now + timedelta(minutes=self.polling_policy.check_interval_minutes)
                if flight.final_track_pending
                else self.next_check(flight, now)
            )
        if flight.final_track_pending:
            flight.next_check_at = min(
                flight.next_check_at, flight.final_track_deadline
            )

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
            self.cancel_final(flight.session)
            self.db.commit()
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
            observations = (
                self.observations(flight, now if live or full else boundary)
                if not deleted
                else []
            )
            latest = observations[-1] if observations else None
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
                estimate_basis=e.basis if e and not latest else None,
                position_source='FLIGHT_TRACK'
                if latest
                else 'FLIGHT_ESTIMATE'
                if e
                else None,
                position_at=latest.recorded_at
                if latest
                else e.position_at
                if e
                else None,
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
