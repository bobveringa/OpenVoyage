"""Flight lifecycle, privacy boundaries and GPS interoperability on PostgreSQL."""

import uuid
from dataclasses import replace
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import Mock

import pytest
from sqlalchemy import func, select
from sqlalchemy.exc import DBAPIError

from factories.locations import create_location
from factories.places import create_place
from factories.trips import add_trip_member, create_trip
from factories.users import create_user
from models.api.planning import Endpoint, FlightLookup
from models.database.gps_tracking import GpsTrackSample, GpsTrackingSession
from models.database.itinerary import (
    ItineraryConnection,
    ItinerarySegmentFlight,
    ItineraryStop,
    ItineraryTravelSegment,
)
from models.database.trips import TripVisibility
from models.database.settings import AppSetting
from services.flight_providers.flight_provider import FlightMovement, FlightUnavailable
from services.gps.flight_geometry import estimate
from services.gps.flight_tracking_service import FlightTrackingService
from services.trip_access import get_trip_read_access
from integration.api.test_tracking import _auth_headers
from integration.api.test_tracking_timeline import _create_post

START = datetime(2026, 8, 14, 8, tzinfo=timezone.utc)


@pytest.fixture
def setup(db_session):
    db = db_session
    owner = create_user(db)
    trip = create_trip(db, owner_id=owner.id, visibility=TripVisibility.PUBLIC)
    departure = create_place(db, name='Departure', latitude=52.31, longitude=4.76)
    arrival = create_place(db, name='Arrival', latitude=38.77, longitude=-9.13)
    for place, code, zone in (
        (departure, 'AMS', 'Europe/Amsterdam'),
        (arrival, 'LIS', 'Europe/Lisbon'),
    ):
        place.feature_class = 'S'
        place.iata_code, place.timezone, place.feature_code = code, zone, 'AIRP'
    location = create_location(db, trip_id=trip.id, created_by=owner.id)
    stop = ItineraryStop(
        trip_id=trip.id,
        location_id=location.id,
        planned_start_date=START.date(),
        same_day_position=0,
        title='Destination',
        planned_nights=1,
        created_by=owner.id,
    )
    db.add(stop)
    db.flush()
    connection = ItineraryConnection(
        trip_id=trip.id, to_stop_id=stop.id, from_location_id=location.id
    )
    db.add(connection)
    db.flush()
    service = FlightTrackingService(db)
    db.add(AppSetting(key='flights.provider', value='flightaware'))

    def add(number='KL123', departure_at=START):
        lookup = FlightLookup(
            flight_number=number,
            departure_date=departure_at.date(),
            fetched_at=START,
            departure_airport=Endpoint(
                latitude=departure.latitude,
                longitude=departure.longitude,
                iata_code='AMS',
                timezone=departure.timezone,
            ),
            arrival_airport=Endpoint(
                latitude=arrival.latitude, longitude=arrival.longitude, iata_code='LIS'
            ),
            scheduled_departure=departure_at,
            scheduled_arrival=departure_at + timedelta(hours=2),
        )
        segment = ItineraryTravelSegment(
            id=uuid.uuid4(),
            trip_id=trip.id,
            connection_id=connection.id,
            position=len(connection.segments),
            travel_mode='FLIGHT',
            mode_source='USER',
        )
        segment.flight = ItinerarySegmentFlight(
            trip_id=trip.id,
            segment_id=segment.id,
            flight_number=number,
            departure_date=departure_at.date(),
            departure_airport_place_id=departure.id,
            arrival_airport_place_id=arrival.id,
            lookup=lookup.model_dump(mode='json'),
            lookup_owner_user_id=owner.id,
        )
        connection.segments.append(segment)
        db.flush()
        service.sync_itinerary(trip.id)
        db.commit()
        return next(f for f in service.flights(trip.id) if f.flight_number == number)

    flight = add()
    return SimpleNamespace(
        db=db,
        owner=owner,
        trip=trip,
        departure=departure,
        arrival=arrival,
        service=service,
        flight=flight,
        add=add,
        connection=connection,
    )


def movement(s, **kwargs):
    return FlightMovement(
        scheduled_departure=s.flight.scheduled_departure,
        departure_airport=Endpoint(latitude=52.31, longitude=4.76, iata_code='AMS'),
        **kwargs,
    )


