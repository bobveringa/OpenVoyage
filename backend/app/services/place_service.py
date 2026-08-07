import enum
import tempfile
import uuid
import zipfile
from collections.abc import Iterable
from dataclasses import dataclass
from pathlib import Path
from shutil import copyfileobj
from urllib.request import urlopen

from sqlalchemy import and_, case, delete, func, or_, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from core.config import settings
from models.database.places import Place, PlaceFeatureClass

GEONAMES_SOURCE = 'geonames'
GEONAMES_COLUMNS = 19
IMPORT_BATCH_SIZE = 1000
GEONAMES_ADMIN1_CODES_FILE = 'admin1CodesASCII.txt'
GEONAMES_COUNTRY_INFO_FILE = 'countryInfo.txt'
GEONAMES_FEATURE_CLASSES = {
    'A': PlaceFeatureClass.ADMINISTRATIVE_BOUNDARY,
    'H': PlaceFeatureClass.HYDROGRAPHIC,
    'L': PlaceFeatureClass.AREA,
    'P': PlaceFeatureClass.POPULATED_PLACE,
    'R': PlaceFeatureClass.ROAD_RAILROAD,
    'S': PlaceFeatureClass.SPOT,
    'T': PlaceFeatureClass.HYPSOGRAPHIC,
    'U': PlaceFeatureClass.UNDERSEA,
    'V': PlaceFeatureClass.VEGETATION,
}


class GeoNamesDataset(str, enum.Enum):
    """GeoNames dump files supported by the places importer."""

    CITIES_500 = 'cities500'
    CITIES_1000 = 'cities1000'
    CITIES_5000 = 'cities5000'
    CITIES_15000 = 'cities15000'
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
    deleted: int = 0


@dataclass(frozen=True)
class ReverseGeocodeResult:
    """Nearest place result for a coordinate lookup."""

    place: Place
    distance_km: float


@dataclass(frozen=True)
class GeoNamesNameMetadata:
    """Display-name metadata from GeoNames support files."""

    admin1_names: dict[tuple[str, str], str]
    country_names: dict[str, str]


@dataclass(frozen=True)
class PlaceSearchQuery:
    """Parsed place search text split into name and location qualifiers."""

    primary: str
    qualifiers: tuple[str, ...]


def _distance_km_expression(latitude: float, longitude: float):
    """Build a PostgreSQL haversine distance expression in kilometers."""
    earth_radius_km = 6371.0088
    latitude_delta = func.radians((Place.latitude - latitude) / 2)
    longitude_delta = func.radians((Place.longitude - longitude) / 2)
    haversine = func.pow(func.sin(latitude_delta), 2) + func.cos(
        func.radians(latitude)
    ) * func.cos(func.radians(Place.latitude)) * func.pow(func.sin(longitude_delta), 2)
    return earth_radius_km * 2 * func.asin(func.sqrt(haversine))


def _escape_like(value: str) -> str:
    """Escape user input used in SQL LIKE patterns."""
    return value.replace('\\', '\\\\').replace('%', '\\%').replace('_', '\\_')


def _normalize_search_text(value: str) -> str:
    """Normalize user search text for ranking and LIKE comparisons."""
    return ' '.join(value.strip().lower().split())


def _parse_geocode_query(query: str) -> PlaceSearchQuery | None:
    """Split a query like ``Paris, France`` into name and qualifier terms."""
    parts: list[str] = []
    for part in query.split(','):
        normalized_part = _normalize_search_text(part)
        if normalized_part:
            parts.append(normalized_part)

    if not parts:
        return None

    return PlaceSearchQuery(
        primary=parts[0],
        qualifiers=tuple(parts[1:]),
    )


def _parse_geonames_population(value: str) -> int:
    """Parse GeoNames population, using zero when the dump value is unusable."""
    try:
        return max(0, int(value.strip() or '0'))
    except ValueError:
        return 0


def _download_geonames_url(url: str, suffix: str) -> Path:
    """Download a GeoNames URL to a temporary file."""
    with urlopen(url, timeout=30) as response:
        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
            copyfileobj(response, tmp)
            return Path(tmp.name)


def _load_admin1_names(path: Path) -> dict[tuple[str, str], str]:
    """Load GeoNames admin1 display names keyed by country and admin1 code."""
    admin1_names: dict[tuple[str, str], str] = {}
    with path.open(encoding='utf-8') as file:
        for line in file:
            row = line.rstrip('\n').split('\t')
            if len(row) < 2:
                continue

            code_parts = row[0].strip().upper().split('.', maxsplit=1)
            name = row[1].strip()
            if len(code_parts) == 2 and name:
                admin1_names[(code_parts[0], code_parts[1])] = name

    return admin1_names


def _load_country_names(path: Path) -> dict[str, str]:
    """Load GeoNames country display names keyed by ISO country code."""
    country_names: dict[str, str] = {}
    with path.open(encoding='utf-8') as file:
        for line in file:
            if line.startswith('#'):
                continue

            row = line.rstrip('\n').split('\t')
            if len(row) < 5:
                continue

            country_code = row[0].strip().upper()
            country_name = row[4].strip()
            if country_code and country_name:
                country_names[country_code] = country_name

    return country_names


