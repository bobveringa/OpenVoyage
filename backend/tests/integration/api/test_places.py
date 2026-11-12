from __future__ import annotations

import uuid

import pytest

from core import security
from factories.users import create_user
from models.database.places import Place, PlaceFeatureClass

PLACE_LOOKUPS = [
    ('/places/geocode', {'query': 'Amsterdam'}),
    ('/places/reverse-geocode', {'latitude': 52.37, 'longitude': 4.89}),
    ('/places/timezone', {'latitude': 52.37, 'longitude': 4.89}),
]


@pytest.fixture
def client(client, db_session):
    """Place lookups are for signed-in users; sign the shared client in."""
    user = create_user(db_session)
    tokens = security.create_auth_tokens(subject=user.id, email=user.email)
    client.headers['Authorization'] = f'Bearer {tokens["access_token"]}'
    return client


def _create_place(
    db_session,
    *,
    external_id: str,
    name: str,
    latitude: float,
    longitude: float,
    country_code: str,
    region: str,
    full_name: str,
    feature_class: PlaceFeatureClass = PlaceFeatureClass.POPULATED_PLACE,
    population: int = 0,
) -> Place:
    place = Place(
        id=uuid.uuid4(),
        external_source='test',
        external_id=external_id,
        name=name,
        latitude=latitude,
        longitude=longitude,
        country_code=country_code,
        region=region,
        full_name=full_name,
        feature_class=feature_class.value,
        population=population,
    )
    db_session.add(place)
    db_session.commit()
    db_session.refresh(place)
    return place


@pytest.mark.integration
def test_geocode_places_returns_matching_places(client, db_session, api_prefix) -> None:
    amsterdam = _create_place(
        db_session,
        external_id='amsterdam',
        name='Amsterdam',
        latitude=52.37403,
        longitude=4.88969,
        country_code='NL',
        region='North Holland',
        full_name='Amsterdam, North Holland, The Netherlands',
        population=741636,
    )
    _create_place(
        db_session,
        external_id='new-amsterdam',
        name='New Amsterdam',
        latitude=6.24793,
        longitude=-57.5171,
        country_code='GY',
        region='East Berbice-Corentyne',
        full_name='New Amsterdam, East Berbice-Corentyne, Guyana',
    )

    response = client.get(
        f'{api_prefix}/places/geocode',
        params={'query': 'amsterdam', 'country_code': 'NL'},
    )

    assert response.status_code == 200
    assert response.json() == [
        {
            'id': str(amsterdam.id),
            'name': 'Amsterdam',
            'full_name': 'Amsterdam, North Holland, The Netherlands',
            'latitude': 52.37403,
            'longitude': 4.88969,
            'country_code': 'NL',
            'region': 'North Holland',
            'feature_class': 'POPULATED_PLACE',
            'population': 741636,
            'feature_code': None, 'iata_code': None, 'icao_code': None, 'timezone': None,
            'part_of': None,
        }
    ]


@pytest.mark.integration
def test_geocode_places_ranks_exact_name_matches_by_population(
    client,
    db_session,
    api_prefix,
) -> None:
    paris_france = _create_place(
        db_session,
        external_id='paris-france',
        name='Paris',
        latitude=48.8534,
        longitude=2.3488,
        country_code='FR',
        region='Ile-de-France',
        full_name='Paris, Ile-de-France, France',
        population=2161000,
    )
    paris_texas = _create_place(
        db_session,
        external_id='paris-texas',
        name='Paris',
        latitude=33.6609,
        longitude=-95.5555,
        country_code='US',
        region='Texas',
        full_name='Paris, Texas, United States',
        population=25171,
    )

    response = client.get(
        f'{api_prefix}/places/geocode',
        params={'query': 'Paris', 'limit': 2},
    )

    assert response.status_code == 200
    data = response.json()
    assert [place['id'] for place in data] == [
        str(paris_france.id),
        str(paris_texas.id),
    ]


@pytest.mark.integration
def test_geocode_places_uses_comma_qualifiers(
    client,
    db_session,
    api_prefix,
) -> None:
    paris_france = _create_place(
        db_session,
        external_id='paris-france',
        name='Paris',
        latitude=48.8534,
        longitude=2.3488,
        country_code='FR',
        region='Ile-de-France',
        full_name='Paris, Ile-de-France, France',
        population=2161000,
    )
    _create_place(
        db_session,
        external_id='paris-texas',
        name='Paris',
        latitude=33.6609,
        longitude=-95.5555,
        country_code='US',
        region='Texas',
        full_name='Paris, Texas, United States',
        population=25171,
    )

    response = client.get(
        f'{api_prefix}/places/geocode',
        params={'query': 'Paris, France', 'limit': 5},
    )

    assert response.status_code == 200
    data = response.json()
    assert [place['id'] for place in data] == [str(paris_france.id)]


