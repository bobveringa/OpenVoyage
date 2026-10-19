"""Regression coverage for explicit planning actions and trip-owned travel."""

import uuid
from unittest.mock import Mock
from datetime import timedelta

import pytest
from sqlalchemy import func, select
from core import security
from core.app_settings import FLIGHTS_RAPIDAPI_API_KEY
from factories.users import create_user
from factories.trips import create_trip, add_trip_viewer
from factories.places import create_place
from models.api.planning import FlightLookupRequest
from models.database.itinerary import ItineraryPlanningArtifact, ItinerarySegmentRoute
from models.database.locations import Location
from services.flight_provider import FlightProvider, parse_flights
from services.route_providers import GraphHopperRouteProvider, RouteResponse
from services.app_settings_service import AppSettingsService
from services.planning_service import calculation_gate


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
    data = response.json()
    leg = data['legs'][0]
    calculation_gate.recent.clear()
    return user, trip, base, base + '/legs/' + leg['id'], revision, leg, data


def flight_payload():
    return [
        {
            'number': 'KL597',
            'airline': {'name': 'KLM'},
            'departure': {
                'airport': {
                    'name': 'Schiphol',
                    'iata': 'AMS',
                    'timeZone': 'Europe/Amsterdam',
                    'location': {'lat': 52.3, 'lon': 4.7},
                },
                'scheduledTime': {'local': '2026-11-18T10:00:00+01:00'},
            },
            'arrival': {
                'airport': {
                    'name': 'Cape Town',
                    'iata': 'CPT',
                    'timeZone': 'Africa/Johannesburg',
                    'location': {'lat': -33.97, 'lon': 18.6},
                },
                'scheduledTime': {'local': '2026-11-18T22:00:00+02:00'},
            },
        }
    ]


def matched_lookup(monkeypatch):
    matches = parse_flights(
        flight_payload(),
        FlightLookupRequest(flight_number='KL597', departure_date='2026-11-18'),
    )
    lookup = Mock(return_value=matches)
    monkeypatch.setattr(FlightProvider, 'lookup', lookup)
    return lookup


def test_defaults_and_saves_never_call_providers(client, plan, monkeypatch):
    user, trip, base, endpoint, revision, leg, _ = plan
    route = Mock(side_effect=AssertionError('Unexpected provider call'))
    monkeypatch.setattr(GraphHopperRouteProvider, 'get_route', route)
    assert leg['segments'][0]['intent']['travel_mode'] == 'CAR'
    assert leg['segments'][0]['mode_source'] == 'AUTO'
    payload = {'notes': 'Remember luggage', 'segments': [leg['segments'][0]['intent']]}
    response = client.put(endpoint, headers=headers(user, revision), json=payload)
    assert response.status_code == 200, response.text
    assert response.json()['segments'][0]['mode_source'] == 'AUTO'
    assert client.get(base, headers=headers(user)).status_code == 200
    route.assert_not_called()


