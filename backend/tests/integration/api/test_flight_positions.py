"""Observed history, access boundaries and bounded final retrieval regressions."""
# ruff: noqa: F811 -- shared lifecycle fixture

from datetime import timedelta
from unittest.mock import Mock

import pytest
from sqlalchemy import select

from integration.api.test_flight_tracking import START, movement, setup  # noqa: F401
from integration.api.test_tracking import _auth_headers, _create_zone
from integration.api.test_tracking_timeline import _create_post
from models.database.gps_tracking import GpsTrackSample
from services.flight_providers.flight_provider import (
    FlightObservation,
    FlightUnavailable,
)
from services.gps.flight_tracking_service import FlightTrackingService
from services.gps.journey_service import current_journey


def point(minutes, lat=50, lon=6):
    return FlightObservation(START + timedelta(minutes=minutes), lat, lon)


def provider(s, *, arrived=False, points=None):
    adapter = Mock()
    adapter.track.return_value = [
        movement(
            s,
            status='ARRIVED' if arrived else 'IN_FLIGHT',
            departure_confirmed=True,
            arrival_confirmed=arrived,
            actual_departure=START,
            actual_arrival=START + timedelta(hours=2) if arrived else None,
            provider_flight_id='fa-123',
        )
    ]
    adapter.positions.return_value = points or []
    return adapter


def samples(s):
    return list(
        s.db.scalars(
            select(GpsTrackSample)
            .where(GpsTrackSample.session_id == s.flight.session.id)
            .order_by(GpsTrackSample.recorded_at)
        )
    )


def test_merge_corrections_older_shorter_and_failed_checks_keep_latest_marker(
    setup, monkeypatch
):
    s = setup
    adapter = provider(s, points=[point(5), point(25, 49, 7)])
    assert s.service.poll_due(adapter, START + timedelta(minutes=30)) == 2
    assert s.flight.session.source == 'FLIGHT_TRACK'
    adapter.positions.return_value = [point(5, 51, 8)]
    s.service.poll_due(adapter, START + timedelta(hours=1))
    assert [(p.recorded_at, p.latitude) for p in samples(s)] == [
        (point(5).at, 51),
        (point(25).at, 49),
    ]
    adapter.positions.side_effect = FlightUnavailable()
    s.service.poll_due(adapter, START + timedelta(hours=1, minutes=30))
    monkeypatch.setattr(
        'services.gps.journey_service.utcnow',
        lambda: START + timedelta(hours=1, minutes=31),
    )
    journey = current_journey(s.db, s.trip.id, s.owner.id)
    assert journey.position.at == point(25).at
    assert journey.position.source == 'FLIGHT_TRACK'
    assert journey.position.latitude == 49
    assert journey.remaining_flight_route.coordinates[0] == pytest.approx((7, 49))
    assert len(samples(s)) == 2


def test_arrival_final_fetch_is_not_duplicated_and_shorter_final_keeps_history(setup):
    s = setup
    adapter = provider(s, points=[point(5), point(25)])
    s.service.poll_due(adapter, START + timedelta(minutes=30))
    adapter.track.return_value = provider(s, arrived=True).track.return_value
    adapter.positions.return_value = [point(5, 51)]
    assert s.service.poll_due(adapter, START + timedelta(hours=2)) == 2
    assert adapter.positions.call_count == 2
    assert s.flight.completion_source == 'PROVIDER'
    assert s.flight.session.ended_at == START + timedelta(hours=2)
    assert s.flight.final_track_attempts == 1
    assert not s.flight.final_track_pending
    assert s.flight.next_check_at is None
    assert len(samples(s)) == 2
    assert s.service.poll_due(adapter, START + timedelta(hours=3)) == 0


def test_failed_final_retries_survive_restart_and_exhaust_at_three(setup):
    s = setup
    adapter = provider(s, arrived=True)
    adapter.positions.side_effect = FlightUnavailable()
    assert s.service.poll_due(adapter, START + timedelta(hours=2)) == 2
    assert s.flight.completion_source == 'PROVIDER'
    assert s.flight.final_track_pending
    assert len(samples(s)) == 65

    for i in (1, 2):
        restarted = FlightTrackingService(s.db)
        assert (
            restarted.poll_due(adapter, START + timedelta(hours=2, minutes=30 * i)) == 1
        )
    assert adapter.track.call_count == 1
    assert adapter.positions.call_count == 3
    assert s.flight.final_track_attempts == 3
    assert not s.flight.final_track_pending
    assert s.flight.next_check_at is None
    assert len(samples(s)) == 65


