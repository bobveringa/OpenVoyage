"""Regression coverage for explicit planning actions and trip-owned travel."""

from planning_helpers import planning_body

import uuid
from unittest.mock import Mock
from datetime import timedelta

import pytest
from sqlalchemy import func, select
from core import security
from core.app_settings import FLIGHTS_PROVIDER_KEY, FLIGHTS_FLIGHTAWARE_API_KEY
from factories.users import create_user
from factories.trips import create_trip, add_trip_viewer
from factories.places import create_place
from models.api.planning import Endpoint, FlightLookup
from models.database.itinerary import ItineraryPlanningArtifact, ItinerarySegmentRoute
from models.database.locations import Location
from services.flight_providers.flightaware_flight_provider import FlightAwareFlightProvider
from services.route_providers import GraphHopperRouteProvider, RouteResponse
from services.app_settings_service import AppSettingsService
from services.planning_calculator import calculation_gate


def connection_write(connection, travel):
    return {'from': connection['from'], 'to': connection['to'], **travel}


def headers(user, revision=None):
    token = security.create_auth_tokens(subject=user.id, email=user.email)[
        'access_token'
    ]
    return {
        'Authorization': f'Bearer {token}',
        **({'If-Match': revision} if revision else {}),
    }


@pytest.fixture
def plan(client, db_session, api_prefix):
    user = create_user(db_session, password='PlanningPass123!')
    trip = create_trip(db_session, owner_id=user.id)
    start = create_place(db_session, name='Amsterdam', latitude=52.37, longitude=4.9)
    end = create_place(db_session, name='Utrecht', latitude=52.09, longitude=5.12)
    base = f'{api_prefix}/trips/{trip.id}/itinerary'
    revision = '"0"'
    for place in (start, end):
        response = client.post(
            base + '/stops',
            headers=headers(user, revision),
            json={
                'title': place.name,
                'location': {'place_id': str(place.id)},
                'planned_nights': 0,
                'placement': {
                    'planned_start_date': '2026-11-18',
                    'after_stop_id': None,
                },
            },
        )
        assert response.status_code == 201, response.text
        revision = response.headers['etag']
    data = planning_body(response)
    connection = data['connections'][0]
    calculation_gate.recent.clear()
    return user, trip, base, base + '/connections/' + connection['id'], revision, connection, data


def flight_lookup():
    return FlightLookup(
        flight_number='KL597', departure_date='2026-11-18', fetched_at='2026-10-25T10:00:00Z',
        airline_name='KLM',
        departure_airport=Endpoint(name='Schiphol', latitude=52.3, longitude=4.7, iata_code='AMS', timezone='Europe/Amsterdam'),
        arrival_airport=Endpoint(name='Cape Town', latitude=-33.97, longitude=18.6, iata_code='CPT', timezone='Africa/Johannesburg'),
        scheduled_departure='2026-11-18T10:00:00+01:00', scheduled_arrival='2026-11-18T22:00:00+02:00',
    )


def matched_lookup(db_session, monkeypatch):
    AppSettingsService(db_session).update_setting(
        FLIGHTS_PROVIDER_KEY, 'flightaware', None
    )
    matches = [flight_lookup()]
    lookup = Mock(return_value=matches)
    monkeypatch.setattr(FlightAwareFlightProvider, 'lookup', lookup)
    return lookup


def test_alternative_provider_can_lookup_save_and_read_schedule(client, plan):
    from api.deps import get_flight_provider
    from services.flight_providers import FlightProviderBase

    user, _, _, endpoint, revision, connection, _ = plan

    class AlternativeProvider(FlightProviderBase):
        name = 'alternative'

        def is_configured(self):
            return True

        def lookup(self, intent, *, timeout=10):
            return [
                item.model_copy(update={'provider': self.name})
                for item in [flight_lookup()]
            ]

    client.app.dependency_overrides[get_flight_provider] = AlternativeProvider
    try:
        payload = {'flight_number': 'KL597', 'departure_date': '2026-11-18'}
        found = client.post(
            endpoint + '/flight-lookups', headers=headers(user, revision), json=payload
        )
        assert found.status_code == 200, found.text
        candidate = planning_body(found)['candidates'][0]
        assert candidate['lookup']['provider'] == 'alternative'
        saved = client.put(
            endpoint,
            headers=headers(user, revision),
            json=connection_write(
                connection,
                {
                    'segments': [
                        {
                            'travel_mode': 'FLIGHT',
                            'flight': payload
                            | {
                                'candidate_id': candidate['candidate_id'],
                            },
                        }
                    ],
                },
            ),
        )
        assert saved.status_code == 200, saved.text
        assert planning_body(saved)['segments'][0]['lookup']['provider'] == 'alternative'
        client.app.dependency_overrides[get_flight_provider] = lambda: None
        read = client.get(endpoint, headers=headers(user))
        assert read.status_code == 200
        assert planning_body(read)['segments'][0]['lookup']['provider'] == 'alternative'
        assert planning_body(read)['duration_seconds'] == 39600
    finally:
        client.app.dependency_overrides.pop(get_flight_provider)


