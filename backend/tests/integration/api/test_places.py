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
            'feature_class': 'P',
            'feature_class_description': 'Populated Place Features',
        }
    ]


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
