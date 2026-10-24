import uuid

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from models.database.places import Place
from services.flight_airports import lookup_airport_endpoint


@pytest.fixture
def airport_db():
    engine = create_engine('sqlite://')
    Place.__table__.create(engine)
    with Session(engine) as db:
        db.add(Place(
            id=uuid.uuid4(), external_source='geonames', external_id='1',
            name='Eindhoven Airport', full_name='Eindhoven Airport, NL',
            latitude=51.45, longitude=5.37, country_code='NL', region='',
            feature_class='S', feature_code='AIRP', iata_code='EIN',
            icao_code='EHEH', timezone='Europe/Amsterdam',
        ))
        db.commit()
        yield db
    engine.dispose()


@pytest.mark.parametrize('code', ['EIN', 'EHEH'])
def test_exact_code_returns_complete_local_endpoint(airport_db, code):
    endpoint = lookup_airport_endpoint(airport_db, code)
    assert endpoint.name == 'Eindhoven Airport'
    assert endpoint.latitude == 51.45
    assert endpoint.longitude == 5.37
    assert endpoint.timezone == 'Europe/Amsterdam'
    assert endpoint.iata_code == 'EIN'
    assert endpoint.icao_code == 'EHEH'
    assert endpoint.place_id is not None


@pytest.mark.parametrize('code', ['AMS', 'Eindhoven', 'Eindhoven Airport', 'EIN%'])
def test_missing_or_name_match_allows_remote_fallback(airport_db, code):
    assert lookup_airport_endpoint(airport_db, code) is None


@pytest.mark.parametrize('changes', [
    {'timezone': None}, {'timezone': 'Unknown/Zone'},
    {'latitude': 91}, {'longitude': 181},
    {'feature_class': 'P'}, {'feature_code': 'AIRH'},
])
def test_incomplete_or_non_airport_place_allows_fallback(airport_db, changes):
    place = airport_db.query(Place).one()
    for key, value in changes.items():
        setattr(place, key, value)
    airport_db.flush()
    assert lookup_airport_endpoint(airport_db, 'EIN') is None


def test_conflicting_exact_codes_allow_fallback(airport_db):
    airport_db.add(Place(
        external_source='geonames', external_id='2', name='Other Airport',
        full_name='Other Airport', latitude=1, longitude=2, country_code='NL',
        region='', feature_class='S', feature_code='AIRP', icao_code='EIN',
        timezone='UTC',
    ))
    airport_db.flush()
    assert lookup_airport_endpoint(airport_db, 'EIN') is None