def test_defaults_and_saves_never_call_providers(client, plan, monkeypatch):
    user, trip, base, endpoint, revision, connection, _ = plan
    route = Mock(side_effect=AssertionError('Unexpected provider call'))
    monkeypatch.setattr(GraphHopperRouteProvider, 'get_route', route)
    assert connection['segments'][0]['intent']['travel_mode'] == 'CAR'
    assert connection['segments'][0]['mode_source'] == 'AUTO'
    payload = {'notes': 'Remember luggage', 'segments': [connection['segments'][0]['intent']]}
    response = client.put(
        endpoint, headers=headers(user, revision), json=connection_write(connection, payload)
    )
    assert response.status_code == 200, response.text
    assert planning_body(response)['segments'][0]['mode_source'] == 'AUTO'
    assert client.get(base, headers=headers(user)).status_code == 200
    route.assert_not_called()


@pytest.mark.parametrize('provider', ['none', 'flightaware'])
def test_no_flight_provider_or_key_keeps_draft_editable(
    client, db_session, plan, monkeypatch, provider
):
    user, _, _, endpoint, revision, connection, _ = plan
    if provider != 'none':
        AppSettingsService(db_session).update_setting(
            FLIGHTS_PROVIDER_KEY, provider, None
        )
    monkeypatch.setattr(
        'services.flight_providers.flightaware_flight_provider.urlopen',
        lambda *_a, **_k: pytest.fail('Network without key'),
    )
    response = client.post(
        endpoint + '/flight-lookups',
        headers=headers(user, revision),
        json={'flight_number': 'KL597', 'departure_date': '2026-11-18'},
    )
    assert response.status_code == 200, response.text
    assert planning_body(response)['status'] == 'UNAVAILABLE'
    save = client.put(
        endpoint,
        headers=headers(user, revision),
        json=connection_write(
            connection,
            {
                'segments': [
                    {
                        'travel_mode': 'FLIGHT',
                        'flight': {
                            'flight_number': 'KL597',
                            'departure_date': '2026-11-18',
                        },
                    }
                ]
            },
        ),
    )
    assert save.status_code == 200, save.text
    assert planning_body(save)['duration_seconds'] is None
    assert planning_body(save)['segments'][0]['intent']['flight']['flight_number'] == 'KL597'


def test_preview_failure_is_adopted_without_retry(client, plan, db_session):
    user, _, _, endpoint, revision, connection, _ = plan
    count = db_session.scalar(select(func.count()).select_from(Location))
    payload = {
        'segments': [
            connection['segments'][0]['intent'] | {'via': {'latitude': 52.1, 'longitude': 5.1}}
        ]
    }
    preview = client.post(
        endpoint + '/preview',
        headers=headers(user, revision),
        json=connection_write(connection, payload),
    )
    assert preview.status_code == 200, preview.text
    assert planning_body(preview)['connection']['segments'][0]['route_state'] == 'FAILED'
    assert db_session.scalar(select(func.count()).select_from(Location)) == count
    assert (
        planning_body(client.get(endpoint, headers=headers(user)))['segments'][0]['route_state']
        == 'NOT_CALCULATED'
    )
    save = client.put(
        endpoint,
        headers=headers(user, revision),
        json=connection_write(
            connection, payload | {'preview_id': planning_body(preview)['preview_id']}
        ),
    )
    assert save.status_code == 200, save.text
    assert planning_body(save)['segments'][0]['route_state'] == 'FAILED'
    assert db_session.scalar(select(func.count()).select_from(Location)) == count + 1


def test_explicit_same_mode_is_preserved_and_requires_deletion_confirmation(
    client, plan
):
    user, _, base, endpoint, revision, connection, data = plan
    save = client.put(
        endpoint,
        headers=headers(user, revision),
        json=connection_write(
            connection, {'segments': [connection['segments'][0]['intent'] | {'mode_selected': True}]}
        ),
    )
    assert save.status_code == 200, save.text
    assert planning_body(save)['segments'][0]['mode_source'] == 'USER'
    revision = save.headers['etag']
    stop_id = data['stops'][0]['id']
    deletion = client.delete(
        base + '/stops/' + stop_id, headers=headers(user, revision)
    )
    assert deletion.status_code == 409, deletion.text
    assert len(planning_body(client.get(base, headers=headers(user)))['stops']) == 2
    stale = client.delete(
        base + '/stops/' + stop_id + '?confirm_connection_deletion=true',
        headers=headers(user, '"0"'),
    )
    assert stale.status_code == 412
    confirmed = client.delete(
        base + '/stops/' + stop_id + '?confirm_connection_deletion=true',
        headers=headers(user, revision),
    )
    assert confirmed.status_code == 200, confirmed.text
    assert len(planning_body(confirmed)['stops']) == 1


