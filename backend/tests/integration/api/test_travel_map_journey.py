"""Current guidance and future itinerary selection for the Travel map."""
# ruff: noqa: F811 -- reused flight lifecycle fixture

import uuid
from datetime import timedelta

import pytest

from factories.locations import create_location
from factories.places import create_place
from integration.api.test_flight_tracking import START, setup  # noqa: F401
from integration.api.test_tracking import _auth_headers
from models.api.planning import Endpoint
from models.database.gps_tracking import GpsTrackSample, GpsTrackingSession
from models.database.itinerary import (
    ItineraryConnection,
    ItineraryStop,
    ItineraryTravelSegment,
)
from models.database.settings import AppSetting
from services.flight_providers.flight_provider import FlightMovement, FlightObservation
from services.gps.journey_service import current_journey
from services.trip_access import get_trip_read_access


def phone_point(s, at, latitude, longitude):
    s.db.add(
        GpsTrackSample(
            id=uuid.uuid4(),
            trip_id=s.trip.id,
            session_id=s.phone.id,
            recorded_at=at,
            latitude=latitude,
            longitude=longitude,
            travel_mode='CAR',
        )
    )
    s.db.commit()


@pytest.fixture
def journey(setup, monkeypatch):
    s = setup
    s.second = s.add('NZ2946', START + timedelta(hours=4))
    s.frankfurt = create_place(
        s.db, name='Frankfurt Airport', latitude=50.04, longitude=8.56
    )
    s.frankfurt.timezone = 'Europe/Berlin'
    s.frankfurt.iata_code = 'FRA'
    s.flight.arrival_airport_place_id = s.frankfurt.id
    s.second.departure_airport_place_id = s.frankfurt.id
    s.connection.segments[0].flight.arrival_airport_place_id = s.frankfurt.id
    s.connection.segments[1].flight.departure_airport_place_id = s.frankfurt.id
    s.lisbon = s.connection.to_stop.location
    s.lisbon.name, s.lisbon.latitude, s.lisbon.longitude = 'Lisbon', 38.72, -9.14
    s.connection.to_stop.planned_nights = 2
    home = create_location(
        s.db,
        trip_id=s.trip.id,
        created_by=s.owner.id,
        name='Eindhoven',
        latitude=51.44,
        longitude=5.48,
    )
    s.connection.from_location_id = home.id
    s.connection.segments.append(
        ItineraryTravelSegment(
            trip_id=s.trip.id,
            position=2,
            travel_mode='CAR',
            mode_source='USER',
            to_location_id=s.lisbon.id,
        )
    )
    porto = create_location(
        s.db,
        trip_id=s.trip.id,
        created_by=s.owner.id,
        name='Porto',
        latitude=41.16,
        longitude=-8.63,
    )
    porto_stop = ItineraryStop(
        trip_id=s.trip.id,
        location_id=porto.id,
        title='Porto',
        planned_start_date=START.date() + timedelta(days=2),
        planned_nights=2,
        same_day_position=0,
        created_by=s.owner.id,
    )
    s.db.add(porto_stop)
    s.db.flush()
    s.porto_connection = ItineraryConnection(
        trip_id=s.trip.id,
        from_stop_id=s.connection.to_stop_id,
        to_stop_id=porto_stop.id,
    )
    s.db.add(s.porto_connection)
    s.trip.start_date = START.date()
    s.trip.share_live_location = True
    s.phone = GpsTrackingSession(
        id=uuid.uuid4(),
        trip_id=s.trip.id,
        recorded_by_user_id=s.owner.id,
        source='MOBILE_GPS',
        started_at=START - timedelta(hours=1),
    )
    s.db.add(s.phone)
    s.db.commit()
    phone_point(s, START - timedelta(minutes=5), 51.44, 5.48)
    s.now = START
    monkeypatch.setattr('services.gps.journey_service.utcnow', lambda: s.now)
    return s