def test_no_flight_key_keeps_draft_editable(client, plan, monkeypatch):
    user, _, _, endpoint, revision, _, _ = plan
    monkeypatch.setattr(
        'services.flight_provider.urlopen',
        lambda *_a, **_k: pytest.fail('Network without key'),
    )
    response = client.post(
        endpoint + '/flight-lookups',
        headers=headers(user, revision),
        json={'flight_number': 'KL597', 'departure_date': '2026-11-18'},
    )
    assert response.status_code == 200, response.text
    assert response.json()['status'] == 'UNAVAILABLE'
    save = client.put(
        endpoint,
        headers=headers(user, revision),
        json={
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
    )
    assert save.status_code == 200, save.text
    assert save.json()['duration_seconds'] is None
    assert save.json()['segments'][0]['intent']['flight']['flight_number'] == 'KL597'


def test_preview_failure_is_adopted_without_retry(client, plan, db_session):
    user, _, _, endpoint, revision, leg, _ = plan
    count = db_session.scalar(select(func.count()).select_from(Location))
    payload = {
        'segments': [
            leg['segments'][0]['intent'] | {'via': {'latitude': 52.1, 'longitude': 5.1}}
        ]
    }
    preview = client.post(
        endpoint + '/preview', headers=headers(user, revision), json=payload
    )
    assert preview.status_code == 200, preview.text
    assert preview.json()['connection']['segments'][0]['route_state'] == 'FAILED'
    assert db_session.scalar(select(func.count()).select_from(Location)) == count
    assert (
        client.get(endpoint, headers=headers(user)).json()['segments'][0]['route_state']
        == 'NOT_CALCULATED'
    )
    save = client.put(
        endpoint,
        headers=headers(user, revision),
        json=payload | {'preview_id': preview.json()['preview_id']},
    )
    assert save.status_code == 200, save.text
    assert save.json()['segments'][0]['route_state'] == 'FAILED'
    assert db_session.scalar(select(func.count()).select_from(Location)) == count + 1


def test_explicit_same_mode_is_preserved_and_requires_deletion_confirmation(
    client, plan
):
    user, _, base, endpoint, revision, leg, data = plan
    save = client.put(
        endpoint,
        headers=headers(user, revision),
        json={'segments': [leg['segments'][0]['intent'] | {'mode_selected': True}]},
    )
    assert save.status_code == 200, save.text
    assert save.json()['segments'][0]['mode_source'] == 'USER'
    revision = save.headers['etag']
    stop_id = data['stops'][0]['id']
    deletion = client.delete(
        base + '/stops/' + stop_id, headers=headers(user, revision)
    )
    assert deletion.status_code == 409, deletion.text
    assert len(client.get(base, headers=headers(user)).json()['stops']) == 2
    stale = client.delete(
        base + '/stops/' + stop_id + '?confirm_travel_deletion=true',
        headers=headers(user, '"0"'),
    )
    assert stale.status_code == 412
    confirmed = client.delete(
        base + '/stops/' + stop_id + '?confirm_travel_deletion=true',
        headers=headers(user, revision),
    )
    assert confirmed.status_code == 200, confirmed.text
    assert len(confirmed.json()['stops']) == 1


def test_candidates_survive_notes_edits_and_do_not_leak_artifact_ids(
    client, plan, monkeypatch
):
    user, _, _, endpoint, revision, leg, _ = plan
    lookup = matched_lookup(monkeypatch)
    found = client.post(
        endpoint + '/flight-lookups',
        headers=headers(user, revision),
        json={'flight_number': 'kl 597', 'departure_date': '2026-11-18'},
    )
    assert found.status_code == 200, found.text
    candidate = found.json()['candidates'][0]['candidate_id']
    notes = client.put(
        endpoint,
        headers=headers(user, revision),
        json={'notes': 'Notes', 'segments': [leg['segments'][0]['intent']]},
    )
    assert notes.status_code == 200, notes.text
    save = client.put(
        endpoint,
        headers=headers(user, notes.headers['etag']),
        json={
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
    )
    assert save.status_code == 200, save.text
    result = save.json()
    assert result['duration_seconds'] == 39600
    assert result['duration_scope'] == 'FLIGHT_JOURNEY'
    assert result['segments'][0]['lookup']['departure_airport']['iata_code'] == 'AMS'
    assert result['segments'][0]['intent']['flight']['candidate_id'] is None
    lookup.assert_called_once()


@pytest.mark.parametrize('action', ['preview', 'flight-lookups', 'route-refresh'])
def test_planning_actions_require_editor_and_revision(client, db_session, plan, action):
    user, trip, _, endpoint, revision, leg, _ = plan
    viewer = create_user(db_session, password='PlanningPass123!')
    add_trip_viewer(db_session, trip_id=trip.id, user_id=viewer.id, created_by=user.id)
    payload = (
        {'flight_number': 'KL597', 'departure_date': '2026-11-18'}
        if action == 'flight-lookups'
        else {'segments': [leg['segments'][0]['intent']]}
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
    user, _, _, endpoint, revision, _, _ = plan
    matched_lookup(monkeypatch)
    found = client.post(
        endpoint + '/flight-lookups',
        headers=headers(user, revision),
        json={'flight_number': 'KL597', 'departure_date': '2026-11-18'},
    )
    candidate = found.json()['candidates'][0]['candidate_id']
    invalid = client.put(
        endpoint,
        headers=headers(user, revision),
        json={
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
    )
    assert invalid.status_code == 409, invalid.text
    artifact = db_session.get(ItineraryPlanningArtifact, uuid.UUID(candidate))
    artifact.expires_at -= timedelta(minutes=20)
    db_session.commit()
    expired = client.put(
        endpoint,
        headers=headers(user, revision),
        json={
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
    )
    assert expired.status_code == 409


def test_mixed_journey_has_no_combined_total(client, plan, monkeypatch):
    user, _, _, endpoint, revision, _, _ = plan
    matched_lookup(monkeypatch)
    found = client.post(
        endpoint + '/flight-lookups',
        headers=headers(user, revision),
        json={'flight_number': 'KL597', 'departure_date': '2026-11-18'},
    )
    candidate = found.json()['candidates'][0]['candidate_id']
    save = client.put(
        endpoint,
        headers=headers(user, revision),
        json={
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
    )
    assert save.status_code == 200, save.text
    assert save.json()['duration_seconds'] is None
    assert save.json()['duration_scope'] is None
    assert save.json()['segments'][1]['duration_seconds'] == 39600
    assert save.json()['segments'][0]['to_endpoint']['iata_code'] == 'AMS'


def test_ground_endpoint_inheritance_and_cross_trip_reference(client, db_session, plan):
    user, _, _, endpoint, revision, _, _ = plan
    save = client.put(
        endpoint,
        headers=headers(user, revision),
        json={
            'segments': [
                {'travel_mode': 'CAR', 'to': {'latitude': 52.2, 'longitude': 5}},
                {'travel_mode': 'WALK'},
            ]
        },
    )
    assert save.status_code == 200, save.text
    assert (
        save.json()['segments'][0]['to_endpoint']
        == save.json()['segments'][1]['from_endpoint']
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
        json={
            'segments': [
                {'travel_mode': 'CAR', 'via': {'location_id': str(location.id)}}
            ]
        },
    )
    assert invalid.status_code == 422


def test_admin_flight_key_is_encrypted_and_never_public(
    db_session, api_prefix, client, plan
):
    user, _, _, _, _, _, _ = plan
    service = AppSettingsService(db_session)
    service.update_setting(FLIGHTS_RAPIDAPI_API_KEY, 'synthetic-flight-key', user.id)
    record = service.get_admin_setting(FLIGHTS_RAPIDAPI_API_KEY)
    assert record.is_configured
    assert record.value is None
    assert service.get_value(FLIGHTS_RAPIDAPI_API_KEY) == 'synthetic-flight-key'
    assert FLIGHTS_RAPIDAPI_API_KEY not in service.get_public_settings().settings


def test_departing_member_loses_artifacts_but_saved_travel_survives(
    client, db_session, plan, monkeypatch
):
    from factories.trips import add_trip_member
    from models.database.user import UserRole

    owner, trip, _, endpoint, revision, _, _ = plan
    member = create_user(db_session, password='PlanningPass123!')
    add_trip_member(db_session, trip_id=trip.id, user_id=member.id)
    matched_lookup(monkeypatch)
    found = client.post(
        endpoint + '/flight-lookups',
        headers=headers(member, revision),
        json={'flight_number': 'KL597', 'departure_date': '2026-11-18'},
    )
    candidate = found.json()['candidates'][0]['candidate_id']
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
        client.put(endpoint, headers=headers(owner, revision), json=payload).status_code
        == 409
    )
    saved = client.put(endpoint, headers=headers(member, revision), json=payload)
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
    assert read.json()['segments'][0]['lookup'] is not None
    assert read.json()['notes'] == 'Keep my travel notes'
    assert (
        client.post(
            endpoint + '/preview',
            headers=headers(member, saved.headers['etag']),
            json={'segments': [{'travel_mode': 'CAR'}]},
        ).status_code
        == 404
    )
    # Account deletion clears only the provider snapshot, preserving the trip's manual intent.
    deleted = client.delete(
        '/api/v1/admin/users/' + str(member.id), headers=headers(owner)
    )
    assert deleted.status_code == 200, deleted.text
    after = client.get(endpoint, headers=headers(owner)).json()
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


def test_successful_preview_is_reused_and_source_only_edit_keeps_estimate(
    client, db_session, plan, monkeypatch
):
    user, _, _, endpoint, revision, leg, _ = plan
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
            leg['segments'][0]['intent'] | {'via': {'latitude': 52.2, 'longitude': 5}}
        ]
    }
    preview = client.post(
        endpoint + '/preview', headers=headers(user, revision), json=payload
    )
    assert preview.status_code == 200, preview.text
    assert preview.json()['connection']['duration_seconds'] == 3600
    assert route.call_args.kwargs['via'] == (5.0, 52.2)
    again = client.post(
        endpoint + '/preview', headers=headers(user, revision), json=payload
    )
    assert again.json()['preview_id'] == preview.json()['preview_id']
    saved = client.put(
        endpoint,
        headers=headers(user, revision),
        json=payload | {'preview_id': preview.json()['preview_id']},
    )
    assert saved.status_code == 200, saved.text
    segment = saved.json()['segments'][0]
    assert segment['input_version'] == 2
    row = db_session.get(ItinerarySegmentRoute, uuid.UUID(segment['id']))
    generated_at = row.generated_at
    explicit = client.put(
        endpoint,
        headers=headers(user, saved.headers['etag']),
        json={
            'notes': 'No recalculation',
            'segments': [segment['intent'] | {'mode_selected': True}],
        },
    )
    assert explicit.status_code == 200, explicit.text
    assert explicit.json()['duration_seconds'] == 3600
    assert explicit.json()['segments'][0]['input_version'] == segment['input_version']
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

    user, trip, _, endpoint, revision, leg, _ = plan
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
        json={'segments': [leg['segments'][0]['intent']]},
    )
    assert result.status_code == 412, result.text
    route.assert_called_once()
    assert (
        client.get(endpoint, headers=headers(user)).json()['segments'][0]['route_state']
        == 'NOT_CALCULATED'
    )


def test_stop_location_edit_preserves_choices_and_invalidates_route(
    client, db_session, plan, monkeypatch
):
    user, _, base, endpoint, revision, leg, data = plan
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
        'segments': [leg['segments'][0]['intent'] | {'mode_selected': True}],
    }
    preview = client.post(
        endpoint + '/preview', headers=headers(user, revision), json=payload
    )
    saved = client.put(
        endpoint,
        headers=headers(user, revision),
        json=payload | {'preview_id': preview.json()['preview_id']},
    )
    assert saved.status_code == 200, saved.text
    changed = client.patch(
        base + '/stops/' + data['stops'][0]['id'],
        headers=headers(user, saved.headers['etag']),
        json={'location': {'latitude': 52.15, 'longitude': 5.2}},
    )
    assert changed.status_code == 200, changed.text
    connection = changed.json()['legs'][0]
    assert connection['notes'] == 'Keep this drive'
    assert connection['segments'][0]['mode_source'] == 'USER'
    assert connection['segments'][0]['intent']['travel_mode'] == 'CAR'
    assert connection['segments'][0]['route_state'] == 'NOT_CALCULATED'
    assert connection['segments'][0]['from_endpoint']['latitude'] == 52.15
    route.assert_called_once()


def test_stop_insertion_cancel_is_atomic_and_confirmation_creates_fresh_connections(
    client, db_session, plan
):
    user, _, base, endpoint, revision, leg, data = plan
    saved = client.put(
        endpoint,
        headers=headers(user, revision),
        json={
            'notes': 'Booked travel',
            'segments': [leg['segments'][0]['intent'] | {'mode_selected': True}],
        },
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
    unchanged = client.get(base, headers=headers(user)).json()
    assert len(unchanged['stops']) == 2
    assert unchanged['legs'][0]['notes'] == 'Booked travel'
    inserted = client.post(
        base + '/stops?confirm_travel_deletion=true',
        headers=headers(user, saved.headers['etag']),
        json=payload,
    )
    assert inserted.status_code == 201, inserted.text
    assert len(inserted.json()['legs']) == 2
    assert all(
        connection['id'] != leg['id'] and connection['notes'] == ''
        for connection in inserted.json()['legs']
    )


def test_new_connection_uses_an_already_available_matching_car_estimate(
    client, db_session, plan, monkeypatch
):
    user, _, base, endpoint, revision, leg, data = plan
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
    payload = {'segments': [leg['segments'][0]['intent']]}
    preview = client.post(
        endpoint + '/preview', headers=headers(user, revision), json=payload
    )
    assert preview.status_code == 200, preview.text
    saved = client.put(
        endpoint,
        headers=headers(user, revision),
        json=payload | {'preview_id': preview.json()['preview_id']},
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
        response.json()['legs'][-1]['segments'][0]['intent']['travel_mode'] == 'FLIGHT'
    )
    assert response.json()['legs'][-1]['segments'][0]['mode_source'] == 'AUTO'
    route.assert_called_once()


def test_road_alternative_preview_selection_is_bound_and_saved_exactly(
    client, db_session, plan, monkeypatch
):
    user, _, base, endpoint, revision, leg, _ = plan
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
    payload = {'segments': [leg['segments'][0]['intent']]}
    preview = client.post(
        endpoint + '/preview', headers=headers(user, revision), json=payload
    )
    assert preview.status_code == 200, preview.text
    connection = preview.json()['connection']
    options = connection['segments'][0]['route_options']
    assert len(options) == 2
    assert options[0]['geometry'] == primary
    assert options[1]['geometry'] == alternative
    # Merely previewing leaves persisted travel untouched.
    assert (
        client.get(base, headers=headers(user)).json()['legs'][0]['segments'][0][
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
        'preview_id': preview.json()['preview_id'],
    }
    forged = chosen | {
        'segments': [
            chosen['segments'][0] | {'via': {'latitude': 52.3, 'longitude': 5.3}}
        ]
    }
    assert (
        client.put(endpoint, headers=headers(user, revision), json=forged).status_code
        == 409
    )
    missing = chosen | {'preview_id': str(uuid.uuid4())}
    assert (
        client.put(endpoint, headers=headers(user, revision), json=missing).status_code
        == 409
    )
    out_of_range = chosen | {'segments': [chosen['segments'][0] | {'route_option': 2}]}
    assert (
        client.put(
            endpoint, headers=headers(user, revision), json=out_of_range
        ).status_code
        == 409
    )
    saved = client.put(endpoint, headers=headers(user, revision), json=chosen)
    assert saved.status_code == 200, saved.text
    assert saved.json()['segments'][0]['geometry'] == alternative
    assert saved.json()['route']['geometry'] == alternative
    assert saved.json()['duration_seconds'] == 3900
    assert saved.json()['segments'][0]['distance_meters'] == 55000
    assert saved.json()['segments'][0]['mode_source'] == 'USER'
    assert provider.call_count == 1
    assert (
        client.get(base, headers=headers(user)).json()['legs'][0]['route']['geometry']
        == alternative
    )

    reopened_payload = {'segments': [saved.json()['segments'][0]['intent']]}
    reopened = client.post(
        endpoint + '/preview',
        headers=headers(user, saved.headers['etag']),
        json=reopened_payload,
    )
    assert reopened.status_code == 200, reopened.text
    assert reopened.json()['connection']['segments'][0]['geometry'] == alternative
    assert (
        reopened.json()['connection']['segments'][0]['route_options'][0]['geometry']
        == alternative
    )
    assert (
        reopened.json()['connection']['segments'][0]['route_options'][1]['geometry']
        == primary
    )
    assert provider.call_count == 2
