"""Opt-in: one real dated lookup, using the .env key only as a test fixture.

Run RUN_LIVE_FLIGHT_TESTS=1 with this module. Production reads the encrypted admin setting.
"""

import os
from pathlib import Path

import pytest
from dotenv import dotenv_values

from core.app_settings import FLIGHTS_RAPIDAPI_API_KEY
from services.app_settings_service import AppSettingsService
from integration.services.test_itinerary_route_service import plan, headers  # noqa: F401, F811


@pytest.mark.skipif(
    os.getenv('RUN_LIVE_FLIGHT_TESTS') != '1', reason='Explicit live API test only'
)
def test_configured_and_unconfigured_flight_api(client, db_session, plan):  # noqa: F811
    user, _, _, endpoint, revision, leg, _ = plan
    payload = {'flight_number': 'KL597', 'departure_date': '2026-11-18'}
    unconfigured = client.post(
        endpoint + '/flight-lookups', headers=headers(user, revision), json=payload
    )
    assert unconfigured.status_code == 200
    assert unconfigured.json()['status'] == 'UNAVAILABLE'
    test_key = dotenv_values(Path(__file__).resolve().parents[4] / '.env').get(
        'RAPIDAPI_API_KEY'
    )
    if not test_key:
        pytest.skip('No live test credential configured')
    service = AppSettingsService(db_session)
    service.update_setting(FLIGHTS_RAPIDAPI_API_KEY, test_key, user.id)
    configured = client.post(
        endpoint + '/flight-lookups', headers=headers(user, revision), json=payload
    )
    assert configured.status_code == 200
    assert configured.json()['status'] == 'MATCHES', configured.json().get('reason')
    candidate = configured.json()['candidates'][0]
    saved = client.put(
        endpoint,
        headers=headers(user, revision),
        json={
            'from': leg['from'],
            'to': leg['to'],
            'segments': [
                {
                    'travel_mode': 'FLIGHT',
                    'flight': payload | {'candidate_id': candidate['candidate_id']},
                }
            ],
        },
    )
    assert saved.status_code == 200
    assert (
        saved.json()['segments'][0]['lookup']['departure_airport']['iata_code'] == 'AMS'
    )
    assert saved.json()['segments'][0]['duration_seconds'] is not None
    service.reset_setting(FLIGHTS_RAPIDAPI_API_KEY)
    another_day = client.post(
        endpoint + '/flight-lookups',
        headers=headers(user, saved.headers['etag']),
        json=payload | {'departure_date': '2026-11-19'},
    )
    assert another_day.status_code == 200
    assert another_day.json()['status'] == 'UNAVAILABLE'
    # Disabling lookup does not remove the trip's already saved schedule.
    read = client.get(endpoint, headers=headers(user))
    assert read.json()['segments'][0]['lookup'] is not None