def fly(s, flight, latitude, longitude):
    departure = flight.departure_airport
    observation = FlightObservation(s.now - timedelta(minutes=10), latitude, longitude)
    s.service.apply_updates(
        s.trip.id,
        {
            flight.id: FlightMovement(
                scheduled_departure=flight.scheduled_departure,
                departure_airport=Endpoint(
                    latitude=departure.latitude,
                    longitude=departure.longitude,
                    iata_code=departure.iata_code,
                ),
                status='IN_FLIGHT',
                departure_confirmed=True,
                actual_departure=flight.scheduled_departure,
                estimated_arrival=flight.scheduled_arrival,
            )
        },
        s.now,
        track_results={flight.id: [observation]},
    )
    s.db.commit()
    # A newer phone sample must not displace the active flight's observation.
    phone_point(s, s.now - timedelta(minutes=1), 51, 5)
    result = current_journey(s.db, s.trip.id, s.owner.id)
    assert result.active_flight_id == flight.id
    assert result.position.source == 'FLIGHT_TRACK'
    assert result.position.at == observation.at
    assert (result.position.longitude, result.position.latitude) == (
        longitude,
        latitude,
    )
    assert result.remaining_flight_route.coordinates[0] == pytest.approx(
        (longitude, latitude)
    )
    assert result.connector is None
    return result


def test_two_flights_layover_and_final_drive(journey):
    s = journey
    initial = current_journey(s.db, s.trip.id, s.owner.id)
    assert initial.current_connection_id == s.connection.id
    assert initial.current_flight_segment_index == 0
    assert initial.target.name == s.departure.name
    assert initial.connector.coordinates == [(5.48, 51.44), (4.76, 52.31)]
    assert initial.active_flight_id is None

    s.now = START + timedelta(hours=1)
    first = fly(s, s.flight, 51, 7)
    assert first.current_flight_segment_index == 0
    assert first.target.name == s.frankfurt.name

    s.service.finalize(s.flight, START + timedelta(hours=2), 'PROVIDER')
    s.now = START + timedelta(hours=2, minutes=5)
    phone_point(
        s, s.now - timedelta(minutes=1), s.frankfurt.latitude, s.frankfurt.longitude
    )
    layover = current_journey(s.db, s.trip.id, s.owner.id)
    assert layover.active_flight_id is None
    assert layover.current_flight_segment_index == 1
    assert layover.target.name == s.frankfurt.name
    assert layover.position.source == 'MOBILE_GPS'
    assert layover.connector is None  # Same airport; no line back to AMS.
    phone_point(s, s.now, 50.03, 8.55)
    layover = current_journey(s.db, s.trip.id, s.owner.id)
    assert layover.connector.coordinates == [(8.55, 50.03), (8.56, 50.04)]

    s.now = START + timedelta(hours=5)
    second = fly(s, s.second, 45, 0)
    assert second.current_flight_segment_index == 1
    assert second.target.name == s.arrival.name

    s.service.finalize(s.second, START + timedelta(hours=6), 'PROVIDER')
    s.now = START + timedelta(hours=6, minutes=5)
    phone_point(s, s.now, s.arrival.latitude, s.arrival.longitude)
    landed = current_journey(s.db, s.trip.id, s.owner.id)
    assert landed.current_connection_id == s.connection.id
    assert landed.current_flight_segment_index is None
    assert landed.active_flight_id is None
    assert landed.target.name == 'Lisbon'
    assert landed.connector.coordinates == [(-9.13, 38.77), (-9.14, 38.72)]