@pytest.mark.parametrize('via_job', [False, True])
def test_matched_candidate_without_manual_airport_ids_is_adopted(setup, via_job):
    s = setup
    plan = s.db.get(ItinerarySegmentFlight, s.flight.itinerary_travel_segment_id)
    s.db.delete(s.flight)
    plan.departure_airport_place_id = None
    plan.arrival_airport_place_id = None
    s.db.commit()
    revision = s.trip.itinerary_revision
    if via_job:
        provider = Mock()
        provider.track.return_value = []
        s.service.poll_due(provider, START + timedelta(minutes=1))
    else:
        s.service.sync_itinerary(s.trip.id)
        s.db.commit()
    tracked = s.service.flights(s.trip.id)
    assert len(tracked) == 1
    assert tracked[0].departure_airport_place_id == s.departure.id
    assert tracked[0].arrival_airport_place_id == s.arrival.id
    assert plan.departure_airport_place_id == s.departure.id
    assert plan.arrival_airport_place_id == s.arrival.id
    assert s.trip.itinerary_revision == revision + 1
    access = get_trip_read_access(s.db, trip_id=s.trip.id, current_user_id=s.owner.id)
    assert s.service.cards(access, [], START)[0].flights[0].flight_number == 'KL123'
    s.service.sync_itinerary(s.trip.id)
    s.db.commit()
    assert len(s.service.flights(s.trip.id)) == 1
    assert s.trip.itinerary_revision == revision + 1


def apply(s, facts, at=START + timedelta(hours=1)):
    s.service.apply_updates(s.trip.id, {s.flight.id: facts}, at)
    s.db.commit()


def count(s, flight=None):
    return s.db.scalar(
        select(func.count())
        .select_from(GpsTrackSample)
        .where(
            GpsTrackSample.session_id == (flight or s.flight).gps_tracking_session_id
        )
    )


def depart(s):
    apply(
        s,
        movement(
            s,
            status='IN_FLIGHT',
            departure_confirmed=True,
            actual_departure=START,
            estimated_arrival=START + timedelta(hours=2),
        ),
    )


def test_live_reads_interpolate_without_writes_and_mobile_runs_underneath(
    setup, client, api_prefix
):
    s = setup
    mobile_id = uuid.uuid4()
    base = f'{api_prefix}/trips/{s.trip.id}/tracking'
    auth = _auth_headers(s.owner)
    assert (
        client.post(
            f'{base}/sessions/{mobile_id}',
            headers=auth,
            json={'started_at': START.isoformat()},
        ).status_code
        == 201
    )
    depart(s)
    assert count(s) == 1
    e = estimate(s.flight, START + timedelta(hours=1))
    assert e.progress == 0.5
    apply(s, movement(s, estimated_arrival=START + timedelta(hours=3)))
    assert estimate(s.flight, START + timedelta(hours=1)).progress == pytest.approx(
        1 / 3
    )
    assert s.flight.actual_departure == START
    assert s.flight.status == 'IN_FLIGHT'
    for _ in range(2):
        response = client.get(
            f'{api_prefix}/trips/{s.trip.id}/posts/timeline', headers=auth
        )
        assert response.status_code == 200, response.text
        assert response.headers['cache-control'] == 'private, no-store'
        assert response.json()['flight_journeys'][0]['flights'][0]['progress'] == 0.99
        assert (
            client.get(f'{base}/journey', headers=auth).json()['position']['source']
            == 'FLIGHT_ESTIMATE'
        )
    assert count(s) == 1
    assert s.flight.session.ended_at is None
    sessions = client.get(f'{base}/sessions', headers=auth).json()['sessions']
    assert {row['source'] for row in sessions} == {'MOBILE_GPS', 'FLIGHT_ESTIMATE'}


def test_provider_finalizes_once_and_keeps_generated_points_outside_zone_filter(setup):
    s = setup
    depart(s)
    facts = movement(
        s,
        status='ARRIVED',
        departure_confirmed=True,
        arrival_confirmed=True,
        actual_departure=START,
        actual_arrival=START + timedelta(hours=1, minutes=45),
    )
    apply(s, facts, START + timedelta(hours=2))
    assert count(s) == 65
    assert s.flight.completion_source == 'PROVIDER'
    assert s.flight.final_track_pending
    original = [
        (p.id, p.recorded_at)
        for p in s.db.scalars(
            select(GpsTrackSample).where(
                GpsTrackSample.session_id == s.flight.gps_tracking_session_id
            )
        )
    ]
    apply(
        s,
        replace(facts, actual_arrival=START + timedelta(hours=3)),
        START + timedelta(hours=4),
    )
    assert original == [
        (p.id, p.recorded_at)
        for p in s.db.scalars(
            select(GpsTrackSample).where(
                GpsTrackSample.session_id == s.flight.gps_tracking_session_id
            )
        )
    ]