def _iter_geonames_rows(path: Path) -> Iterable[list[str]]:
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


def _load_name_metadata(
    admin1_codes_path: Path,
    country_info_path: Path,
) -> GeoNamesNameMetadata:
    """Load display names used to expand GeoNames country and region codes."""
    return GeoNamesNameMetadata(
        admin1_names=_load_admin1_names(path=admin1_codes_path),
        country_names=_load_country_names(path=country_info_path),
    )


def _download_geonames_file(file_name: str) -> Path:
    """Download a GeoNames support file to a temporary file.

    Args:
        file_name: GeoNames dump support file name.

    Returns:
        Path to a temporary file containing the downloaded support data.
    """
    url = f'{settings.GEONAMES_DOWNLOAD_BASE_URL.rstrip("/")}/{file_name}'
    return _download_geonames_url(url=url, suffix='.txt')


def _download_geonames_zip(dataset: GeoNamesDataset) -> Path:
    """Download a GeoNames zip dataset to a temporary file.

    Args:
        dataset: GeoNames dump file to download.

    Returns:
        Path to a temporary zip file containing the downloaded dataset.
    """
    url = f'{settings.GEONAMES_DOWNLOAD_BASE_URL.rstrip("/")}/{dataset.value}.zip'
    return _download_geonames_url(url=url, suffix='.zip')


def _feature_class_from_geonames_code(
    feature_class_code: str,
) -> PlaceFeatureClass | None:
    """Translate a GeoNames feature class code to a readable enum."""
    return GEONAMES_FEATURE_CLASSES.get(feature_class_code.strip().upper())


def _build_region_name(
    region: str,
    country_code: str,
    name_metadata: GeoNamesNameMetadata | None,
) -> str:
    """Build a human-readable region name from GeoNames codes."""
    if name_metadata is not None:
        return name_metadata.admin1_names.get(
            (country_code, region),
            region,
        )

    return region