def test_candidates_survive_notes_edits_and_do_not_leak_artifact_ids(
    client, db_session, plan, monkeypatch
):
    user, _, _, endpoint, revision, connection, _ = plan
    lookup = matched_lookup(db_session, monkeypatch)
    found = client.post(
        endpoint + '/flight-lookups',
        headers=headers(user, revision),
        json={'flight_number': 'kl 597', 'departure_date': '2026-11-18'},
    )
    assert found.status_code == 200, found.text
    candidate = planning_body(found)['candidates'][0]['candidate_id']
    notes = client.put(
        endpoint,
        headers=headers(user, revision),
        json=connection_write(
            connection, {'notes': 'Notes', 'segments': [connection['segments'][0]['intent']]}
        ),
    )
    assert notes.status_code == 200, notes.text
    save = client.put(
        endpoint,
        headers=headers(user, notes.headers['etag']),
        json=connection_write(
            connection,
            {
                'segments': [
                    {
                        'travel_mode': 'FLIGHT',
                        'flight': {
                            'flight_number': 'KL597',
                            'departure_date': '2026-11-18',
                            'candidate_id': candidate,
                        },
                    }
                ]
            },
        ),
    )
    assert save.status_code == 200, save.text
    result = planning_body(save)
    assert result['duration_seconds'] == 39600
    assert result['duration_scope'] == 'FLIGHT_JOURNEY'
    assert result['segments'][0]['lookup']['departure_airport']['iata_code'] == 'AMS'
    assert result['segments'][0]['intent']['flight']['candidate_id'] is None
    lookup.assert_called_once()


@pytest.mark.parametrize('action', ['preview', 'flight-lookups', 'route-refresh'])
def test_planning_actions_require_editor_and_revision(client, db_session, plan, action):
    user, trip, _, endpoint, revision, connection, _ = plan
    viewer = create_user(db_session, password='PlanningPass123!')
    add_trip_viewer(db_session, trip_id=trip.id, user_id=viewer.id, created_by=user.id)
    payload = (
        {'flight_number': 'KL597', 'departure_date': '2026-11-18'}
        if action == 'flight-lookups'
        else connection_write(connection, {'segments': [connection['segments'][0]['intent']]})
    )
    response = client.post(
        endpoint + '/' + action, headers=headers(viewer, revision), json=payload
    )
    assert response.status_code == 403, response.text
    missing = client.post(endpoint + '/' + action, headers=headers(user), json=payload)
    assert missing.status_code == 428, missing.text
    stale = client.post(
        endpoint + '/' + action, headers=headers(user, '"0"'), json=payload
    )
    assert stale.status_code == 412, stale.text


def test_candidate_is_bound_to_actor_and_inputs(client, db_session, plan, monkeypatch):
    user, _, _, endpoint, revision, connection, _ = plan
    matched_lookup(db_session, monkeypatch)
    found = client.post(
        endpoint + '/flight-lookups',
        headers=headers(user, revision),
        json={'flight_number': 'KL597', 'departure_date': '2026-11-18'},
    )
    candidate = planning_body(found)['candidates'][0]['candidate_id']
    invalid = client.put(
        endpoint,
        headers=headers(user, revision),
        json=connection_write(
            connection,
            {
                'segments': [
                    {
                        'travel_mode': 'FLIGHT',
                        'flight': {
                            'flight_number': 'KL598',
                            'departure_date': '2026-11-18',
                            'candidate_id': candidate,
                        },
                    }
                ]
            },
        ),
    )
    assert invalid.status_code == 409, invalid.text
    artifact = db_session.get(ItineraryPlanningArtifact, uuid.UUID(candidate))
    artifact.expires_at -= timedelta(minutes=20)
    db_session.commit()
    expired = client.put(
        endpoint,
        headers=headers(user, revision),
        json=connection_write(
            connection,
            {
                'segments': [
                    {
                        'travel_mode': 'FLIGHT',
                        'flight': {
                            'flight_number': 'KL597',
                            'departure_date': '2026-11-18',
                            'candidate_id': candidate,
                        },
                    }
                ]
            },
        ),
    )
    assert expired.status_code == 409


def test_mixed_journey_has_no_combined_total(client, db_session, plan, monkeypatch):
    user, _, _, endpoint, revision, connection, _ = plan
    matched_lookup(db_session, monkeypatch)
    found = client.post(
        endpoint + '/flight-lookups',
        headers=headers(user, revision),
        json={'flight_number': 'KL597', 'departure_date': '2026-11-18'},
    )
    candidate = planning_body(found)['candidates'][0]['candidate_id']
    save = client.put(
        endpoint,
        headers=headers(user, revision),
        json=connection_write(
            connection,
            {
                'segments': [
                    {'travel_mode': 'CAR'},
                    {
                        'travel_mode': 'FLIGHT',
                        'flight': {
                            'flight_number': 'KL597',
                            'departure_date': '2026-11-18',
                            'candidate_id': candidate,
                        },
                    },
                ]
            },
        ),
    )
    assert save.status_code == 200, save.text
    assert planning_body(save)['duration_seconds'] is None
    assert planning_body(save)['duration_scope'] is None
    assert planning_body(save)['segments'][1]['duration_seconds'] == 39600
    assert planning_body(save)['segments'][0]['to_endpoint']['iata_code'] == 'AMS'