def test_owner_completion_validates_time_is_idempotent_and_owner_only(
    setup, client, api_prefix
):
    s = setup
    depart(s)
    member = create_user(s.db)
    add_trip_member(s.db, trip_id=s.trip.id, user_id=member.id)
    url = f'{api_prefix}/trips/{s.trip.id}/tracking/flights/{s.flight.id}/complete'
    payload = {'estimated_arrival': (START + timedelta(hours=2)).isoformat()}
    assert (
        client.post(url, headers=_auth_headers(member), json=payload).status_code == 403
    )
    for invalid in (START, datetime.now(timezone.utc) + timedelta(hours=1)):
        assert (
            client.post(
                url,
                headers=_auth_headers(s.owner),
                json={'estimated_arrival': invalid.isoformat()},
            ).status_code
            == 422
        )
    first = client.post(url, headers=_auth_headers(s.owner), json=payload)
    assert first.status_code == 200, first.text
    assert first.json()['completion_source'] == 'OWNER'
    assert first.json()['session']['sample_count'] == 65
    assert s.flight.actual_arrival is None
    assert (
        client.post(
            url,
            headers=_auth_headers(s.owner),
            json={'estimated_arrival': (START + timedelta(hours=3)).isoformat()},
        ).json()
        == first.json()
    )


@pytest.mark.parametrize('action', ['stop', 'delete'])
def test_stopped_or_deleted_recordings_never_recreated(
    setup, client, api_prefix, action
):
    s = setup
    depart(s)
    base = f'{api_prefix}/trips/{s.trip.id}/tracking'
    auth = _auth_headers(s.owner)
    path = f'{base}/sessions/{s.flight.gps_tracking_session_id}'
    response = (
        client.post(path + '/stop', headers=auth)
        if action == 'stop'
        else client.delete(path, headers=auth)
    )
    assert response.status_code == (200 if action == 'stop' else 204), response.text
    apply(
        s,
        movement(
            s,
            status='ARRIVED',
            departure_confirmed=True,
            arrival_confirmed=True,
            actual_arrival=START + timedelta(hours=2),
        ),
    )
    assert count(s) == (1 if action == 'stop' else 0)
    assert s.flight.completion_source is None
    card = client.get(
        f'{api_prefix}/trips/{s.trip.id}/posts/timeline', headers=auth
    ).json()['flight_journeys'][0]['flights'][0]
    assert card['progress'] is None
    if action == 'delete':
        assert card['stop_reason'] is None
    assert (
        client.post(
            f'{base}/flights/{s.flight.id}/complete',
            headers=auth,
            json={'estimated_arrival': datetime.now(timezone.utc).isoformat()},
        ).status_code
        == 409
    )


def test_active_flight_rejects_mobile_apis_and_point_edits(setup, client, api_prefix):
    s = setup
    depart(s)
    base = f'{api_prefix}/trips/{s.trip.id}/tracking'
    auth = _auth_headers(s.owner)
    path = f'{base}/sessions/{s.flight.gps_tracking_session_id}'
    for method, url, payload in [
        ('post', '/upload-token', None),
        ('get', '/upload-state', None),
        (
            'post',
            '/samples/batch',
            {
                'samples': [
                    {
                        'id': str(uuid.uuid4()),
                        'recorded_at': START.isoformat(),
                        'latitude': 52,
                        'longitude': 5,
                    }
                ]
            },
        ),
    ]:
        response = getattr(client, method)(
            path + url, headers=auth, **({'json': payload} if payload else {})
        )
        assert response.status_code == 403
        assert (
            response.json()['detail'] == 'Flight recordings are managed by the server.'
        )
    assert (
        client.put(path + '/points', headers=auth, json={'points': []}).json()[
            'detail'
        ]['code']
        == 'flight_recording_active'
    )
    point = s.db.scalar(
        select(GpsTrackSample).where(
            GpsTrackSample.session_id == s.flight.gps_tracking_session_id
        )
    )
    response = client.post(
        base + '/samples/delete', headers=auth, json={'sample_ids': [str(point.id)]}
    )
    assert response.status_code == 409


