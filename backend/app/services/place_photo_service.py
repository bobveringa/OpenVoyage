"""Header photos for stop cards: the lead photo of a town's English Wikipedia article.

Everything happens inside the one request that asks for a stop's photo, with
3 seconds in total. The result is remembered per place in ``place_photos``,
and the image is stored as our own WebP copy, so viewing a trip never
contacts Wikipedia.
"""

from __future__ import annotations

import json
import logging
import os
import tempfile
import time
import uuid
from dataclasses import dataclass
from datetime import timedelta
from html.parser import HTMLParser
from io import BytesIO
from pathlib import Path
from urllib.parse import urlencode, urlsplit
from urllib.request import Request, urlopen

from PIL import Image
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from core.app_settings import PLACES_WIKIPEDIA_PHOTOS_KEY
from core.config import settings
from core.version import APP_VERSION
from models.database.base import utcnow
from models.database.locations import Location
from models.database.places import Place, PlacePhoto, PlacePhotoStatus
from services.place_service import PlaceService
from utils.media.image_util import generate_image_thumbnail

logger = logging.getLogger(__name__)

PHOTO_MIN_POPULATION = 15_000
PHOTO_TOWN_RADIUS_KM = 10.0
FETCH_BUDGET_SECONDS = 3.0
RETRY_FAILED_AFTER = timedelta(hours=1)
PHOTO_WIDTH = 800
MAX_DOWNLOAD_BYTES = 8 * 1024 * 1024
WIKIPEDIA_API_URL = 'https://en.wikipedia.org/w/api.php'
COMMONS_API_URL = 'https://commons.wikimedia.org/w/api.php'
# Thumbnails are only ever downloaded from Wikimedia's own file hosts.
# Commons answers with thumb.wikimedia.org (rounded up to a standard width,
# for example 960 px); older answers use upload.wikimedia.org.
IMAGE_HOSTS = ('upload.wikimedia.org', 'thumb.wikimedia.org')
USER_AGENT = f'OpenVoyage/{APP_VERSION} (self-hosted travel blog; header photos)'


class PhotoFetchError(Exception):
    """Wikipedia was slow, unreachable or answered something unexpected."""


@dataclass(frozen=True)
class CommonsFile:
    thumb_url: str
    source_url: str
    credit: str | None
    license: str | None


def place_photo_path(place_id: uuid.UUID) -> Path:
    return Path(settings.media_root) / 'place-photos' / f'{place_id}.webp'