def test_ground_endpoint_inheritance_and_cross_trip_reference(client, db_session, plan):
    user, _, _, endpoint, revision, connection, _ = plan
    save = client.put(
        endpoint,
        headers=headers(user, revision),
        json=connection_write(
            connection,
            {
                'segments': [
                    {'travel_mode': 'CAR', 'to': {'latitude': 52.2, 'longitude': 5}},
                    {'travel_mode': 'WALK'},
                ]
            },
        ),
    )
    assert save.status_code == 200, save.text
    assert (
        planning_body(save)['segments'][0]['to_endpoint']
        == planning_body(save)['segments'][1]['from_endpoint']
    )
    other_trip = create_trip(db_session, owner_id=user.id)
    location = Location(
        trip_id=other_trip.id,
        created_by=user.id,
        latitude=1,
        longitude=2,
        name='Other',
        full_name='Other',
        country_code='NL',
        region='Other',
    )
    db_session.add(location)
    db_session.commit()
    invalid = client.put(
        endpoint,
        headers=headers(user, save.headers['etag']),
        json=connection_write(
            connection,
            {
                'segments': [
                    {'travel_mode': 'CAR', 'via': {'location_id': str(location.id)}}
                ]
            },
        ),
    )
    assert invalid.status_code == 422


def test_admin_flight_key_is_encrypted_and_never_public(
    db_session, api_prefix, client, plan
):
    user, _, _, _, _, connection, _ = plan
    service = AppSettingsService(db_session)
    service.update_setting(FLIGHTS_FLIGHTAWARE_API_KEY, 'synthetic-flight-key', user.id)
    record = service.get_admin_setting(FLIGHTS_FLIGHTAWARE_API_KEY)
    assert record.is_configured
    assert record.value is None
    assert service.get_value(FLIGHTS_FLIGHTAWARE_API_KEY) == 'synthetic-flight-key'
    assert FLIGHTS_FLIGHTAWARE_API_KEY not in service.get_public_settings().settings


def test_departing_member_loses_artifacts_but_saved_travel_survives(
    client, db_session, plan, monkeypatch
):
    from factories.trips import add_trip_member
    from models.database.user import UserRole

    owner, trip, _, endpoint, revision, connection, _ = plan
    member = create_user(db_session, password='PlanningPass123!')
    add_trip_member(db_session, trip_id=trip.id, user_id=member.id)
    matched_lookup(db_session, monkeypatch)
    found = client.post(
        endpoint + '/flight-lookups',
        headers=headers(member, revision),
        json={'flight_number': 'KL597', 'departure_date': '2026-11-18'},
    )
    candidate = planning_body(found)['candidates'][0]['candidate_id']
    # Even another trip editor cannot adopt this member's private candidate.
    payload = {
        'notes': 'Keep my travel notes',
        'segments': [
            {
                'travel_mode': 'FLIGHT',
                'flight': {
                    'flight_number': 'KL597',
                    'departure_date': '2026-11-18',
                    'candidate_id': candidate,
                },
            }
        ],
    }
    assert (
        client.put(
            endpoint,
            headers=headers(owner, revision),
            json=connection_write(connection, payload),
        ).status_code
        == 409
    )
    saved = client.put(
        endpoint, headers=headers(member, revision), json=connection_write(connection, payload)
    )
    assert saved.status_code == 200, saved.text
    owner.role = UserRole.ADMIN
    db_session.commit()
    removed = client.delete(
        '/api/v1/trips/' + str(trip.id) + '/members/' + str(member.id),
        headers=headers(owner),
    )
    assert removed.status_code == 204, removed.text
    assert db_session.get(ItineraryPlanningArtifact, uuid.UUID(candidate)) is None
    read = client.get(endpoint, headers=headers(owner))
    assert read.status_code == 200
    assert read.headers['cache-control'] == 'private, no-store'
    assert planning_body(read)['segments'][0]['lookup'] is not None
    assert planning_body(read)['notes'] == 'Keep my travel notes'
    assert (
        client.post(
            endpoint + '/preview',
            headers=headers(member, saved.headers['etag']),
            json=connection_write(connection, {'segments': [{'travel_mode': 'CAR'}]}),
        ).status_code
        == 404
    )
    # Account deletion clears only the provider snapshot, preserving the trip's manual intent.
    deleted = client.delete(
        '/api/v1/admin/users/' + str(member.id), headers=headers(owner)
    )
    assert deleted.status_code == 200, deleted.text
    after = planning_body(client.get(endpoint, headers=headers(owner)))
    assert after['segments'][0]['lookup'] is None
    assert after['segments'][0]['intent']['flight']['flight_number'] == 'KL597'
    assert after['notes'] == 'Keep my travel notes'