def test_arrival_is_durable_and_budget_reserved_before_final_request(setup, engine):
    from sqlalchemy.orm import Session
    from models.database.tracked_flights import TrackedFlight

    s = setup
    adapter = provider(s, arrived=True, points=[point(5), point(115)])
    flight_id = s.flight.id

    def during_request(_):
        with Session(engine) as other:
            flight = other.get(TrackedFlight, flight_id)
            assert flight.completion_source == 'PROVIDER'
            assert flight.session.ended_at == START + timedelta(hours=2)
            assert flight.final_track_pending
            assert flight.final_track_attempts == 1
        return [point(5), point(115)]

    adapter.positions.side_effect = during_request
    s.service.poll_due(adapter, START + timedelta(hours=2))
    assert not s.flight.final_track_pending


def test_next_flight_cancels_previous_final_retrieval_before_network(setup):
    from dataclasses import replace

    s = setup
    second = s.add('KL456', START + timedelta(hours=3))
    adapter = provider(s, arrived=True)
    first = adapter.track.return_value[0]
    adapter.track.side_effect = lambda intent: (
        [first]
        if intent.flight_number == s.flight.flight_number
        else [
            replace(
                first,
                scheduled_departure=second.scheduled_departure,
                status='IN_FLIGHT',
                arrival_confirmed=False,
                actual_arrival=None,
                actual_departure=second.scheduled_departure,
                provider_flight_id='fa-second',
            )
        ]
    )
    adapter.positions.return_value = [point(185)]
    s.service.poll_due(adapter, START + timedelta(hours=3, minutes=30))
    assert not s.flight.final_track_pending
    assert second.session.ended_at is None
    adapter.positions.assert_called_once_with('fa-second')


def test_quota_backoff_expires_at_six_hours_without_extra_requests(setup):
    s = setup
    adapter = provider(s, arrived=True)
    adapter.positions.side_effect = FlightUnavailable(
        result='RATE_LIMITED', retry_after_seconds=8 * 3600
    )
    s.service.poll_due(adapter, START + timedelta(hours=2))
    assert s.flight.final_track_attempts == 1

    assert (
        s.flight.next_check_at
        == s.flight.final_track_deadline
        == START + timedelta(hours=8)
    )
    assert s.service.poll_due(adapter, START + timedelta(hours=8)) == 0
    assert not s.flight.final_track_pending
    assert s.flight.final_track_attempts == 1


def test_crashes_during_final_requests_cannot_reset_the_durable_attempt_budget(setup):
    s = setup
    adapter = provider(s, arrived=True)
    adapter.positions.side_effect = RuntimeError('interrupted request')
    for minutes in (0, 30, 60):
        with pytest.raises(RuntimeError, match='interrupted request'):
            FlightTrackingService(s.db).poll_due(
                adapter, START + timedelta(hours=2, minutes=minutes)
            )
        s.db.rollback()
    assert s.flight.final_track_attempts == 3
    assert (
        FlightTrackingService(s.db).poll_due(adapter, START + timedelta(hours=4)) == 0
    )
    assert adapter.positions.call_count == 3
    assert not s.flight.final_track_pending


@pytest.mark.parametrize('result', ['UNAVAILABLE', 'CONFIGURATION_ERROR'])
def test_final_failure_keeps_observed_points_and_configuration_error_settles(
    setup, result
):
    s = setup
    adapter = provider(s, points=[point(5), point(25)])
    s.service.poll_due(adapter, START + timedelta(minutes=30))
    adapter.track.return_value = provider(s, arrived=True).track.return_value
    adapter.positions.side_effect = FlightUnavailable(result=result)
    s.service.poll_due(adapter, START + timedelta(hours=2))
    assert s.flight.session.source == 'FLIGHT_TRACK'
    assert [p.recorded_at for p in samples(s)] == [point(5).at, point(25).at]
    assert s.flight.final_track_pending is (result == 'UNAVAILABLE')