@pytest.mark.integration
def test_geocode_places_matches_multi_word_query_terms(
    client,
    db_session,
    api_prefix,
) -> None:
    paris_france = _create_place(
        db_session,
        external_id='paris-france',
        name='Paris',
        latitude=48.8534,
        longitude=2.3488,
        country_code='FR',
        region='Ile-de-France',
        full_name='Paris, Ile-de-France, France',
        population=2161000,
    )
    _create_place(
        db_session,
        external_id='paris-texas',
        name='Paris',
        latitude=33.6609,
        longitude=-95.5555,
        country_code='US',
        region='Texas',
        full_name='Paris, Texas, United States',
        population=25171,
    )

    response = client.get(
        f'{api_prefix}/places/geocode',
        params={'query': 'Paris France', 'limit': 5},
    )

    assert response.status_code == 200
    data = response.json()
    assert [place['id'] for place in data] == [str(paris_france.id)]


@pytest.mark.integration
def test_reverse_geocode_places_returns_nearest_places(
    client,
    db_session,
    api_prefix,
) -> None:
    eindhoven = _create_place(
        db_session,
        external_id='eindhoven',
        name='Eindhoven',
        latitude=51.44164,
        longitude=5.46972,
        country_code='NL',
        region='North Brabant',
        full_name='Eindhoven, North Brabant, The Netherlands',
    )
    _create_place(
        db_session,
        external_id='amsterdam',
        name='Amsterdam',
        latitude=52.37403,
        longitude=4.88969,
        country_code='NL',
        region='North Holland',
        full_name='Amsterdam, North Holland, The Netherlands',
    )

    response = client.get(
        f'{api_prefix}/places/reverse-geocode',
        params={'latitude': 51.44, 'longitude': 5.47, 'limit': 1},
    )

    assert response.status_code == 200
    data = response.json()
    assert len(data) == 1
    assert data[0]['place']['id'] == str(eindhoven.id)
    assert data[0]['place']['name'] == 'Eindhoven'
    assert data[0]['distance_km'] < 1


@pytest.mark.integration
def test_reverse_geocode_places_honors_max_distance(
    client,
    db_session,
    api_prefix,
) -> None:
    _create_place(
        db_session,
        external_id='amsterdam',
        name='Amsterdam',
        latitude=52.37403,
        longitude=4.88969,
        country_code='NL',
        region='North Holland',
        full_name='Amsterdam, North Holland, The Netherlands',
    )

    response = client.get(
        f'{api_prefix}/places/reverse-geocode',
        params={
            'latitude': 40.7128,
            'longitude': -74.006,
            'max_distance_km': 10,
        },
    )

    assert response.status_code == 200
    assert response.json() == []


@pytest.mark.integration
@pytest.mark.parametrize(('path', 'params'), PLACE_LOOKUPS)
def test_place_lookups_require_sign_in(client, api_prefix, path, params) -> None:
    client.headers.pop('Authorization')

    response = client.get(f'{api_prefix}{path}', params=params)

    assert response.status_code == 401


@pytest.mark.integration
@pytest.mark.parametrize(('path', 'params'), PLACE_LOOKUPS)
def test_place_lookups_require_a_completed_password_change(
    client, db_session, api_prefix, path, params
) -> None:
    user = create_user(db_session, password_change_required=True)
    tokens = security.create_auth_tokens(subject=user.id, email=user.email)
    client.headers['Authorization'] = f'Bearer {tokens["access_token"]}'

    response = client.get(f'{api_prefix}{path}', params=params)

    assert response.status_code == 403


@pytest.mark.integration
def test_timezone_returns_the_zone_at_the_point(client, api_prefix) -> None:
    response = client.get(
        f'{api_prefix}/places/timezone',
        params={'latitude': 35.6762, 'longitude': 139.6503},
    )

    assert response.status_code == 200
    assert response.json() == {'timezone': 'Asia/Tokyo'}


@pytest.mark.integration
def test_timezone_falls_back_to_the_ocean_zone(client, api_prefix) -> None:
    response = client.get(
        f'{api_prefix}/places/timezone', params={'latitude': 30, 'longitude': -40}
    )

    assert response.status_code == 200
    assert response.json() == {'timezone': 'Etc/GMT+3'}


@pytest.mark.integration
@pytest.mark.parametrize(
    'params',
    [
        {'latitude': 91, 'longitude': 0},
        {'latitude': -91, 'longitude': 0},
        {'latitude': 0, 'longitude': 181},
        {'latitude': 0, 'longitude': -181},
        {'latitude': 0},
        {'longitude': 0},
        {'latitude': 'north', 'longitude': 0},
    ],
)
def test_timezone_validates_coordinates(client, api_prefix, params) -> None:
    response = client.get(f'{api_prefix}/places/timezone', params=params)

    assert response.status_code == 422