def enable_routes(db_session, monkeypatch, result):
    from api.deps import route_provider_factory

    service = AppSettingsService(db_session)
    service.update_setting('routing.provider', 'graphhopper', None)
    service.update_setting('routing.graphhopper_api_key', 'synthetic-route-key', None)
    route_provider_factory.reset_cache()
    route = Mock(side_effect=result) if callable(result) else Mock(return_value=result)
    monkeypatch.setattr(GraphHopperRouteProvider, 'get_route', route)
    return route


def test_refresh_recalculates_a_ready_route(client, db_session, plan, monkeypatch):
    user, _, _, endpoint, revision, _, _ = plan
    first_route = RouteResponse(
        {'type': 'LineString', 'coordinates': [[5.12, 52.09], [4.9, 52.37]]},
        50000, 3600,
    )
    refreshed_route = RouteResponse(
        {'type': 'LineString', 'coordinates': [[5.12, 52.09], [5, 52.2], [4.9, 52.37]]},
        55000, 3900,
    )
    provider = enable_routes(db_session, monkeypatch, first_route)
    first = client.post(endpoint + '/route-refresh', headers=headers(user, revision))
    assert first.status_code == 200, first.text
    provider.return_value = refreshed_route
    refreshed = client.post(
        endpoint + '/route-refresh', headers=headers(user, first.headers['etag'])
    )
    assert refreshed.status_code == 200, refreshed.text
    assert provider.call_count == 2
    assert planning_body(refreshed)['route']['geometry'] == refreshed_route.geometry_geojson
    assert planning_body(refreshed)['duration_seconds'] == 3900
    read = client.get(endpoint, headers=headers(user))
    assert planning_body(read)['route'] == planning_body(refreshed)['route']


def test_refresh_without_calculable_routes_keeps_revision(client, plan):
    user, _, _, endpoint, revision, connection, _ = plan
    saved = client.put(
        endpoint, headers=headers(user, revision),
        json=connection_write(connection, {'segments': [{'travel_mode': 'TRAIN'}]}),
    )
    assert saved.status_code == 200, saved.text
    refreshed = client.post(
        endpoint + '/route-refresh', headers=headers(user, saved.headers['etag'])
    )
    assert refreshed.status_code == 200, refreshed.text
    assert refreshed.headers['etag'] == saved.headers['etag']
    assert planning_body(refreshed) == planning_body(saved)


def test_successful_preview_is_reused_and_source_only_edit_keeps_estimate(
    client, db_session, plan, monkeypatch
):
    user, _, _, endpoint, revision, connection, _ = plan
    route = enable_routes(
        db_session,
        monkeypatch,
        RouteResponse(
            geometry_geojson={
                'type': 'LineString',
                'coordinates': [[5.12, 52.09], [5.0, 52.2], [4.9, 52.37]],
            },
            distance_meters=50000,
            duration_seconds=3600,
        ),
    )
    payload = {
        'segments': [
            connection['segments'][0]['intent'] | {'via': {'latitude': 52.2, 'longitude': 5}}
        ]
    }
    preview = client.post(
        endpoint + '/preview',
        headers=headers(user, revision),
        json=connection_write(connection, payload),
    )
    assert preview.status_code == 200, preview.text
    assert planning_body(preview)['connection']['duration_seconds'] == 3600
    assert route.call_args.kwargs['via'] == (5.0, 52.2)
    again = client.post(
        endpoint + '/preview',
        headers=headers(user, revision),
        json=connection_write(connection, payload),
    )
    assert planning_body(again)['preview_id'] == planning_body(preview)['preview_id']
    saved = client.put(
        endpoint,
        headers=headers(user, revision),
        json=connection_write(
            connection, payload | {'preview_id': planning_body(preview)['preview_id']}
        ),
    )
    assert saved.status_code == 200, saved.text
    segment = planning_body(saved)['segments'][0]
    assert segment['input_version'] == 2
    row = db_session.get(ItinerarySegmentRoute, uuid.UUID(segment['id']))
    generated_at = row.generated_at
    explicit = client.put(
        endpoint,
        headers=headers(user, saved.headers['etag']),
        json=connection_write(
            connection,
            {
                'notes': 'No recalculation',
                'segments': [segment['intent'] | {'mode_selected': True}],
            },
        ),
    )
    assert explicit.status_code == 200, explicit.text
    assert planning_body(explicit)['duration_seconds'] == 3600
    assert planning_body(explicit)['segments'][0]['input_version'] == segment['input_version']
    assert (
        db_session.get(ItinerarySegmentRoute, row.segment_id).generated_at
        == generated_at
    )
    route.assert_called_once()