@pytest.mark.parametrize('fallback', ['disabled', 'manual', 'no_number', 'mixed'])
def test_direct_fallback_for_untracked_flights(journey, fallback):
    s = journey
    if fallback == 'disabled':
        s.db.get(AppSetting, 'flights.provider').value = 'none'
    else:
        index = 1 if fallback == 'mixed' else 0
        flight = s.second if index else s.flight
        plan = s.connection.segments[index].flight
        plan.lookup = None
        plan.lookup_owner_user_id = None
        if fallback == 'no_number':
            plan.flight_number = ''
        s.db.delete(flight)
    s.db.commit()
    result = current_journey(s.db, s.trip.id, s.owner.id)
    assert result.current_connection_id == s.connection.id
    assert result.current_flight_segment_index is None
    assert result.active_flight_id is None
    assert result.target.name == 'Lisbon'
    assert result.connector.coordinates == [(5.48, 51.44), (-9.14, 38.72)]


def test_temporary_failure_keeps_airport_guidance(journey):
    s = journey
    s.flight.last_check_result = 'UNAVAILABLE'
    s.db.commit()
    result = current_journey(s.db, s.trip.id, s.owner.id)
    assert result.current_flight_segment_index == 0
    assert result.target.name == s.departure.name


@pytest.mark.parametrize('saved_airport_id', [True, False])
def test_retrieved_plan_before_monitor_adoption_keeps_airport_guidance(
    journey, saved_airport_id
):
    s = journey
    s.db.delete(s.flight)
    if not saved_airport_id:
        s.connection.segments[0].flight.departure_airport_place_id = None
    s.db.commit()
    result = current_journey(s.db, s.trip.id, s.owner.id)
    assert result.current_flight_segment_index == 0
    assert result.target.type == 'AIRPORT'
    assert (result.target.longitude, result.target.latitude) == (4.76, 52.31)
    assert result.connector.coordinates == [(5.48, 51.44), (4.76, 52.31)]


def test_disabling_tracking_uses_phone_guidance_without_changing_recording(journey):
    s = journey
    s.now = START + timedelta(hours=1)
    fly(s, s.flight, 51, 7)
    s.db.get(AppSetting, 'flights.provider').value = 'none'
    s.db.commit()
    result = current_journey(s.db, s.trip.id, s.owner.id)
    assert result.position.source == 'MOBILE_GPS'
    assert result.active_flight_id is None
    assert result.current_flight_segment_index is None
    assert result.target.name == 'Lisbon'
    assert result.remaining_flight_route is None
    assert s.flight.session.ended_at is None
    assert len(s.service.observations(s.flight)) == 1


def test_flight_selection_follows_itinerary_order(journey):
    s = journey
    s.second.scheduled_departure = START - timedelta(hours=2)
    s.db.commit()
    result = current_journey(s.db, s.trip.id, s.owner.id)
    assert result.current_flight_segment_index == 0
    assert result.target.name == s.departure.name


def test_staying_in_sevilla_does_not_target_tomorrows_airport(journey):
    s = journey
    sevilla = create_location(
        s.db,
        trip_id=s.trip.id,
        created_by=s.owner.id,
        name='Sevilla',
        latitude=37.39,
        longitude=-5.98,
    )
    stop = ItineraryStop(
        trip_id=s.trip.id,
        location_id=sevilla.id,
        title='Sevilla',
        planned_start_date=START.date() - timedelta(days=2),
        planned_nights=3,
        same_day_position=0,
        created_by=s.owner.id,
    )
    s.db.add(stop)
    s.db.flush()
    s.connection.from_location_id = None
    s.connection.from_stop_id = stop.id
    s.connection.to_stop.planned_start_date = START.date() + timedelta(days=1)
    s.trip.start_date = stop.planned_start_date
    s.db.commit()
    result = current_journey(s.db, s.trip.id, s.owner.id)
    assert result.current_connection_id is None
    assert result.current_flight_segment_index is None
    assert result.target.type == 'CURRENT_STOP'
    assert result.target.name == 'Sevilla'
    assert result.connector.coordinates[-1] == (-5.98, 37.39)


