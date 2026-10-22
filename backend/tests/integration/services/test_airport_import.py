import zipfile

from sqlalchemy import select

from factories.places import create_place
from models.database.places import Place
from services.place_service import GeoNamesDataset, PlaceService


def row(identifier, name, feature='PPL', zone='Europe/Amsterdam'):
    fields = [
        str(identifier),
        name,
        name,
        '',
        '52.3',
        '4.7',
        'S' if feature == 'AIRP' else 'P',
        feature,
        'NL',
        '',
        '07',
        '',
        '',
        '',
        '1',
        '',
        '',
        zone,
        '2026-10-18',
    ]
    return '\t'.join(fields)


def archive(path, name, text):
    with zipfile.ZipFile(path, 'w') as output:
        output.writestr(name, text)
    return path


def test_airport_import_backfills_all_existing_places_without_importing_every_feature(
    db_session,
    tmp_path,
    client,
    api_prefix,
):
    existing = create_place(db_session, name='Existing city')
    existing.external_source, existing.external_id = 'geonames', '3'
    existing_id = existing.id
    db_session.commit()
    cities = archive(tmp_path / 'cities.zip', 'cities.txt', row(1, 'Amsterdam'))
    full = archive(
        tmp_path / 'full.zip',
        'allCountries.txt',
        '\n'.join(
            [
                row(1, 'Amsterdam'),
                row(2, 'Schiphol', 'AIRP'),
                row(3, 'Existing city', zone='Europe/Brussels'),
                row(4, 'Do not import this city'),
                row(5, 'Missing zone airport', 'AIRP', zone='invalid/zone'),
            ]
        ),
    )
    aliases = tmp_path / 'aliases.zip'
    # The official ZIP starts with this metadata file, not the alias rows.
    with zipfile.ZipFile(aliases, 'w') as output:
        output.writestr(
            'iso-languagecodes.txt', 'ISO 639-3\tISO 639-2\tISO 639-1\tLanguage Name\n'
        )
        output.writestr(
            'alternateNamesV2.txt',
            '1\t2\tiata\tAMS\t1\t0\t0\t0\n2\t2\ticao\tEHAM\t1\t0\t0\t0\n',
        )
    service = PlaceService(db_session)
    service.import_geonames_zip(cities, GeoNamesDataset.CITIES_500)
    first_id = db_session.scalar(select(Place.id).where(Place.external_id == '1'))
    stats = service.import_airport_reference_data(dump_path=full, aliases_path=aliases)
    assert stats == {'airports': 2, 'timezones_backfilled': 2}
    db_session.expire_all()
    assert db_session.get(Place, existing_id).timezone == 'Europe/Brussels'
    assert db_session.scalar(select(Place).where(Place.external_id == '4')) is None
    airport = db_session.scalar(select(Place).where(Place.iata_code == 'AMS'))
    assert airport.icao_code == 'EHAM'
    assert airport.timezone == 'Europe/Amsterdam'
    airport_id = airport.id
    assert (
        db_session.scalar(select(Place).where(Place.external_id == '5')).timezone
        is None
    )
    # Airport additions must not replace the usual city labels/search results.
    assert client.get(
        api_prefix + '/places/geocode', params={'query': 'AMS', 'type': 'AIRPORT'}
    ).json()[0]['id'] == str(airport_id)
    assert (
        client.get(api_prefix + '/places/geocode', params={'query': 'Schiphol'}).json()
        == []
    )
    assert (
        client.get(
            api_prefix + '/places/reverse-geocode',
            params={'latitude': 52.3, 'longitude': 4.7},
        ).json()[0]['place']['feature_code']
        != 'AIRP'
    )
    service.import_airport_reference_data(dump_path=full, aliases_path=aliases)
    service.import_geonames_zip(
        cities, GeoNamesDataset.CITIES_500, replace_existing=True
    )
    assert db_session.get(Place, airport_id).iata_code == 'AMS'
    assert (
        db_session.scalar(select(Place.id).where(Place.external_id == '1')) == first_id
    )