def test_provider_completion_discards_stale_results_without_holding_trip_lock(
    client, db_session, engine, plan, monkeypatch
):
    from sqlalchemy.orm import Session
    from models.database.trips import Trip

    user, trip, _, endpoint, revision, connection, _ = plan
    trip_id = trip.id

    def concurrent_edit(*args, **kwargs):
        with Session(engine) as other:
            row = other.scalar(
                select(Trip).where(Trip.id == trip_id).with_for_update(nowait=True)
            )
            row.itinerary_revision += 1
            other.commit()
        return RouteResponse(
            geometry_geojson={
                'type': 'LineString',
                'coordinates': [[5.12, 52.09], [4.9, 52.37]],
            },
            distance_meters=50000,
            duration_seconds=3600,
        )

    route = enable_routes(db_session, monkeypatch, concurrent_edit)
    result = client.post(
        endpoint + '/preview',
        headers=headers(user, revision),
        json=connection_write(connection, {'segments': [connection['segments'][0]['intent']]}),
    )
    assert result.status_code == 412, result.text
    route.assert_called_once()
    assert (
        planning_body(client.get(endpoint, headers=headers(user)))['segments'][0]['route_state']
        == 'NOT_CALCULATED'
    )


def test_stop_location_edit_preserves_choices_and_invalidates_route(
    client, db_session, plan, monkeypatch
):
    user, _, base, endpoint, revision, connection, data = plan
    route = enable_routes(
        db_session,
        monkeypatch,
        RouteResponse(
            geometry_geojson={
                'type': 'LineString',
                'coordinates': [[5.12, 52.09], [4.9, 52.37]],
            },
            distance_meters=50000,
            duration_seconds=3600,
        ),
    )
    payload = {
        'notes': 'Keep this drive',
        'segments': [connection['segments'][0]['intent'] | {'mode_selected': True}],
    }
    preview = client.post(
        endpoint + '/preview',
        headers=headers(user, revision),
        json=connection_write(connection, payload),
    )
    saved = client.put(
        endpoint,
        headers=headers(user, revision),
        json=connection_write(
            connection, payload | {'preview_id': planning_body(preview)['preview_id']}
        ),
    )
    assert saved.status_code == 200, saved.text
    changed = client.patch(
        base + '/stops/' + data['stops'][0]['id'],
        headers=headers(user, saved.headers['etag']),
        json={'location': {'latitude': 52.15, 'longitude': 5.2}},
    )
    assert changed.status_code == 200, changed.text
    connection = planning_body(changed)['connections'][0]
    assert connection['notes'] == 'Keep this drive'
    assert connection['segments'][0]['mode_source'] == 'USER'
    assert connection['segments'][0]['intent']['travel_mode'] == 'CAR'
    assert connection['segments'][0]['route_state'] == 'NOT_CALCULATED'
    assert connection['segments'][0]['from_endpoint']['latitude'] == 52.15
    route.assert_called_once()


def test_stop_insertion_cancel_is_atomic_and_confirmation_creates_fresh_connections(
    client, db_session, plan
):
    user, _, base, endpoint, revision, connection, data = plan
    saved = client.put(
        endpoint,
        headers=headers(user, revision),
        json=connection_write(
            connection,
            {
                'notes': 'Booked travel',
                'segments': [connection['segments'][0]['intent'] | {'mode_selected': True}],
            },
        ),
    )
    count = db_session.scalar(select(func.count()).select_from(Location))
    payload = {
        'title': 'New middle stop',
        'planned_nights': 0,
        'location': {'latitude': 52.2, 'longitude': 5},
        'placement': {
            'planned_start_date': '2026-11-18',
            'after_stop_id': data['stops'][0]['id'],
        },
    }
    blocked = client.post(
        base + '/stops', headers=headers(user, saved.headers['etag']), json=payload
    )
    assert blocked.status_code == 409, blocked.text
    assert db_session.scalar(select(func.count()).select_from(Location)) == count
    unchanged = planning_body(client.get(base, headers=headers(user)))
    assert len(unchanged['stops']) == 2
    assert unchanged['connections'][0]['notes'] == 'Booked travel'
    inserted = client.post(
        base + '/stops?confirm_connection_deletion=true',
        headers=headers(user, saved.headers['etag']),
        json=payload,
    )
    assert inserted.status_code == 201, inserted.text
    assert len(planning_body(inserted)['connections']) == 2
    assert all(
        item['id'] != connection['id'] and item['notes'] == ''
        for item in planning_body(inserted)['connections']
    )


