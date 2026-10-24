"""Opt-in live AeroAPI checks; never print credentials or raw responses.

Run RUN_LIVE_FLIGHTAWARE_TESTS=1 python -m pytest tests/integration/services/test_flightaware_live.py.
"""

import os
from datetime import datetime, timezone
from pathlib import Path

import pytest
from dotenv import dotenv_values

from models.api.planning import FlightLookupRequest
from services.flight_providers import FlightAwareFlightProvider

pytestmark = pytest.mark.skipif(
    os.getenv('RUN_LIVE_FLIGHTAWARE_TESTS') != '1', reason='Explicit live API test only'
)


@pytest.mark.parametrize('number', ['w6 4514', 'FR5682'])
def test_live_lookup_and_tracking(number):
    key = os.getenv('FLIGHTAWARE_API_KEY') or dotenv_values(
        Path(__file__).resolve().parents[4] / '.env'
    ).get('FLIGHTAWARE_API_KEY')
    if not key:
        pytest.skip('No FlightAware credential configured')
    provider = FlightAwareFlightProvider(api_key=key)
    intent = FlightLookupRequest(
        flight_number=number, departure_date=datetime.now(timezone.utc).date()
    )
    candidates = provider.lookup(intent)
    assert candidates, (
        'No flight scheduled on this date; choose a date when this flight operates'
    )
    assert all(
        row.provider == 'flightaware' and row.departure_airport.timezone
        for row in candidates
    )
    movements = provider.track(intent)
    assert movements
    assert any(
        row.scheduled_departure == candidates[0].scheduled_departure
        for row in movements
    )
