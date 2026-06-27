from __future__ import annotations

import zipfile
from pathlib import Path
from unittest.mock import Mock

import pytest

from services.place_service import GeoNamesDataset, PlaceService


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
    assert values[0]['search_name'] == 'amsterdam'
    assert values[0]['country_code'] == 'NL'
    assert values[0]['region'] == '07'
    assert values[0]['population'] == 741636
