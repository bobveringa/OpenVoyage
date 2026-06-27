import enum
import tempfile
import uuid
import zipfile
from collections.abc import Iterable
from dataclasses import dataclass
from pathlib import Path
from shutil import copyfileobj
from urllib.request import urlopen

from sqlalchemy import func
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from core.config import settings
from models.database.places import Place

GEONAMES_SOURCE = 'geonames'
GEONAMES_COLUMNS = 19
IMPORT_BATCH_SIZE = 1000


class GeoNamesDataset(str, enum.Enum):
    """GeoNames dump files supported by the places importer."""

    CITIES_500 = 'cities500'
    ALL_COUNTRIES = 'allCountries'


@dataclass(frozen=True)
class PlaceImportResult:
    """Summary of a GeoNames places import.

    Args:
        dataset: Dataset that was imported.
        processed: Number of valid GeoNames rows processed.
    """

    dataset: GeoNamesDataset
    processed: int


class PlaceService:
    """Imports and maintains backend-trusted place data.

    Args:
        db: SQLAlchemy session used for place persistence.
    """

    def __init__(self, db: Session) -> None:
        """Initialize the service.

        Args:
            db: SQLAlchemy session used for database reads and writes.
        """
        self.db = db

    def import_geonames_dataset(self, dataset: GeoNamesDataset) -> PlaceImportResult:
        """Download and import a supported GeoNames zip dataset.

        Args:
            dataset: GeoNames dump file to download and import.

        Returns:
            Summary containing the selected dataset and processed row count.
        """
        zip_path = self._download_geonames_zip(dataset=dataset)
        try:
            return self.import_geonames_zip(path=zip_path, dataset=dataset)
        finally:
            zip_path.unlink(missing_ok=True)

    def import_geonames_zip(
        self,
        path: Path,
        dataset: GeoNamesDataset,
    ) -> PlaceImportResult:
        """Import place rows from a local GeoNames zip file.

        Args:
            path: Path to a GeoNames zip file.
            dataset: Dataset represented by the zip file.

        Returns:
            Summary containing the selected dataset and processed row count.
        """
        processed = 0
        batch: list[dict[str, object]] = []
        for row in self._iter_geonames_rows(path=path):
            place_values = self._place_values_from_geonames_row(row=row)
            if place_values is None:
                continue

            batch.append(place_values)
            processed += 1
            if len(batch) >= IMPORT_BATCH_SIZE:
                self._upsert_places(batch)
                batch = []

        if batch:
            self._upsert_places(batch)

        self.db.commit()
        return PlaceImportResult(dataset=dataset, processed=processed)

    def _download_geonames_zip(self, dataset: GeoNamesDataset) -> Path:
        """Download a GeoNames zip dataset to a temporary file.

        Args:
            dataset: GeoNames dump file to download.

        Returns:
            Path to a temporary zip file containing the downloaded dataset.
        """
        url = f'{settings.GEONAMES_DOWNLOAD_BASE_URL.rstrip("/")}/{dataset.value}.zip'
        with urlopen(url) as response:
            with tempfile.NamedTemporaryFile(delete=False, suffix='.zip') as tmp:
                copyfileobj(response, tmp)
                return Path(tmp.name)

    def _iter_geonames_rows(self, path: Path) -> Iterable[list[str]]:
        """Yield tab-separated GeoNames rows from a zip file.

        Args:
            path: Path to a GeoNames zip file.

        Yields:
            Parsed column values for rows matching the GeoNames format.
        """
        with zipfile.ZipFile(path) as archive:
            text_member = next(
                name for name in archive.namelist() if name.lower().endswith('.txt')
            )
            with archive.open(text_member) as file:
                for raw_line in file:
                    line = raw_line.decode('utf-8').rstrip('\n')
                    row = line.split('\t')
                    if len(row) >= GEONAMES_COLUMNS:
                        yield row

    def _place_values_from_geonames_row(
        self,
        row: list[str],
    ) -> dict[str, object] | None:
        """Map a GeoNames row to ``places`` upsert values.

        Args:
            row: Parsed GeoNames row.

        Returns:
            Dictionary ready for insertion, or ``None`` when required fields are bad.
        """
        try:
            latitude = float(row[4])
            longitude = float(row[5])
            population = int(row[14] or 0)
        except ValueError:
            return None

        geoname_id = row[0].strip()
        name = row[1].strip()
        country_code = row[8].strip().upper()
        if not geoname_id or not name or not country_code:
            return None

        region = row[10].strip()
        feature_class = row[6].strip()
        feature_code = row[7].strip()
        full_name = ', '.join(part for part in [name, region, country_code] if part)

        return {
            'id': uuid.uuid4(),
            'external_source': GEONAMES_SOURCE,
            'external_id': geoname_id,
            'name': name,
            'search_name': name.casefold(),
            'latitude': latitude,
            'longitude': longitude,
            'country_code': country_code,
            'region': region,
            'full_name': full_name,
            'feature_class': feature_class,
            'feature_code': feature_code,
            'population': population,
        }

    def _upsert_places(self, values: list[dict[str, object]]) -> None:
        """Insert or update a batch of places by external source/id.

        Args:
            values: Place column values to upsert.
        """
        statement = insert(Place).values(values)
        excluded = statement.excluded
        update_values = {
            'name': excluded.name,
            'search_name': excluded.search_name,
            'latitude': excluded.latitude,
            'longitude': excluded.longitude,
            'country_code': excluded.country_code,
            'region': excluded.region,
            'full_name': excluded.full_name,
            'feature_class': excluded.feature_class,
            'feature_code': excluded.feature_code,
            'population': excluded.population,
            'updated_at': func.now(),
        }
        self.db.execute(
            statement.on_conflict_do_update(
                index_elements=['external_source', 'external_id'],
                set_=update_values,
            )
        )