def test_before_trip_start_only_future_travel_is_planned(journey):
    s = journey
    s.trip.start_date = START.date() + timedelta(days=1)
    s.connection.to_stop.planned_start_date = s.trip.start_date
    s.db.commit()
    result = current_journey(s.db, s.trip.id, s.owner.id)
    assert result.position is not None
    assert result.current_connection_id is None
    assert result.target is None
    assert result.connector is None


def test_fallback_preserves_live_sharing_access(journey, client, api_prefix):
    s = journey
    s.db.get(AppSetting, 'flights.provider').value = 'none'
    s.trip.share_live_location = False
    s.db.commit()
    url = f'{api_prefix}/trips/{s.trip.id}/tracking/journey'
    hidden = client.get(url).json()
    assert hidden['position'] is None
    assert hidden['target'] is None
    assert hidden['current_connection_id'] is None
    member = client.get(url, headers=_auth_headers(s.owner)).json()
    assert member['visible_to_members_only'] is True
    assert member['target']['name'] == 'Lisbon'
    assert member['current_flight_segment_index'] is None


@pytest.mark.parametrize('stage', ['before', 'airborne', 'layover', 'arrived'])
def test_journey_uses_linked_segments_after_connection_ids_change(journey, stage):
    s = journey
    s.flight.itinerary_connection_id = uuid.uuid4()
    s.second.itinerary_connection_id = uuid.uuid4()
    s.db.commit()
    if stage != 'before':
        s.now = START + timedelta(hours=1)
        fly(s, s.flight, 51, 7)
        s.service.finalize(s.flight, START + timedelta(hours=2), 'PROVIDER')
        s.db.commit()
        s.now = START + timedelta(hours=2, minutes=5)
    if stage in ('airborne', 'arrived'):
        s.now = START + timedelta(hours=5)
        fly(s, s.second, 45, 0)
    if stage == 'arrived':
        s.service.finalize(s.second, START + timedelta(hours=6), 'PROVIDER')
        s.db.commit()
        s.now = START + timedelta(hours=6, minutes=5)
    result = current_journey(s.db, s.trip.id, s.owner.id)
    assert result.current_connection_id == s.connection.id
    assert (
        result.current_flight_segment_index
        == {
            'before': 0,
            'airborne': 1,
            'layover': 1,
            'arrived': None,
        }[stage]
    )
    assert (
        result.target.name
        == {
            'before': s.departure.name,
            'airborne': s.arrival.name,
            'layover': s.frankfurt.name,
            'arrived': 'Lisbon',
        }[stage]
    )
    if stage == 'airborne':
        assert result.active_flight_id == s.second.id
        assert result.remaining_flight_route is not None


def test_cards_resolve_current_connection_without_rewriting_flight_rows(journey):
    s = journey
    old_first, old_second = uuid.uuid4(), uuid.uuid4()
    s.flight.itinerary_connection_id = old_first
    s.second.itinerary_connection_id = old_second
    s.db.commit()
    access = get_trip_read_access(s.db, trip_id=s.trip.id, current_user_id=s.owner.id)
    cards = s.service.cards(access, [], START)
    assert len(cards) == 1
    assert cards[0].itinerary_connection_id == s.connection.id
    assert [flight.id for flight in cards[0].flights] == [s.flight.id, s.second.id]
    s.db.flush()
    s.db.expire_all()
    assert s.flight.itinerary_connection_id == old_first
    assert s.second.itinerary_connection_id == old_second


@pytest.mark.parametrize('has_lookup', [True, False])
def test_sync_refreshes_retained_connection_id(setup, has_lookup):
    s = setup
    s.flight.itinerary_connection_id = uuid.uuid4()
    if not has_lookup:
        s.connection.segments[0].flight.lookup = None
        s.connection.segments[0].flight.lookup_owner_user_id = None
    s.db.commit()
    s.service.sync_itinerary(s.trip.id)
    s.db.commit()
    assert s.flight.itinerary_connection_id == s.connection.id