def test_diversion_remains_unresolved_after_arrived_and_restart(
    setup, client, api_prefix
):
    s = setup
    depart(s)
    apply(
        s,
        movement(
            s,
            status='DIVERTED',
            diverted=True,
            landing_airport=Endpoint(latitude=38.77, longitude=-9.13, iata_code='LIS'),
        ),
    )
    assert s.flight.arrival_airport_place_id is None
    s.db.expire_all()
    apply(
        s,
        movement(
            s,
            status='ARRIVED',
            departure_confirmed=True,
            arrival_confirmed=True,
            landing_airport=Endpoint(latitude=38.77, longitude=-9.13, iata_code='LIS'),
        ),
        START + timedelta(hours=2),
    )
    assert s.flight.arrival_airport_place_id is None
    assert s.flight.completion_source is None
    url = f'{api_prefix}/trips/{s.trip.id}/tracking/flights/{s.flight.id}/complete'
    body = {'estimated_arrival': (START + timedelta(hours=2)).isoformat()}
    assert (
        client.post(url, headers=_auth_headers(s.owner), json=body).json()['detail'][
            'code'
        ]
        == 'flight_arrival_airport_required'
    )
    body['arrival_airport_place_id'] = str(s.arrival.id)
    assert (
        client.post(url, headers=_auth_headers(s.owner), json=body).status_code == 200
    )
    assert count(s) == 65


@pytest.mark.parametrize('arrival_first', [True, False])
@pytest.mark.parametrize('actual_time', [True, False])
def test_next_departure_finalizes_or_stops_previous_without_overlap(
    setup, arrival_first, actual_time
):
    s = setup
    depart(s)
    second = s.add('KL456', START + timedelta(hours=3))
    boundary = START + timedelta(hours=3)
    updates = {
        second.id: movement(
            s,
            status='IN_FLIGHT',
            departure_confirmed=True,
            actual_departure=boundary if actual_time else None,
        )
    }
    if arrival_first:
        updates[s.flight.id] = movement(
            s,
            status='ARRIVED',
            arrival_confirmed=True,
            actual_arrival=START + timedelta(hours=2),
        )
    s.service.apply_updates(s.trip.id, updates, boundary + timedelta(minutes=10))
    s.db.commit()
    assert s.flight.session.ended_at <= second.session.started_at
    assert count(s) == (65 if arrival_first else 1)
    assert s.flight.completion_source == ('PROVIDER' if arrival_first else None)
    assert s.flight.stop_reason == (None if arrival_first else 'NEXT_FLIGHT_DEPARTED')
    assert s.flight.actual_arrival == (
        START + timedelta(hours=2) if arrival_first else None
    )
    if not arrival_first:
        assert s.flight.session.ended_at == second.session.started_at
        apply(
            s,
            movement(
                s,
                status='ARRIVED',
                arrival_confirmed=True,
                actual_arrival=START + timedelta(hours=2),
            ),
        )
        assert count(s) == 1


def test_arrival_without_movement_times_completes_and_waits_for_final_track(setup):
    s = setup
    apply(
        s,
        movement(s, status='ARRIVED', departure_confirmed=True, arrival_confirmed=True),
    )
    assert s.flight.status == 'ARRIVED'
    assert s.flight.actual_departure is None and s.flight.actual_arrival is None
    assert s.flight.session.ended_at == START + timedelta(hours=1)
    assert s.flight.final_track_pending
    assert count(s) == 65


def test_pending_flight_visibility_uses_post_boundary_and_live_switch(
    setup, client, api_prefix
):
    s = setup
    depart(s)
    base = f'{api_prefix}/trips/{s.trip.id}'
    assert client.get(base + '/posts/timeline').json()['flight_journeys'] == []
    hidden = client.get(base + '/tracking/journey')
    assert hidden.status_code == 200
    assert all(
        hidden.json()[key] is None
        for key in (
            'position',
            'target',
            'active_flight_id',
            'connector',
            'remaining_flight_route',
            'current_connection_id',
            'current_flight_segment_index',
        )
    )
    _create_post(
        client,
        api_prefix,
        trip_id=s.trip.id,
        user=s.owner,
        place=s.departure,
        title='During flight',
        occurred_at=START + timedelta(hours=1),
    )
    body = client.get(base + '/posts/timeline').json()
    assert body['flight_journeys'][0]['flights'][0]['status'] == 'IN_FLIGHT'
    coordinates = body['opening_route']['segments'][-1]['geometry']['coordinates'][-1]
    assert coordinates != [s.departure.longitude, s.departure.latitude]
    assert body['entries'][0]['post']['location']['latitude'] == s.departure.latitude
    s.trip.share_live_location = True
    s.db.commit()
    assert client.get(base + '/tracking/journey').json()['active_flight_id'] == str(
        s.flight.id
    )
    s.trip.share_live_location = False
    s.db.commit()
    assert client.get(base + '/tracking/journey').json()['position'] is None


