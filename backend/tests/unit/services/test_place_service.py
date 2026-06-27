from __future__ import annotations

import zipfile
from pathlib import Path
from unittest.mock import Mock

import pytest

from models.database.places import PlaceFeatureClass
from services.place_service import (
    GeoNamesDataset,
    GeoNamesNameMetadata,
    PlaceService,
    _load_name_metadata,
)


def _write_geonames_zip(path: Path, rows: list[list[str]]) -> None:
    content = '\n'.join('\t'.join(row) for row in rows)
    with zipfile.ZipFile(path, 'w') as archive:
        archive.writestr('cities500.txt', content)


@pytest.mark.unit
def test_import_geonames_zip_processes_valid_rows(tmp_path) -> None:
    zip_path = tmp_path / 'cities500.zip'
    _write_geonames_zip(
        zip_path,
        [
            [
                '2759794',
                'Amsterdam',
                'Amsterdam',
                '',
                '52.37403',
                '4.88969',
                'P',
                'PPLC',
                'NL',
                '',
                '07',
                '',
                '',
                '',
                '741636',
                '',
                '',
                'Europe/Amsterdam',
                '2024-01-01',
            ],
            [
                'bad-row',
                'Invalid',
                'Invalid',
                '',
                'not-lat',
                '4.88969',
                'P',
                'PPL',
                'NL',
                '',
                '07',
                '',
                '',
                '',
                '0',
                '',
                '',
                'Europe/Amsterdam',
                '2024-01-01',
            ],
        ],
    )
    service = PlaceService(db=Mock())
    upsert = Mock()
    service._upsert_places = upsert

    result = service.import_geonames_zip(
        path=zip_path,
        dataset=GeoNamesDataset.CITIES_500,
    )

    assert result.dataset == GeoNamesDataset.CITIES_500
    assert result.processed == 1
    upsert.assert_called_once()
    values = upsert.call_args.args[0]
    assert values[0]['external_source'] == 'geonames'
    assert values[0]['external_id'] == '2759794'
    assert values[0]['name'] == 'Amsterdam'
    assert values[0]['country_code'] == 'NL'
    assert values[0]['region'] == '07'
    assert values[0]['full_name'] == 'Amsterdam, 07, NL'
    assert values[0]['feature_class'] == PlaceFeatureClass.POPULATED_PLACE
    assert values[0]['feature_class'].value == 'P'


@pytest.mark.unit
def test_import_geonames_zip_uses_name_metadata_for_full_name(tmp_path) -> None:
    zip_path = tmp_path / 'cities500.zip'
    _write_geonames_zip(
        zip_path,
        [
            [
                '2756253',
                'Eindhoven',
                'Eindhoven',
                '',
                '51.44083',
                '5.47778',
                'P',
                'PPL',
                'NL',
                '',
                '06',
                '',
                '',
                '',
                '209620',
                '',
                '',
                'Europe/Amsterdam',
                '2024-01-01',
            ],
        ],
    )
    service = PlaceService(db=Mock())
    upsert = Mock()
    service._upsert_places = upsert
    name_metadata = GeoNamesNameMetadata(
        admin1_names={('NL', '06'): 'North Brabant'},
        country_names={'NL': 'The Netherlands'},
    )

    result = service.import_geonames_zip(
        path=zip_path,
        dataset=GeoNamesDataset.CITIES_500,
        name_metadata=name_metadata,
    )

    assert result.processed == 1
    upsert.assert_called_once()
    values = upsert.call_args.args[0]
    assert values[0]['region'] == 'North Brabant'
    assert values[0]['full_name'] == 'Eindhoven, North Brabant, The Netherlands'
    assert values[0]['feature_class'] == PlaceFeatureClass.POPULATED_PLACE


@pytest.mark.unit
def test_import_geonames_zip_skips_unknown_feature_class(tmp_path) -> None:
    zip_path = tmp_path / 'cities500.zip'
    _write_geonames_zip(
        zip_path,
        [
            [
                '2759794',
                'Amsterdam',
                'Amsterdam',
                '',
                '52.37403',
                '4.88969',
                'X',
                'PPLC',
                'NL',
                '',
                '07',
                '',
                '',
                '',
                '741636',
                '',
                '',
                'Europe/Amsterdam',
                '2024-01-01',
            ],
        ],
    )
    service = PlaceService(db=Mock())
    upsert = Mock()
    service._upsert_places = upsert

    result = service.import_geonames_zip(
        path=zip_path,
        dataset=GeoNamesDataset.CITIES_500,
    )

    assert result.processed == 0
    upsert.assert_not_called()


@pytest.mark.unit
def test_load_name_metadata_reads_geonames_support_files(tmp_path) -> None:
    admin1_codes_path = tmp_path / 'admin1CodesASCII.txt'
    admin1_codes_path.write_text(
        'NL.06\tNorth Brabant\tNorth Brabant\t2749990\n',
        encoding='utf-8',
    )
    country_info_path = tmp_path / 'countryInfo.txt'
    country_info_path.write_text(
        '#ISO\tISO3\tISO-Numeric\tfips\tCountry\n'
        'NL\tNLD\t528\tNL\tThe Netherlands\tAmsterdam\n',
        encoding='utf-8',
    )
    name_metadata = _load_name_metadata(
        admin1_codes_path=admin1_codes_path,
        country_info_path=country_info_path,
    )

    assert name_metadata.admin1_names == {('NL', '06'): 'North Brabant'}
    assert name_metadata.country_names == {'NL': 'The Netherlands'}
