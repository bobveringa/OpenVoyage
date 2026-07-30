from __future__ import annotations

import uuid

import pytest

from models.database.places import Place, PlaceFeatureClass


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