def _build_full_name(
    name: str,
    region: str,
    country_code: str,
    name_metadata: GeoNamesNameMetadata | None,
) -> str:
    """Build a human-readable place name from GeoNames codes."""
    country_name = country_code
    if name_metadata is not None:
        country_name = name_metadata.country_names.get(country_code, country_code)

    return ', '.join(part for part in [name, region, country_name] if part)


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

    def geocode(
        self,
        query: str,
        limit: int,
        country_code: str | None = None,
    ) -> list[Place]:
        """Find places whose name or full name matches a text query.

        Comma-separated trailing query parts are treated as location qualifiers.
        For example, ``Paris, France`` searches for places named ``Paris`` and
        requires ``France`` to match the country, region, or full display name.
        """
        parsed_query = _parse_geocode_query(query)
        if parsed_query is None:
            return []

        query_lower = parsed_query.primary
        escaped_query = _escape_like(parsed_query.primary)
        contains_query = f'%{escaped_query}%'
        starts_with_query = f'{escaped_query}%'
        query_terms = tuple(query_lower.split())
        lower_name = func.lower(Place.name)
        lower_full_name = func.lower(Place.full_name)
        lower_region = func.lower(Place.region)
        lower_country_code = func.lower(Place.country_code)

        base_match_filters = [
            lower_name.like(contains_query, escape='\\'),
            lower_full_name.like(contains_query, escape='\\'),
        ]
        if len(query_terms) > 1:
            base_match_filters.append(
                and_(
                    *[
                        lower_full_name.like(
                            f'%{_escape_like(term)}%',
                            escape='\\',
                        )
                        for term in query_terms
                    ]
                )
            )

        filters = [or_(*base_match_filters)]
        for qualifier in parsed_query.qualifiers:
            escaped_qualifier = _escape_like(qualifier)
            contains_qualifier = f'%{escaped_qualifier}%'
            qualifier_filters = [
                lower_full_name.like(contains_qualifier, escape='\\'),
                lower_region.like(contains_qualifier, escape='\\'),
            ]
            if len(qualifier) == 2:
                qualifier_filters.append(lower_country_code == qualifier)

            filters.append(or_(*qualifier_filters))

        if country_code:
            filters.append(Place.country_code == country_code.strip().upper())

        rank = case(
            (lower_name == query_lower, 0),
            (lower_full_name == query_lower, 1),
            (lower_name.like(starts_with_query, escape='\\'), 2),
            (lower_full_name.like(starts_with_query, escape='\\'), 3),
            else_=4,
        )
        feature_rank = case(
            (Place.feature_class == PlaceFeatureClass.POPULATED_PLACE.value, 0),
            (Place.feature_class == PlaceFeatureClass.ADMINISTRATIVE_BOUNDARY.value, 1),
            (Place.feature_class == PlaceFeatureClass.AREA.value, 2),
            else_=3,
        )

        statement = (
            select(Place)
            .where(*filters)
            .order_by(
                rank,
                feature_rank,
                Place.population.desc(),
                Place.name.asc(),
                Place.region.asc(),
                Place.country_code.asc(),
            )
            .limit(limit)
        )
        return list(self.db.scalars(statement).all())

    def reverse_geocode(
        self,
        latitude: float,
        longitude: float,
        limit: int,
        max_distance_km: float | None = None,
    ) -> list[ReverseGeocodeResult]:
        """Find the nearest places to a latitude/longitude coordinate."""
        distance_km = _distance_km_expression(
            latitude=latitude,
            longitude=longitude,
        )

        statement = select(Place, distance_km.label('distance_km')).order_by(
            distance_km.asc(),
            Place.name.asc(),
        )
        if max_distance_km is not None:
            statement = statement.where(distance_km <= max_distance_km)

        rows = self.db.execute(statement.limit(limit)).all()
        return [
            ReverseGeocodeResult(place=place, distance_km=float(distance))
            for place, distance in rows
        ]

    def import_geonames_dataset(
        self,
        dataset: GeoNamesDataset,
        replace_existing: bool = False,
    ) -> PlaceImportResult:
        """Download and import a supported GeoNames zip dataset.

        Args:
            dataset: GeoNames dump file to download and import.

        Returns:
            Summary containing the selected dataset and processed row count.
        """
        zip_path = _download_geonames_zip(dataset=dataset)
        metadata_paths: list[Path] = []
        try:
            for file_name in [
                GEONAMES_ADMIN1_CODES_FILE,
                GEONAMES_COUNTRY_INFO_FILE,
            ]:
                metadata_paths.append(_download_geonames_file(file_name=file_name))

            name_metadata = _load_name_metadata(
                admin1_codes_path=metadata_paths[0],
                country_info_path=metadata_paths[1],
            )
            return self.import_geonames_zip(
                path=zip_path,
                dataset=dataset,
                name_metadata=name_metadata,
                replace_existing=replace_existing,
            )
        finally:
            zip_path.unlink(missing_ok=True)
            for metadata_path in metadata_paths:
                metadata_path.unlink(missing_ok=True)

    def import_geonames_zip(
        self,
        path: Path,
        dataset: GeoNamesDataset,
        name_metadata: GeoNamesNameMetadata | None = None,
        replace_existing: bool = False,
    ) -> PlaceImportResult:
        """Import place rows from a local GeoNames zip file.

        Args:
            path: Path to a GeoNames zip file.
            dataset: Dataset represented by the zip file.
            name_metadata: Optional display-name metadata used to expand country and region codes.

        Returns:
            Summary containing the selected dataset and processed row count.
        """
        deleted = 0
        if replace_existing:
            result = self.db.execute(
                delete(Place).where(Place.external_source == GEONAMES_SOURCE)
            )
            deleted = result.rowcount or 0
        processed = 0
        batch: list[dict[str, object]] = []
        for row in _iter_geonames_rows(path=path):
            place_values = self._place_values_from_geonames_row(
                row=row,
                name_metadata=name_metadata,
            )
            if place_values is None:
                continue

            batch.append(place_values)
            processed += 1
            if len(batch) >= IMPORT_BATCH_SIZE:
                self._upsert_places(batch)
                batch = []

        if processed == 0 and replace_existing:
            self.db.rollback()
            raise ValueError('GeoNames import did not contain valid places')

        try:
            if batch:
                self._upsert_places(batch)
            self.db.commit()
        except Exception:
            self.db.rollback()
            raise
        return PlaceImportResult(
            dataset=dataset,
            deleted=deleted,
            processed=processed,
        )

    def _place_values_from_geonames_row(
        self,
        row: list[str],
        name_metadata: GeoNamesNameMetadata | None = None,
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
        except ValueError:
            return None

        geoname_id = row[0].strip()
        name = row[1].strip()
        country_code = row[8].strip().upper()
        if not geoname_id or not name or not country_code:
            return None

        feature_class = _feature_class_from_geonames_code(row[6])
        if feature_class is None:
            return None

        region = row[10].strip()
        region_name = _build_region_name(
            region=region,
            country_code=country_code,
            name_metadata=name_metadata,
        )
        full_name = _build_full_name(
            name=name,
            region=region_name,
            country_code=country_code,
            name_metadata=name_metadata,
        )

        return {
            'id': uuid.uuid4(),
            'external_source': GEONAMES_SOURCE,
            'external_id': geoname_id,
            'name': name,
            'latitude': latitude,
            'longitude': longitude,
            'country_code': country_code,
            'region': region_name,
            'full_name': full_name,
            'feature_class': feature_class,
            'population': _parse_geonames_population(row[14]),
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
            'latitude': excluded.latitude,
            'longitude': excluded.longitude,
            'country_code': excluded.country_code,
            'region': excluded.region,
            'full_name': excluded.full_name,
            'feature_class': excluded.feature_class,
            'population': excluded.population,
            'updated_at': func.now(),
        }
        self.db.execute(
            statement.on_conflict_do_update(
                index_elements=['external_source', 'external_id'],
                set_=update_values,
            )
        )