@pytest.mark.parametrize(
    'action', ['edit', 'delete', 'mode', 'points', 'stop', 'complete']
)
def test_owner_change_cancels_result_already_in_progress(
    setup, client, api_prefix, action
):
    s = setup
    adapter = provider(s, arrived=True)
    s.service.poll_due(adapter, START + timedelta(hours=2))
    assert s.flight.final_track_pending
    base = f'{api_prefix}/trips/{s.trip.id}/tracking'
    session_url = f'{base}/sessions/{s.flight.session.id}'
    headers = _auth_headers(s.owner)
    initial = samples(s)

    def concurrent_edit(_):
        if action == 'edit':
            points = [
                dict(
                    id=str(p.id),
                    latitude=p.latitude + 0.001,
                    longitude=p.longitude,
                    travel_mode='FLIGHT',
                )
                for p in initial
            ]
            response = client.put(
                session_url + '/points', headers=headers, json={'points': points}
            )
        elif action == 'delete':
            response = client.delete(session_url, headers=headers)
        elif action == 'mode':
            response = client.patch(
                base + '/samples/travel-mode',
                headers=headers,
                json={'sample_ids': [str(initial[0].id)], 'travel_mode': 'WALK'},
            )
        elif action == 'points':
            response = client.post(
                base + '/samples/delete',
                headers=headers,
                json={'sample_ids': [str(initial[0].id)]},
            )
        elif action == 'stop':
            response = client.post(session_url + '/stop', headers=headers)
        else:
            response = client.post(
                f'{base}/flights/{s.flight.id}/complete',
                headers=headers,
                json={'estimated_arrival': (START + timedelta(hours=2)).isoformat()},
            )
        assert response.status_code in (200, 204), response.text
        return [point(5, 80)]

    adapter.positions.side_effect = concurrent_edit
    s.service.poll_due(adapter, START + timedelta(hours=2, minutes=30))
    s.db.expire_all()
    assert not s.flight.final_track_pending
    assert not any(p.latitude == 80 for p in samples(s))
    assert s.flight.next_check_at is None


def test_late_arrival_uses_original_observation_bounds_without_claiming_actual_times(
    setup,
):
    s = setup
    adapter = provider(s, arrived=True, points=[point(5), point(115)])
    facts = adapter.track.return_value[0]
    from dataclasses import replace

    adapter.track.return_value = [
        replace(facts, actual_departure=None, actual_arrival=None)
    ]
    s.service.poll_due(adapter, START + timedelta(hours=4))
    assert s.flight.session.started_at == point(5).at
    assert s.flight.session.ended_at == point(115).at
    assert s.flight.actual_departure is None
    assert s.flight.actual_arrival is None
    assert [p.recorded_at for p in samples(s)] == [point(5).at, point(115).at]


def test_observations_bypass_zones_and_keep_published_post_boundaries(
    setup, client, api_prefix, monkeypatch
):
    s = setup
    _create_zone(
        client, api_prefix, s.owner, latitude=50, longitude=6, radius_meters=5000
    )
    adapter = provider(s, points=[point(5), point(25, 49, 7)])
    s.service.poll_due(adapter, START + timedelta(minutes=30))
    base = f'{api_prefix}/trips/{s.trip.id}'
    headers = _auth_headers(s.owner)
    monkeypatch.setattr(
        'services.gps.tracking_service.utcnow', lambda: START + timedelta(minutes=30)
    )
    assert client.get(base + '/posts/timeline').json()['flight_journeys'] == []
    member = client.get(base + '/posts/timeline', headers=headers).json()
    assert member['opening_route']['segments'][0]['source'] == 'FLIGHT_TRACK'
    assert member['opening_route']['segments'][0]['geometry']['coordinates'] == [
        [6, 50],
        [7, 49],
    ]
    assert (
        member['flight_journeys'][0]['flights'][0]['position_source'] == 'FLIGHT_TRACK'
    )
    _create_post(
        client,
        api_prefix,
        trip_id=s.trip.id,
        user=s.owner,
        place=s.departure,
        title='In flight',
        occurred_at=START + timedelta(minutes=15),
    )
    public = client.get(base + '/posts/timeline').json()
    card = public['flight_journeys'][0]['flights'][0]
    assert card['position_at'].startswith(point(5).at.isoformat()[:19])
    assert public['entries'][-1]['route_after'] is None
    journey = client.get(base + '/tracking/journey').json()
    assert journey['position'] is None