@pytest.mark.parametrize(
    'result,retry',
    [('UNAVAILABLE', None), ('RATE_LIMITED', 7200), ('CONFIGURATION_ERROR', None)],
)
def test_poll_failures_keep_facts_and_honor_backoff(setup, result, retry):
    s = setup
    depart(s)
    provider = Mock()
    provider.track.side_effect = FlightUnavailable(
        result=result, retry_after_seconds=retry
    )
    now = START + timedelta(hours=1, minutes=30)
    assert s.service.poll_due(provider, now) == 1
    assert s.flight.last_check_result == result
    assert s.flight.actual_departure == START
    assert s.flight.next_check_at == (
        None
        if result == 'CONFIGURATION_ERROR'
        else now + timedelta(seconds=retry or 1800)
    )
    assert count(s) == 1


def test_database_rejects_mobile_session_link(setup):
    s = setup
    session = GpsTrackingSession(
        id=uuid.uuid4(), trip_id=s.trip.id, source='MOBILE_GPS', started_at=START
    )
    s.db.add(session)
    s.db.flush()
    s.flight.gps_tracking_session_id = session.id
    with pytest.raises(DBAPIError):
        s.db.commit()
    s.db.rollback()


def test_database_rejects_changing_a_linked_flight_session_to_mobile(setup):
    s = setup
    depart(s)
    s.flight.session.source = 'MOBILE_GPS'
    with pytest.raises(DBAPIError):
        s.db.commit()
    s.db.rollback()
    assert s.flight.session.source == 'FLIGHT_ESTIMATE'


def test_removed_plan_stops_unstarted_and_retains_started_history(setup):
    s = setup
    s.db.delete(s.connection)
    s.db.commit()
    s.service.sync_itinerary(s.trip.id)
    s.db.commit()
    assert s.flight.itinerary_travel_segment_id is None
    assert s.flight.next_check_at is None
    access = get_trip_read_access(s.db, trip_id=s.trip.id, current_user_id=s.owner.id)
    assert s.service.cards(access, [], START) == []


def test_confirmed_departure_with_inconsistent_time_uses_observation_boundary(setup):
    s = setup
    # Earlier movement confirmation first observed at 09:00.
    apply(s, movement(s, status='IN_FLIGHT', departure_confirmed=True))
    second = s.add('KL456', START + timedelta(hours=3))
    s.service.apply_updates(
        s.trip.id,
        {
            second.id: movement(
                s, status='IN_FLIGHT', departure_confirmed=True, actual_departure=START
            )
        },
        START + timedelta(hours=4),
    )
    s.db.commit()
    assert second.actual_departure == START
    assert second.session.started_at == START + timedelta(hours=4)
    assert s.flight.session.ended_at == second.session.started_at
    assert count(s) == 1


def test_late_earlier_departure_cannot_stop_a_newer_recording(setup):
    s = setup
    second = s.add('KL456', START + timedelta(hours=3))
    s.service.apply_updates(
        s.trip.id,
        {second.id: movement(s, status='IN_FLIGHT', departure_confirmed=True)},
        START + timedelta(hours=3),
    )
    s.db.commit()
    depart(s)
    assert second.session.ended_at is None
    assert second.stop_reason is None
    assert s.flight.stop_reason == 'NEXT_FLIGHT_DEPARTED'


def test_repeated_resolved_diversion_does_not_clear_landing(setup):
    s = setup
    depart(s)
    airport = create_place(s.db, name='Diversion airport')
    airport.feature_class = 'S'
    airport.iata_code, airport.feature_code = 'OPO', 'AIRP'
    s.db.commit()
    facts = movement(
        s,
        status='DIVERTED',
        diverted=True,
        landing_airport=Endpoint(
            latitude=airport.latitude, longitude=airport.longitude, iata_code='OPO'
        ),
    )
    apply(s, facts)
    apply(s, facts)
    assert s.flight.arrival_airport_place_id == airport.id
    assert s.flight.completion_source is None
    apply(
        s,
        replace(facts, diverted=False, status='ARRIVED', arrival_confirmed=True),
        START + timedelta(hours=2),
    )
    assert s.flight.completion_source == 'PROVIDER'
    assert s.flight.arrival_airport_place_id == airport.id