def test_new_connection_uses_an_already_available_matching_car_estimate(
    client, db_session, plan, monkeypatch
):
    user, _, base, endpoint, revision, connection, data = plan
    route = enable_routes(
        db_session,
        monkeypatch,
        RouteResponse(
            geometry_geojson={
                'type': 'LineString',
                'coordinates': [[5.12, 52.09], [4.9, 52.37]],
            },
            distance_meters=50000,
            duration_seconds=43200,
        ),
    )
    payload = {'segments': [connection['segments'][0]['intent']]}
    preview = client.post(
        endpoint + '/preview',
        headers=headers(user, revision),
        json=connection_write(connection, payload),
    )
    assert preview.status_code == 200, preview.text
    saved = client.put(
        endpoint,
        headers=headers(user, revision),
        json=connection_write(
            connection, payload | {'preview_id': planning_body(preview)['preview_id']}
        ),
    )
    assert saved.status_code == 200, saved.text
    revision = saved.headers['etag']
    for day, stop in zip(('2026-11-19', '2026-11-20'), data['stops'], strict=True):
        response = client.post(
            base + '/stops',
            headers=headers(user, revision),
            json={
                'title': 'Repeat ' + stop['title'],
                'planned_nights': 0,
                'location': {
                    'latitude': stop['location']['latitude'],
                    'longitude': stop['location']['longitude'],
                },
                'placement': {'planned_start_date': day, 'after_stop_id': None},
            },
        )
        assert response.status_code == 201, response.text
        revision = response.headers['etag']
    assert (
        planning_body(response)['connections'][-1]['segments'][0]['intent']['travel_mode'] == 'FLIGHT'
    )
    assert planning_body(response)['connections'][-1]['segments'][0]['mode_source'] == 'AUTO'
    route.assert_called_once()


def test_road_alternative_preview_selection_is_bound_and_saved_exactly(
    client, db_session, plan, monkeypatch
):
    user, _, base, endpoint, revision, connection, _ = plan
    primary = {
        'type': 'LineString',
        'coordinates': [[5.12, 52.09], [5.0, 52.2], [4.9, 52.37]],
    }
    alternative = {
        'type': 'LineString',
        'coordinates': [[5.12, 52.09], [4.8, 52.18], [4.9, 52.37]],
    }
    provider = enable_routes(
        db_session,
        monkeypatch,
        RouteResponse(
            primary,
            50000,
            3600,
            alternatives=(RouteResponse(alternative, 55000, 3900),),
        ),
    )
    payload = {'segments': [connection['segments'][0]['intent']]}
    preview = client.post(
        endpoint + '/preview',
        headers=headers(user, revision),
        json=connection_write(connection, payload),
    )
    assert preview.status_code == 200, preview.text
    connection = planning_body(preview)['connection']
    options = connection['segments'][0]['route_options']
    assert len(options) == 2
    assert options[0]['geometry'] == primary
    assert options[1]['geometry'] == alternative
    # Merely previewing leaves persisted travel untouched.
    assert (
        planning_body(client.get(base, headers=headers(user)))['connections'][0]['segments'][0][
            'route_state'
        ]
        == 'NOT_CALCULATED'
    )
    chosen = {
        'notes': 'Keep this alternative',
        'segments': [
            payload['segments'][0]
            | {'route_option': 1, 'mode_selected': True, 'notes': 'Scenic route'}
        ],
        'preview_id': planning_body(preview)['preview_id'],
    }
    forged = chosen | {
        'segments': [
            chosen['segments'][0] | {'via': {'latitude': 52.3, 'longitude': 5.3}}
        ]
    }
    assert (
        client.put(
            endpoint,
            headers=headers(user, revision),
            json=connection_write(connection, forged),
        ).status_code
        == 409
    )
    missing = chosen | {'preview_id': str(uuid.uuid4())}
    assert (
        client.put(
            endpoint,
            headers=headers(user, revision),
            json=connection_write(connection, missing),
        ).status_code
        == 409
    )
    out_of_range = chosen | {'segments': [chosen['segments'][0] | {'route_option': 2}]}
    assert (
        client.put(
            endpoint,
            headers=headers(user, revision),
            json=connection_write(connection, out_of_range),
        ).status_code
        == 409
    )
    saved = client.put(
        endpoint, headers=headers(user, revision), json=connection_write(connection, chosen)
    )
    assert saved.status_code == 200, saved.text
    assert planning_body(saved)['segments'][0]['geometry'] == alternative
    assert planning_body(saved)['route']['geometry'] == alternative
    assert planning_body(saved)['duration_seconds'] == 3900
    assert planning_body(saved)['segments'][0]['distance_meters'] == 55000
    assert planning_body(saved)['segments'][0]['mode_source'] == 'USER'
    assert provider.call_count == 1
    assert (
        planning_body(client.get(base, headers=headers(user)))['connections'][0]['route']['geometry']
        == alternative
    )

    reopened_payload = {'segments': [planning_body(saved)['segments'][0]['intent']]}
    reopened = client.post(
        endpoint + '/preview',
        headers=headers(user, saved.headers['etag']),
        json=connection_write(connection, reopened_payload),
    )
    assert reopened.status_code == 200, reopened.text
    assert planning_body(reopened)['connection']['segments'][0]['geometry'] == alternative
    assert (
        planning_body(reopened)['connection']['segments'][0]['route_options'][0]['geometry']
        == alternative
    )
    assert (
        planning_body(reopened)['connection']['segments'][0]['route_options'][1]['geometry']
        == primary
    )
    assert provider.call_count == 2