class _TextOnly(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.parts: list[str] = []

    def handle_data(self, data: str) -> None:
        self.parts.append(data)


def plain_text(html: str | None) -> str | None:
    """Commons' ``Artist`` field is HTML (often a link); keep the words only."""
    if not html:
        return None
    parser = _TextOnly()
    parser.feed(html)
    parser.close()
    text = ' '.join(''.join(parser.parts).split())
    return text or None


class WikipediaClient:
    """The three Wikimedia calls, each within what is left of one deadline."""

    def lead_image(self, title: str, deadline: float) -> str | None:
        """The file name of the article's free lead image, or None."""
        data = self._get_json(WIKIPEDIA_API_URL, {
            'action': 'query', 'format': 'json', 'formatversion': '2', 'redirects': '1',
            'prop': 'pageimages', 'piprop': 'name', 'pilicense': 'free', 'titles': title,
        }, deadline)
        pages = (data.get('query') or {}).get('pages') or []
        name = pages[0].get('pageimage') if pages and isinstance(pages[0], dict) else None
        return name if isinstance(name, str) and name else None

    def commons_file(self, file_name: str, deadline: float) -> CommonsFile | None:
        data = self._get_json(COMMONS_API_URL, {
            'action': 'query', 'format': 'json', 'formatversion': '2',
            'prop': 'imageinfo', 'iiprop': 'url|extmetadata', 'iiurlwidth': str(PHOTO_WIDTH),
            'iiextmetadatafilter': 'Artist|LicenseShortName', 'titles': f'File:{file_name}',
        }, deadline)
        pages = (data.get('query') or {}).get('pages') or []
        page = pages[0] if pages and isinstance(pages[0], dict) else {}
        info = (page.get('imageinfo') or [None])[0]
        if page.get('missing') or not isinstance(info, dict):
            return None
        thumb_url = info.get('thumburl') or info.get('url')
        source_url = info.get('descriptionurl')
        if not isinstance(thumb_url, str) or not isinstance(source_url, str):
            return None
        metadata = info.get('extmetadata') or {}
        credit = plain_text((metadata.get('Artist') or {}).get('value'))
        license_name = plain_text((metadata.get('LicenseShortName') or {}).get('value'))
        return CommonsFile(
            thumb_url=thumb_url,
            source_url=source_url,
            credit=credit[:255] if credit else None,
            license=license_name[:64] if license_name else None,
        )

    def download(self, url: str, deadline: float) -> bytes:
        if urlsplit(url).scheme != 'https' or urlsplit(url).hostname not in IMAGE_HOSTS:
            raise PhotoFetchError('Unexpected image host')
        return self._get(url, deadline)

    def _get_json(self, url: str, params: dict[str, str], deadline: float) -> dict:
        try:
            data = json.loads(self._get(f'{url}?{urlencode(params)}', deadline))
        except ValueError as exc:
            raise PhotoFetchError('Wikipedia answered with invalid JSON') from exc
        if not isinstance(data, dict):
            raise PhotoFetchError('Wikipedia answered with unexpected JSON')
        return data

    def _get(self, url: str, deadline: float) -> bytes:
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            raise PhotoFetchError('Out of time')
        request = Request(url, headers={'User-Agent': USER_AGENT})
        try:
            with urlopen(request, timeout=remaining) as response:  # noqa: S310 - fixed hosts
                chunks, size = [], 0
                while chunk := response.read(64 * 1024):
                    size += len(chunk)
                    if size > MAX_DOWNLOAD_BYTES or time.monotonic() > deadline:
                        raise PhotoFetchError('Too large or out of time')
                    chunks.append(chunk)
                return b''.join(chunks)
        except PhotoFetchError:
            raise
        except Exception as exc:  # timeouts, DNS, HTTP errors
            raise PhotoFetchError(type(exc).__name__) from exc


class PlacePhotoService:
    def __init__(
        self,
        db: Session,
        place_service: PlaceService,
        app_settings,
        client: WikipediaClient,
    ) -> None:
        self.db = db
        self.place_service = place_service
        self.app_settings = app_settings
        self.client = client

    def photo_for_location(self, location: Location) -> PlacePhoto | None:
        """The READY photo of the location's town, fetching it first if needed."""
        if not self._enabled():
            return None
        town = self.town_for(location)
        if town is None:
            return None
        row = self.db.get(PlacePhoto, town.id)
        if row is not None:
            if row.status == PlacePhotoStatus.READY.value:
                if place_photo_path(town.id).is_file():
                    return row
            elif row.status == PlacePhotoStatus.NONE.value:
                return None
            elif utcnow() - row.fetched_at < RETRY_FAILED_AFTER:
                return None
        return self._fetch(town)

    def town_for(self, location: Location) -> Place | None:
        """The place picked in search, or a nearby city for a map click.

        Locations are never changed for this: a stored town would make a hotel
        pin and its town look like the same point to the route checks.
        """
        if location.source_place_id is not None:
            place = self.db.get(Place, location.source_place_id)
            if place is None or place.population < PHOTO_MIN_POPULATION:
                return None
            return place
        return self.place_service.town_for_photo(
            location.latitude,
            location.longitude,
            min_population=PHOTO_MIN_POPULATION,
            max_distance_km=PHOTO_TOWN_RADIUS_KM,
        )

    def _enabled(self) -> bool:
        try:
            return bool(self.app_settings.get_value(PLACES_WIKIPEDIA_PHOTOS_KEY))
        except Exception:
            logger.warning('place_photos_setting_unreadable')
            return False

    def _fetch(self, town: Place) -> PlacePhoto | None:
        if not town.wikipedia_title:
            return self._save(town.id, PlacePhotoStatus.NONE)
        deadline = time.monotonic() + FETCH_BUDGET_SECONDS
        try:
            file_name = self.client.lead_image(town.wikipedia_title, deadline)
            if file_name is None:
                return self._save(town.id, PlacePhotoStatus.NONE)
            commons = self.client.commons_file(file_name, deadline)
            if commons is None:
                return self._save(town.id, PlacePhotoStatus.NONE)
            content = self.client.download(commons.thumb_url, deadline)
            self._store_image(town.id, content)
        except Exception as exc:
            logger.info('place_photo_fetch_failed place_id=%s reason=%s', town.id, type(exc).__name__)
            return self._save(town.id, PlacePhotoStatus.FAILED)
        return self._save(
            town.id,
            PlacePhotoStatus.READY,
            source_url=commons.source_url,
            credit=commons.credit,
            license=commons.license,
        )

    def _store_image(self, place_id: uuid.UUID, content: bytes) -> None:
        """Clean and resize like an upload thumbnail, then save as WebP."""
        with Image.open(BytesIO(content)) as image:
            if image.format not in {'JPEG', 'PNG', 'WEBP', 'GIF'}:
                raise PhotoFetchError('Unsupported image format')
        destination = place_photo_path(place_id)
        destination.parent.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(dir=destination.parent) as work:
            source = Path(work) / 'source'
            source.write_bytes(content)
            cleaned = Path(work) / 'clean.webp'
            generate_image_thumbnail(
                str(source), str(cleaned), max_size=(PHOTO_WIDTH, PHOTO_WIDTH * 2), quality=80
            )
            os.replace(cleaned, destination)

    def _save(self, place_id: uuid.UUID, status: PlacePhotoStatus, **fields) -> PlacePhoto | None:
        # Two people opening the same new town at once both fetch: harmless,
        # they write the same row and the same file.
        values = {
            'place_id': place_id,
            'status': status.value,
            'source_url': fields.get('source_url'),
            'credit': fields.get('credit'),
            'license': fields.get('license'),
            'fetched_at': utcnow(),
        }
        statement = insert(PlacePhoto).values(values)
        self.db.execute(
            statement.on_conflict_do_update(
                index_elements=['place_id'],
                set_={key: statement.excluded[key] for key in values if key != 'place_id'},
            )
        )
        self.db.commit()
        if status != PlacePhotoStatus.READY:
            return None
        row = self.db.get(PlacePhoto, place_id)
        if row is not None:
            self.db.refresh(row)
        return row

