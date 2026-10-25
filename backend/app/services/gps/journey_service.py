"""Live journey guidance derived from itinerary and permitted tracking positions."""

from sqlalchemy import select

from models.api.flights import JourneyPosition, JourneyResponse, JourneyTarget
from models.api.geojson import GeoJsonLineString
from models.api.itinerary import is_itinerary_stop_visited
from models.api.planning import FlightLookup
from models.database.base import utcnow
from models.database.gps_tracking import GpsTrackSample, GpsTrackingSession
from models.database.itinerary import ItineraryConnection, ItineraryStop
from models.database.posts import Post
from models.database.places import Place
from services.flight_settings import FlightSettingsSnapshot
from services.gps.flight_geometry import arc, arc_point, estimate
from services.gps.flight_tracking_service import (
    FlightTrackingService,
    airport_coordinates,
)
from services.trip_access import get_trip_read_access
from services.trip_errors import TripNotFoundError


def current_journey(db, trip_id, user_id, share_token=None):
    now = utcnow()
    access = get_trip_read_access(
        db, trip_id=trip_id, current_user_id=user_id, share_token=share_token
    )
    if access is None:
        raise TripNotFoundError('Trip not found')
    result = JourneyResponse(server_time=now)
    if access.membership is None and not access.trip.share_live_location:
        return result
    result.visible_to_members_only = bool(
        access.membership and not access.trip.share_live_location
    )
    service = FlightTrackingService(db)
    flights = service.flights(trip_id)
    connection_ids = service.itinerary_connection_ids(flights)
    tracking_enabled = (
        FlightSettingsSnapshot.load(db).reader(db).get_value('flights.provider')
        != 'none'
    )
    active = next(
        (
            f
            for f in flights
            if tracking_enabled
            and f.session
            and f.session.ended_at is None
            and not f.session.deleted_at
            and not f.stop_reason
        ),
        None,
    )
    stops = list(
        db.scalars(
            select(ItineraryStop)
            .where(ItineraryStop.trip_id == trip_id)
            .order_by(ItineraryStop.planned_start_date, ItineraryStop.same_day_position)
        )
    )
    stop = next(
        (
            s
            for s in stops
            if not is_itinerary_stop_visited(
                planned_start_date=s.planned_start_date,
                planned_nights=s.planned_nights,
                today=now.date(),
            )
        ),
        None,
    )
    connections = list(
        db.scalars(
            select(ItineraryConnection).where(ItineraryConnection.trip_id == trip_id)
        )
    )
    connection = None
    if active:
        connection = next(
            (c for c in connections if c.id == connection_ids[active.id]), None
        )
    elif (
        stop
        and stop.planned_start_date >= now.date()
        and now.date() >= access.trip.start_date
    ):
        previous = stops[stops.index(stop) - 1] if stops.index(stop) else None
        if previous is None or is_itinerary_stop_visited(
            planned_start_date=previous.planned_start_date,
            planned_nights=previous.planned_nights,
            today=now.date(),
        ):
            connection = next((c for c in connections if c.to_stop_id == stop.id), None)
    elif stop is None and access.trip.end_date and now.date() == access.trip.end_date:
        connection = next((c for c in connections if c.to_stop_id is None), None)
    result.current_connection_id = (
        connection_ids[active.id]
        if active
        else connection.id
        if connection
        else None
    )
    row = db.scalar(
        select(GpsTrackSample)
        .join(GpsTrackingSession, GpsTrackingSession.id == GpsTrackSample.session_id)
        .where(
            GpsTrackSample.trip_id == trip_id,
            GpsTrackingSession.deleted_at.is_(None),
            GpsTrackSample.recorded_at <= now,
        )
        .order_by(
            GpsTrackSample.recorded_at.desc(),
            GpsTrackingSession.source.asc(),
            GpsTrackSample.id.desc(),
        )
        .limit(1)
    )
    if row:
        result.position = JourneyPosition(
            latitude=row.latitude,
            longitude=row.longitude,
            at=row.recorded_at,
            source=row.session.source,
        )
    else:
        post = db.scalar(
            select(Post)
            .where(
                Post.trip_id == trip_id,
                Post.published_at.is_not(None),
                Post.occurred_at <= now,
            )
            .order_by(Post.occurred_at.desc(), Post.id.desc())
            .limit(1)
        )
        if post:
            result.position = JourneyPosition(
                latitude=post.location.latitude,
                longitude=post.location.longitude,
                at=post.occurred_at,
                source='POST_CONNECTOR',
            )
    target = (
        connection.to_stop.location
        if connection and connection.to_stop
        else connection.to_location
        if connection
        else stop.location
        if stop and now.date() >= access.trip.start_date
        else None
    )
    if target:
        result.target = JourneyTarget(
            type='DESTINATION' if connection else 'CURRENT_STOP',
            name=target.name,
            latitude=target.latitude,
            longitude=target.longitude,
        )
    current_flights = [
        f
        for f in flights
        if connection_ids[f.id] == result.current_connection_id
        and (f.itinerary_travel_segment_id or f.session)
    ]
    # Unmatched/manual flight plans have no completion lifecycle. For that
    # connection, use direct destination guidance instead of stranding the
    # traveller at an airport. Temporary provider failures keep matched rows.
    flight_segments = (
        [segment for segment in connection.segments if segment.travel_mode == 'FLIGHT']
        if connection
        else []
    )
    flights_by_segment = {f.itinerary_travel_segment_id: f for f in current_flights}
    flight_guidance = tracking_enabled and not any(
        not segment.flight
        or not segment.flight.flight_number
        or (not segment.flight.lookup and segment.id not in flights_by_segment)
        for segment in flight_segments
    )
    if not flight_guidance:
        active = None
    next_segment = None
    next_flight = None
    if flight_guidance and connection:
        for index, segment in enumerate(connection.segments):
            if segment.travel_mode != 'FLIGHT':
                continue
            flight = flights_by_segment.get(segment.id)
            if active:
                if segment.id != active.itinerary_travel_segment_id:
                    continue
            elif flight and (flight.status == 'CANCELLED' or service.terminal(flight)):
                continue
            result.current_flight_segment_index = index
            next_segment, next_flight = segment, flight
            break
    if active or next_segment:
        if active:
            airport = active.arrival_airport
        elif next_flight:
            airport = next_flight.departure_airport
        else:
            # A retrieved itinerary may precede the monitor adopting its
            # tracking record. Its saved airport still supplies the target.
            plan = next_segment.flight
            airport = (
                db.get(Place, plan.departure_airport_place_id)
                if plan.departure_airport_place_id
                else FlightLookup.model_validate(plan.lookup).departure_airport
            )
        result.target = (
            JourneyTarget(
                type='AIRPORT',
                name=airport.name or airport.iata_code or 'Departure airport',
                latitude=airport.latitude,
                longitude=airport.longitude,
            )
            if airport
            else None
        )
    if active:
        result.active_flight_id = active.id
        e = estimate(active, now)
        observed = service.observations(active, now)
        if observed:
            point = observed[-1]
            result.position = JourneyPosition(
                latitude=point.latitude,
                longitude=point.longitude,
                at=point.recorded_at,
                source='FLIGHT_TRACK',
            )
            if active.arrival_airport:
                result.remaining_flight_route = GeoJsonLineString(
                    coordinates=arc(
                        (point.longitude, point.latitude),
                        airport_coordinates(active.arrival_airport),
                    )
                )
        elif e:
            start, end = (
                airport_coordinates(active.departure_airport),
                airport_coordinates(active.arrival_airport),
            )
            lon, lat = arc_point(start, end, e.progress)
            result.position = JourneyPosition(
                latitude=lat, longitude=lon, at=e.position_at, source='FLIGHT_ESTIMATE'
            )
            result.remaining_flight_route = GeoJsonLineString(
                coordinates=arc(start, end, begin=e.progress)
            )
        else:
            result.position = None
        return result
    if (
        result.position
        and result.target
        and (
            result.position.longitude != result.target.longitude
            or result.position.latitude != result.target.latitude
        )
    ):
        result.connector = GeoJsonLineString(
            coordinates=[
                (result.position.longitude, result.position.latitude),
                (result.target.longitude, result.target.latitude),
            ]
        )
    return result