def test_polling_groups_same_dated_flight_across_trips(setup):
    s = setup
    depart(s)
    other_trip = create_trip(s.db, owner_id=s.owner.id)
    from models.database.tracked_flights import TrackedFlight

    other = TrackedFlight(
        trip_id=other_trip.id,
        itinerary_connection_id=uuid.uuid4(),
        flight_number=s.flight.flight_number,
        scheduled_departure=START,
        scheduled_arrival=START + timedelta(hours=2),
        departure_airport_place_id=s.departure.id,
        arrival_airport_place_id=s.arrival.id,
        next_check_at=START,
    )
    s.db.add(other)
    s.db.flush()
    s.service._start(other, START, START)
    s.flight.next_check_at = START
    s.db.commit()
    provider = Mock()
    provider.track.return_value = [
        movement(s, status='IN_FLIGHT', departure_confirmed=True)
    ]
    assert s.service.poll_due(provider, START + timedelta(hours=1)) == 1
    provider.track.assert_called_once()
    assert s.flight.checked_at == other.checked_at == START + timedelta(hours=1)


def test_concurrent_owner_completions_only_save_one_arc(setup, engine):
    from concurrent.futures import ThreadPoolExecutor
    from sqlalchemy.orm import Session
    from models.api.flights import FlightCompleteRequest

    s = setup
    depart(s)
    trip_id, flight_id, user_id = s.trip.id, s.flight.id, s.owner.id

    def finish(minutes):
        with Session(engine) as db:
            flight = FlightTrackingService(db).complete(
                trip_id,
                flight_id,
                user_id,
                FlightCompleteRequest(
                    estimated_arrival=START + timedelta(minutes=minutes)
                ),
            )
            return flight.session.ended_at

    with ThreadPoolExecutor(max_workers=2) as executor:
        one, two = list(executor.map(finish, [120, 130]))
    assert one == two
    s.db.expire_all()
    assert count(s) == 65


def test_share_link_respects_live_toggle_and_revocation(setup, client, api_prefix):
    from models.database.trips import TripShareLink
    from services.trip_access import hash_share_token

    s = setup
    depart(s)
    s.trip.visibility = TripVisibility.PRIVATE
    link = TripShareLink(
        trip_id=s.trip.id,
        created_by=s.owner.id,
        token_hash=hash_share_token('flight-share-test'),
    )
    s.db.add(link)
    s.db.commit()
    headers = {'X-Trip-Share-Token': 'flight-share-test'}
    base = f'{api_prefix}/trips/{s.trip.id}'
    assert client.get(base + '/tracking/journey').status_code == 404
    assert (
        client.get(base + '/tracking/journey', headers=headers).json()['position']
        is None
    )
    assert (
        client.get(base + '/posts/timeline', headers=headers).json()['flight_journeys']
        == []
    )
    s.trip.share_live_location = True
    s.db.commit()
    assert client.get(base + '/tracking/journey', headers=headers).json()[
        'active_flight_id'
    ] == str(s.flight.id)
    assert client.get(base + '/posts/timeline', headers=headers).json()[
        'flight_journeys'
    ]
    s.trip.share_live_location = False
    s.db.commit()
    assert (
        client.get(base + '/tracking/journey', headers=headers).json()['target'] is None
    )
    assert (
        client.get(base + '/posts/timeline', headers=headers).json()['flight_journeys']
        == []
    )
    link.revoked_at = datetime.now(timezone.utc)
    s.db.commit()
    assert client.get(base + '/tracking/journey', headers=headers).status_code == 404


def test_airport_guidance_waits_for_current_connection(setup, monkeypatch):
    from services.gps.journey_service import current_journey

    s = setup
    monkeypatch.setattr('services.gps.journey_service.utcnow', lambda: START)
    stop = s.connection.to_stop
    stop.planned_start_date = START.date() - timedelta(days=1)
    stop.planned_nights = 3
    s.db.commit()
    guidance = current_journey(s.db, s.trip.id, s.owner.id)
    assert guidance.current_connection_id is None
    assert guidance.target.type == 'CURRENT_STOP'
    stop.planned_start_date = START.date()
    s.db.commit()
    guidance = current_journey(s.db, s.trip.id, s.owner.id)
    assert guidance.current_connection_id == s.connection.id
    assert guidance.target.type == 'AIRPORT'
    assert guidance.target.name == s.departure.name
    assert guidance.current_flight_segment_index == 0