@pytest.mark.parametrize('option', [0, 1, 2])
def test_selected_option_matches_fresh_cached_preview_and_saved_connection(
    client, db_session, plan, monkeypatch, option,
):
    user, _, _, endpoint, revision, connection, _ = plan
    geometries = [
        {'type': 'LineString', 'coordinates': [[5.12, 52.09], [5 + index / 10, 52.2], [4.9, 52.37]]}
        for index in range(3)
    ]
    provider = enable_routes(db_session, monkeypatch, RouteResponse(
        geometries[0], 50000, 3600,
        alternatives=tuple(RouteResponse(geometries[i], 50000 + i * 1000, 3600 + i * 300) for i in (1, 2)),
    ))
    payload = connection_write(connection, {'segments': [connection['segments'][0]['intent'] | {'route_option': option}]})
    previews = [client.post(endpoint + '/preview', headers=headers(user, revision), json=payload) for _ in range(2)]
    for preview in previews:
        assert preview.status_code == 200, preview.text
        result = preview.json()['connection']
        assert result['route']['geometry'] == geometries[option]
        assert result['duration_seconds'] == 3600 + option * 300
        assert result['segments'][0]['geometry'] == geometries[option]
        assert [item['geometry'] for item in result['segments'][0]['route_options']] == geometries
    assert previews[0].json()['preview_id'] == previews[1].json()['preview_id']
    saved = client.put(endpoint, headers=headers(user, revision), json=payload | {'preview_id': previews[0].json()['preview_id']})
    assert saved.status_code == 200, saved.text
    assert saved.json()['itinerary_revision'] == int(saved.headers['etag'].strip('"'))
    assert saved.json()['connection']['route'] == previews[0].json()['connection']['route']
    provider.assert_called_once()


def test_lookup_resolves_existing_airports_and_candidate_save_keeps_their_ids(
    client, db_session, plan, monkeypatch
):
    from models.database.tracked_flights import TrackedFlight

    user, trip, _, endpoint, revision, connection, _ = plan
    airports = []
    for name, code, zone in [
        ('Schiphol', 'AMS', 'Europe/Amsterdam'),
        ('Cape Town', 'CPT', 'Africa/Johannesburg'),
    ]:
        airport = create_place(db_session, name=name)
        airport.feature_class = 'S'
        airport.feature_code, airport.iata_code, airport.timezone = 'AIRP', code, zone
        airports.append(airport)
    db_session.commit()
    lookup = matched_lookup(db_session, monkeypatch)
    payload = {'flight_number': 'KL597', 'departure_date': '2026-11-18'}
    found = client.post(
        endpoint + '/flight-lookups', headers=headers(user, revision), json=payload
    )
    assert found.status_code == 200, found.text
    candidate = planning_body(found)['candidates'][0]
    assert candidate['lookup']['departure_airport']['place_id'] == str(airports[0].id)
    assert candidate['lookup']['arrival_airport']['place_id'] == str(airports[1].id)
    cached = client.post(
        endpoint + '/flight-lookups', headers=headers(user, revision), json=payload
    )
    assert planning_body(cached)['candidates'][0]['lookup']['departure_airport'][
        'place_id'
    ] == str(airports[0].id)
    save = client.put(
        endpoint,
        headers=headers(user, revision),
        json=connection_write(
            connection,
            {
                'segments': [
                    {
                        'travel_mode': 'FLIGHT',
                        'flight': {
                            **payload,
                            'candidate_id': candidate['candidate_id'],
                        },
                    }
                ]
            },
        ),
    )
    assert save.status_code == 200, save.text
    saved = planning_body(save)
    flight = saved['segments'][0]['intent']['flight']
    assert flight['departure_airport_place_id'] == str(airports[0].id)
    assert flight['arrival_airport_place_id'] == str(airports[1].id)
    tracked = db_session.scalar(
        select(TrackedFlight).where(TrackedFlight.trip_id == trip.id)
    )
    assert tracked.departure_airport_place_id == airports[0].id
    assert tracked.arrival_airport_place_id == airports[1].id
    notes = client.put(
        endpoint,
        headers=headers(user, save.headers['etag']),
        json=connection_write(
            connection,
            {'notes': 'Still matched', 'segments': [saved['segments'][0]['intent']]},
        ),
    )
    assert notes.status_code == 200, notes.text
    assert planning_body(notes)['segments'][0]['lookup'] is not None
    lookup.assert_called_once()