def test_connection_card_appears_24_hours_before_first_flight_and_keeps_connections(
    setup,
):
    s = setup
    s.add('KL456', START + timedelta(hours=30))
    access = get_trip_read_access(s.db, trip_id=s.trip.id, current_user_id=s.owner.id)
    assert s.service.cards(access, [], START - timedelta(hours=25)) == []
    journeys = s.service.cards(access, [], START - timedelta(hours=23))
    assert len(journeys) == 1
    assert [flight.flight_number for flight in journeys[0].flights] == [
        'KL123',
        'KL456',
    ]


def test_next_flight_stop_explanation_waits_for_readers_history_boundary(
    setup, client, api_prefix
):
    s = setup
    depart(s)
    second = s.add('KL456', START + timedelta(hours=3))
    s.service.apply_updates(
        s.trip.id,
        {second.id: movement(s, status='IN_FLIGHT', departure_confirmed=True)},
        START + timedelta(hours=3),
    )
    s.db.commit()
    _create_post(
        client,
        api_prefix,
        trip_id=s.trip.id,
        user=s.owner,
        place=s.departure,
        title='Before next departure',
        occurred_at=START + timedelta(hours=2),
    )
    base = f'{api_prefix}/trips/{s.trip.id}/posts/timeline'
    before = client.get(base).json()['flight_journeys'][0]['flights']
    assert len(before) == 1
    assert before[0]['stop_reason'] is None
    assert before[0]['completion_source'] is None
    _create_post(
        client,
        api_prefix,
        trip_id=s.trip.id,
        user=s.owner,
        place=s.departure,
        title='After next departure',
        occurred_at=START + timedelta(hours=4),
    )
    after = client.get(base).json()['flight_journeys'][0]['flights']
    assert after[0]['stop_reason'] == 'NEXT_FLIGHT_DEPARTED'
    assert after[0]['status'] != 'ARRIVED'


def test_completed_postless_history_has_a_card_without_live_access(
    setup, client, api_prefix
):
    s = setup
    depart(s)
    apply(
        s,
        movement(
            s,
            status='ARRIVED',
            arrival_confirmed=True,
            actual_arrival=START + timedelta(hours=2),
        ),
        START + timedelta(hours=2),
    )
    body = client.get(f'{api_prefix}/trips/{s.trip.id}/posts/timeline').json()
    assert body['flight_journeys'][0]['flights'][0]['progress'] == 1
    assert body['flight_journeys'][0]['flights'][0]['status'] == 'ARRIVED'
    assert body['opening_route']['segments'][0]['source'] == 'FLIGHT_ESTIMATE'


def test_flight_points_and_edits_bypass_zones_but_mobile_uploads_do_not(
    setup, client, api_prefix
):
    from integration.api.test_tracking import _create_zone

    s = setup
    response = _create_zone(
        client,
        api_prefix,
        s.owner,
        latitude=s.departure.latitude,
        longitude=s.departure.longitude,
        radius_meters=5000,
    )
    assert response.status_code == 201
    depart(s)
    assert count(s) == 1
    base = f'{api_prefix}/trips/{s.trip.id}/tracking'
    headers = _auth_headers(s.owner)
    mobile_id = uuid.uuid4()
    assert (
        client.post(
            f'{base}/sessions/{mobile_id}',
            headers=headers,
            json={'started_at': START.isoformat()},
        ).status_code
        == 201
    )
    response = client.post(
        f'{base}/sessions/{mobile_id}/samples/batch',
        headers=headers,
        json={
            'samples': [
                {
                    'id': str(uuid.uuid4()),
                    'recorded_at': START.isoformat(),
                    'latitude': s.departure.latitude,
                    'longitude': s.departure.longitude,
                }
            ]
        },
    )
    assert response.json()['filtered_samples'] == 1
    apply(
        s,
        movement(
            s,
            status='ARRIVED',
            arrival_confirmed=True,
            actual_arrival=START + timedelta(hours=2),
        ),
        START + timedelta(hours=2),
    )
    assert count(s) == 65
    rows = list(
        s.db.scalars(
            select(GpsTrackSample)
            .where(GpsTrackSample.session_id == s.flight.gps_tracking_session_id)
            .order_by(GpsTrackSample.recorded_at)
        )
    )
    points = [
        {
            'id': str(p.id),
            'latitude': p.latitude,
            'longitude': p.longitude,
            'travel_mode': 'FLIGHT',
        }
        for p in rows
    ]
    points[0]['latitude'] += 0.001
    response = client.put(
        f'{base}/sessions/{s.flight.gps_tracking_session_id}/points',
        headers=headers,
        json={'points': points},
    )
    assert response.status_code == 204
    s.db.expire_all()
    assert not s.flight.final_track_pending


def test_default_checks_every_30_minutes_including_near_arrival(setup):
    s = setup
    depart(s)
    s.flight.scheduled_arrival = START + timedelta(hours=10)
    s.flight.estimated_arrival = START + timedelta(hours=10)
    assert s.service.next_check(s.flight, START) == START + timedelta(minutes=30)
    assert s.service.next_check(
        s.flight, START + timedelta(hours=4)
    ) == START + timedelta(hours=4, minutes=30)
    assert s.service.next_check(
        s.flight, START + timedelta(hours=9, minutes=30)
    ) == START + timedelta(hours=10)
    assert s.service.next_check(s.flight, START + timedelta(hours=16)) is None


@pytest.mark.parametrize('interval,ground,minutes', [(5, True, 5), (30, True, 10), (60, False, 60)])
def test_check_settings_control_ground_and_airborne_cadence(setup, interval, ground, minutes):
    s = setup
    service = FlightTrackingService(s.db, check_interval_minutes=interval, check_more_often_before_departure=ground)
    assert service.next_check(s.flight, START - timedelta(hours=3)) == START - timedelta(hours=1)
    assert service.next_check(s.flight, START) == START + timedelta(minutes=minutes)
    depart(s)
    assert service.next_check(s.flight, START) == START + timedelta(minutes=interval)


def test_check_interval_reschedules_existing_check_and_preserves_backoff(setup, monkeypatch):
    s = setup
    s.flight.checked_at = START
    s.flight.last_check_result = 'OK'
    s.flight.next_check_at = START + timedelta(minutes=30)
    s.db.commit()
    service = FlightTrackingService(s.db, check_interval_minutes=5)
    from services.app_settings_service import AppSettingsService, AppSettingsCache
    monkeypatch.setattr('services.app_settings_service.utcnow', lambda: START)
    AppSettingsService(s.db, cache=AppSettingsCache()).update_setting('flights.check_interval_minutes', 5, None)
    assert s.flight.next_check_at == START + timedelta(minutes=5)
    s.flight.last_check_result = 'RATE_LIMITED'
    s.flight.next_check_at = START + timedelta(hours=2)
    service.sync_itinerary(s.trip.id)
    assert s.flight.next_check_at == START + timedelta(hours=2)


def test_check_interval_reschedules_first_lookup_for_existing_unchecked_flight(setup):
    s = setup
    service = FlightTrackingService(s.db, check_interval_minutes=5)
    service.sync_itinerary(s.trip.id)
    assert s.flight.next_check_at == START - timedelta(hours=1)


def test_journey_tracks_current_leg_through_landing_and_layover(setup, monkeypatch):
    from services.gps.journey_service import current_journey

    s = setup
    monkeypatch.setattr('services.gps.journey_service.utcnow', lambda: START)
    initial = current_journey(s.db, s.trip.id, s.owner.id)
    assert initial.current_flight_segment_index == 0
    depart(s)
    airborne = current_journey(s.db, s.trip.id, s.owner.id)
    assert airborne.current_flight_segment_index == 0
    assert airborne.active_flight_id == s.flight.id
    s.service.finalize(s.flight, START + timedelta(hours=2), 'PROVIDER')
    s.db.commit()
    landed = current_journey(s.db, s.trip.id, s.owner.id)
    assert landed.current_flight_segment_index is None
    assert landed.active_flight_id is None
    assert landed.target.type == 'DESTINATION'
    s.add('KL456', START + timedelta(hours=4))
    layover = current_journey(s.db, s.trip.id, s.owner.id)
    assert layover.current_flight_segment_index == 1
    assert layover.target.type == 'AIRPORT'
