"""Seed a complete demo trip: itinerary, posts with images, and GPS tracks.

The trip runs Lisbon -> Porto -> Madrid -> Barcelona -> Paris with two nights
per stop, anchored so that the Madrid -> Barcelona drive is in progress right
now: its tracking session is left open and its samples stop at the current
time, which is what drives the live-location view.

Everything is written through the public HTTP API against a running backend,
so the seeded data goes through the same validation, route generation, and
thumbnailing as real data.

Usage:
    python seed_demo_trip.py --instance URL --username USER --password PASS

The instance and credentials can also be supplied through
OPENVOYAGE_BASE_URL, SEED_LOGIN_USERNAME (or SEED_LOGIN_EMAIL), and
SEED_LOGIN_PASSWORD.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import random
import ssl
import sys
import tempfile
import time as time_module
import urllib.error
import urllib.parse
import urllib.request
import uuid
from dataclasses import dataclass, field
from datetime import date, datetime, time, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

REPO_ROOT = Path(__file__).resolve().parents[2]

TRIP_NAME = 'Iberian Summer: Lisbon to Paris'
TRIP_DESCRIPTION = (
    'Two nights in every city, from the Tagus to the Seine. Lisbon, Porto, '
    'Madrid, Barcelona and Paris, all of it by car.'
)

LISBON_TZ = ZoneInfo('Europe/Lisbon')
MADRID_TZ = ZoneInfo('Europe/Madrid')
PARIS_TZ = ZoneInfo('Europe/Paris')

# The itinerary is pinned to real dates so the trip reads as "in progress"
# rather than being relative to whenever the script happens to run.
ARRIVE_LISBON = date(2026, 8, 16)
ARRIVE_PORTO = date(2026, 8, 18)
ARRIVE_MADRID = date(2026, 8, 20)
ARRIVE_BARCELONA = date(2026, 8, 22)
ARRIVE_PARIS = date(2026, 8, 24)
TRIP_END = date(2026, 8, 26)

NIGHTS_PER_STOP = 2

# Sample cadence, in seconds, per kind of movement.
DRIVE_SAMPLE_SECONDS = 10
WALK_SAMPLE_SECONDS = 5

WALK_SPEED_MPS = 1.35
DRIVE_BREAK_MINUTES = 25
DRIVE_BREAK_THRESHOLD = timedelta(hours=4)

MAX_SAMPLES_PER_BATCH = 1000

# The free GraphHopper tier limits requests per minute, and the backend
# spends the same key on itinerary leg geometry while this script runs.
ROUTE_ATTEMPTS = 5

# Keeps the in-progress drive genuinely in progress no matter when the script
# runs: if the natural departure time would already have us arrived, the
# departure slides so we are this far along instead.
IN_PROGRESS_FRACTION = 0.6
MAX_NATURAL_PROGRESS = 0.85


@dataclass(frozen=True)
class Waypoint:
    latitude: float
    longitude: float


@dataclass(frozen=True)
class StopSpec:
    key: str
    query: str
    country_code: str
    title: str
    notes: str
    arrive: date
    timezone: ZoneInfo
    # Waypoint loops walked in this city, each a list of points routed on foot.
    walk_loops: tuple[tuple[Waypoint, ...], ...] = ()


@dataclass(frozen=True)
class PostSpec:
    """A post pinned to a moment on one of the city's walks.

    Posts are placed on the track rather than on the city centre, so each one
    carries the coordinate the walk had actually reached: `walk_fraction` is
    how far along that recording the post was written.
    """

    stop_key: str
    title: str
    body: str
    walk_index: int
    walk_fraction: float
    image_keys: tuple[str, ...]
    publish: bool = True


@dataclass(frozen=True)
class ResolvedStop:
    """A configured stop bound to the place row the backend resolved it to."""

    spec: StopSpec
    place_id: str
    latitude: float
    longitude: float


@dataclass
class GpsSession:
    """One continuous recording, already resolved to concrete samples."""

    session_id: str
    started_at: datetime
    ended_at: datetime | None
    samples: list[dict] = field(default_factory=list)


# ---------------------------------------------------------------------------
# Itinerary
# ---------------------------------------------------------------------------
LISBON_WALKS = (
    (
        Waypoint(38.7075, -9.1364),  # Praça do Comércio
        Waypoint(38.7113, -9.1393),  # Rua Augusta
        Waypoint(38.7139, -9.1394),  # Rossio
        Waypoint(38.7127, -9.1447),  # Bairro Alto
    ),
    (
        Waypoint(38.7099, -9.1330),  # Sé de Lisboa
        Waypoint(38.7118, -9.1300),  # Miradouro de Santa Luzia
        Waypoint(38.7139, -9.1335),  # Castelo de São Jorge
        Waypoint(38.7165, -9.1310),  # Graça
    ),
    (
        Waypoint(38.7060, -9.1450),  # Cais do Sodré
        Waypoint(38.7057, -9.1560),  # Santos
        Waypoint(38.7040, -9.1680),  # Alcântara, under the bridge
    ),
)

PORTO_WALKS = (
    (
        Waypoint(41.1408, -8.6132),  # Ribeira
        Waypoint(41.1401, -8.6094),  # Ponte Dom Luís I
        Waypoint(41.1379, -8.6112),  # Vila Nova de Gaia
    ),
    (
        Waypoint(41.1455, -8.6108),  # São Bento
        Waypoint(41.1470, -8.6148),  # Livraria Lello
        Waypoint(41.1456, -8.6146),  # Clérigos
        Waypoint(41.1442, -8.6116),  # Sé do Porto
    ),
    (
        Waypoint(41.1387, -8.6091),  # Jardim do Morro
        Waypoint(41.1372, -8.6127),  # Port cellars, Vila Nova de Gaia
        Waypoint(41.1385, -8.6150),  # Cais de Gaia
    ),
)

MADRID_WALKS = (
    (
        Waypoint(40.4169, -3.7033),  # Puerta del Sol
        Waypoint(40.4155, -3.7074),  # Plaza Mayor
        Waypoint(40.4180, -3.7143),  # Palacio Real
    ),
    (
        Waypoint(40.4153, -3.6845),  # Retiro
        Waypoint(40.4200, -3.6889),  # Puerta de Alcalá
        Waypoint(40.4193, -3.6934),  # Cibeles
    ),
    (
        Waypoint(40.4200, -3.7025),  # Gran Vía / Metrópolis
        Waypoint(40.4200, -3.7060),  # Callao
        Waypoint(40.4232, -3.7124),  # Plaza de España
    ),
)

STOPS: tuple[StopSpec, ...] = (
    StopSpec(
        key='lisbon',
        query='Lisbon',
        country_code='PT',
        title='Lisbon',
        notes='Two nights in Alfama. Tram 28 at least once.',
        arrive=ARRIVE_LISBON,
        timezone=LISBON_TZ,
        walk_loops=LISBON_WALKS,
    ),
    StopSpec(
        key='porto',
        query='Porto',
        country_code='PT',
        title='Porto',
        notes='Ribeira, port cellars across the river in Gaia.',
        arrive=ARRIVE_PORTO,
        timezone=LISBON_TZ,
        walk_loops=PORTO_WALKS,
    ),
    StopSpec(
        key='madrid',
        query='Madrid',
        country_code='ES',
        title='Madrid',
        notes='Long lunches, later dinners. Retiro in the morning.',
        arrive=ARRIVE_MADRID,
        timezone=MADRID_TZ,
        walk_loops=MADRID_WALKS,
    ),
    StopSpec(
        key='barcelona',
        query='Barcelona',
        country_code='ES',
        title='Barcelona',
        notes='Gothic quarter, and a beach afternoon if the weather holds.',
        arrive=ARRIVE_BARCELONA,
        timezone=MADRID_TZ,
    ),
    StopSpec(
        key='paris',
        query='Paris',
        country_code='FR',
        title='Paris',
        notes='Last two nights. Slow mornings, one museum, then home.',
        arrive=ARRIVE_PARIS,
        timezone=PARIS_TZ,
    ),
)

# ---------------------------------------------------------------------------
# Images
#
# Every URL below was downloaded and visually checked to be the city it is
# filed under, because Unsplash search results routinely include neighbouring
# towns (a Sintra palace filed under "Lisbon", for instance).
#
# The description on each entry is documentation only: the upload endpoint
# takes a file and nothing else, so there is nowhere to send a caption.
# ---------------------------------------------------------------------------
IMAGES: dict[str, tuple[str, str]] = {
    # key: (url, description)
    'lis-tram-baixa': (
        'https://images.unsplash.com/photo-1585208798174-6cedd86e019a',
        'Tram 28 working its way through Baixa',
    ),
    'lis-arch': (
        'https://images.unsplash.com/photo-1548707309-dcebeab9ea9b',
        'Praça do Comércio and the Rua Augusta arch',
    ),
    'lis-dusk': (
        'https://images.unsplash.com/photo-1525207934214-58e69a8f8a3e',
        'The city going amber from a miradouro',
    ),
    'lis-alfama-roofs': (
        'https://images.unsplash.com/photo-1536663815808-535e2280d2c2',
        'Alfama rooftops running down to the Tagus',
    ),
    'lis-alfama-wide': (
        'https://images.unsplash.com/photo-1501927023255-9063be98970c',
        'São Vicente over the terracotta',
    ),
    'lis-azulejo': (
        'https://images.unsplash.com/photo-1533421821268-87e42c1d70b0',
        'Tiled facade, Bica',
    ),
    'lis-bridge': (
        'https://images.unsplash.com/photo-1558102400-72da9fdbecae',
        'The 25 de Abril bridge with Cristo Rei behind it',
    ),
    'lis-bridge-close': (
        'https://images.unsplash.com/photo-1570487375454-0a83cfed8412',
        'Underneath the 25 de Abril',
    ),
    'lis-panorama': (
        'https://images.unsplash.com/photo-1608208291890-dcaf52dc98e1',
        'Castle hill at golden hour',
    ),
    'por-ribeira-boats': (
        'https://images.unsplash.com/photo-1555881400-74d7acaacd8b',
        'Rabelo boats moored along the Ribeira',
    ),
    'por-bridge-blue': (
        'https://images.unsplash.com/photo-1569959220744-ff553533f492',
        'Dom Luís I after sunset',
    ),
    'por-bridge-sunset': (
        'https://images.unsplash.com/photo-1513735492246-483525079686',
        'The Douro going pink',
    ),
    'por-ribeira-day': (
        'https://images.unsplash.com/photo-1555881400-69a2384edcd4',
        'Ribeira from the Gaia side',
    ),
    'por-aerial': (
        'https://images.unsplash.com/photo-1591028544607-57e17c55e8c9',
        'The old town wrapping around the river',
    ),
    'por-tiles-church': (
        'https://images.unsplash.com/photo-1614807254023-133d1a7a3c41',
        'Blue and white, floor to roofline',
    ),
    'por-tiles-street': (
        'https://images.unsplash.com/photo-1544121415-acc4ed3e785c',
        'Waiting to cross in front of a tiled wall',
    ),
    'por-tiles-carmo': (
        'https://images.unsplash.com/photo-1552338368-06c7d392fac6',
        'Igreja do Carmo, side elevation',
    ),
    'mad-granvia-dusk': (
        'https://images.unsplash.com/photo-1543783207-ec64e4d95325',
        'Gran Vía from above as the lights come on',
    ),
    'mad-metropolis': (
        'https://images.unsplash.com/photo-1645442684838-8d884644ffd5',
        'The Metrópolis building catching the last sun',
    ),
    'mad-granvia-sunset': (
        'https://images.unsplash.com/photo-1539037116277-4db20889f2d4',
        'Gran Vía, looking west',
    ),
    'mad-rooftops': (
        'https://images.unsplash.com/photo-1570698473651-b2de99bae12f',
        'Rooftops toward the Guadarrama',
    ),
    'mad-street': (
        'https://images.unsplash.com/photo-1558370781-d6196949e317',
        'A quiet street before the city wakes up',
    ),
    'mad-cibeles': (
        'https://images.unsplash.com/photo-1578305698944-874fa44d04c9',
        'Cibeles lit up on the last night',
    ),
    'mad-alcala': (
        'https://images.unsplash.com/photo-1518620121781-adab13a3d1ef',
        'Puerta de Alcalá',
    ),
    'mad-plaza-arch': (
        'https://images.unsplash.com/photo-1533403611115-5b62680b6318',
        'Through the arch into Plaza Mayor',
    ),
}

COVER_IMAGE_KEY = 'lis-panorama'

# ---------------------------------------------------------------------------
# Posts
# ---------------------------------------------------------------------------
POSTS: tuple[PostSpec, ...] = (
    PostSpec(
        stop_key='lisbon',
        title='Landing in Lisbon',
        body=(
            'Dropped the bags, walked straight back out. Praça do Comércio is '
            'the right way to meet this city: you come through the arch and '
            'the square just opens onto the river.\n\n'
            'We had a plan for dinner and abandoned it within the hour. Ended '
            'up eating standing at a counter in Baixa instead, which was '
            'better. Tram 28 went past three times while we were there, '
            'packed every time.'
        ),
        walk_index=0,
        walk_fraction=0.30,
        image_keys=('lis-arch', 'lis-tram-baixa', 'lis-dusk'),
    ),
    PostSpec(
        stop_key='lisbon',
        title='Alfama, uphill and downhill',
        body=(
            'Alfama has no straight lines and no flat bits. We gave up on the '
            'map somewhere behind the cathedral and just followed whichever '
            'lane looked most promising.\n\n'
            'Every fifth building is covered in azulejos, and the good ones '
            'are never the ones in the guidebook. Stopped at Santa Luzia to '
            'look at the roofs going down to the water.'
        ),
        walk_index=1,
        walk_fraction=0.65,
        image_keys=('lis-alfama-roofs', 'lis-alfama-wide', 'lis-azulejo'),
    ),
    PostSpec(
        stop_key='lisbon',
        title='Sunset over the Tagus',
        body=(
            'Last evening here. Walked the river west out of Cais do Sodré to '
            'see the 25 de Abril from underneath, which makes it feel about '
            'twice the size.\n\n'
            'Car is booked for the morning. Porto next, three hours up the A1.'
        ),
        walk_index=2,
        walk_fraction=0.75,
        image_keys=('lis-bridge', 'lis-bridge-close', 'lis-panorama'),
        publish=False,
    ),
    PostSpec(
        stop_key='porto',
        title='Three hours up the A1',
        body=(
            'Easy drive. Left Lisbon after breakfast, stopped once for coffee '
            'somewhere near Coimbra, and were parked in Porto by lunchtime.\n\n'
            'Porto is immediately a different place. Steeper, older, more '
            'weathered. Walked down to the Ribeira in the evening and watched '
            'the rabelo boats not going anywhere.'
        ),
        walk_index=0,
        walk_fraction=0.25,
        image_keys=('por-ribeira-boats', 'por-ribeira-day'),
    ),
    PostSpec(
        stop_key='porto',
        title='Blue walls everywhere',
        body=(
            'Spent the morning just looking at tiles. São Bento station is the '
            'famous one and it earns it, but the churches are where it gets '
            'properly excessive: entire facades, four storeys of it.\n\n'
            'Up past Lello afterwards, which we did not queue for, and round '
            'to the cathedral.'
        ),
        walk_index=1,
        walk_fraction=0.55,
        image_keys=('por-tiles-church', 'por-tiles-street', 'por-tiles-carmo'),
    ),
    PostSpec(
        stop_key='porto',
        title='Across the Dom Luís I',
        body=(
            'You can walk the top deck of the bridge, next to the metro. It is '
            'a long way down and there is not much between you and it.\n\n'
            'Worth it. The Gaia side has the better view back at Porto, and '
            'the port cellars are all lined up along the water. We did one '
            'tasting and bought a bottle we will absolutely not get home '
            'intact. Long drive tomorrow: Porto to Madrid is most of a day.'
        ),
        walk_index=2,
        walk_fraction=0.60,
        image_keys=('por-bridge-sunset', 'por-aerial', 'por-bridge-blue'),
    ),
    PostSpec(
        stop_key='madrid',
        title='Six hours to Madrid',
        body=(
            'Long one. Out of Porto early, across the border mid-morning, and '
            'then a lot of very empty, very hot Castilian nothing.\n\n'
            'Madrid at the other end was 34 degrees at seven in the evening '
            'and completely unbothered about it. Walked out to Plaza Mayor to '
            'find dinner. Nobody eats before ten; we tried, and were the only '
            'people in the restaurant.'
        ),
        walk_index=0,
        walk_fraction=0.35,
        image_keys=('mad-street', 'mad-rooftops', 'mad-plaza-arch'),
    ),
    PostSpec(
        stop_key='madrid',
        title='Morning in the Retiro',
        body=(
            'Out early, because by noon it is not worth it. The Retiro at nine '
            'is all runners and dogs and people setting up chairs by the '
            'boating lake.\n\n'
            'Walked out through the Puerta de Alcalá and down to Cibeles, then '
            'gave up and went indoors like everyone else with any sense.'
        ),
        walk_index=1,
        walk_fraction=0.45,
        image_keys=('mad-alcala', 'mad-cibeles'),
        publish=False,
    ),
    PostSpec(
        stop_key='madrid',
        title='Gran Vía at golden hour',
        body=(
            'Back out at half seven, when the light goes along Gran Vía and '
            'all that stone turns gold. The Metrópolis on the corner catches '
            'the last of it and looks unreasonable.\n\n'
            'Walked it end to end, up past Callao to Plaza de España. '
            'Barcelona in the morning, six hours east.'
        ),
        walk_index=2,
        walk_fraction=0.55,
        image_keys=('mad-granvia-sunset', 'mad-metropolis', 'mad-granvia-dusk'),
    ),
)

# Local departure times for the driven legs, keyed by the stop being left.
DEPARTURE_TIMES: dict[str, time] = {
    'lisbon': time(9, 0),
    'porto': time(8, 30),
    'madrid': time(8, 0),
}

# Local start times for the city walks, one per loop defined on the stop.
WALK_TIMES: dict[str, tuple[datetime, ...]] = {
    'lisbon': (
        datetime(2026, 8, 16, 18, 30),
        datetime(2026, 8, 17, 10, 15),
        datetime(2026, 8, 17, 19, 15),
    ),
    'porto': (
        datetime(2026, 8, 18, 17, 45),
        datetime(2026, 8, 19, 10, 30),
        datetime(2026, 8, 19, 15, 30),
    ),
    'madrid': (
        datetime(2026, 8, 20, 19, 30),
        datetime(2026, 8, 21, 10, 30),
        datetime(2026, 8, 21, 19, 30),
    ),
}


class SeedError(RuntimeError):
    """Raised when the seed cannot proceed."""


# ---------------------------------------------------------------------------
# Environment
# ---------------------------------------------------------------------------
def load_dotenv(path: Path) -> None:
    """Populate os.environ from a .env file without overriding real env vars."""
    if not path.is_file():
        return
    for raw_line in path.read_text(encoding='utf-8').splitlines():
        line = raw_line.strip()
        if not line or line.startswith('#') or '=' not in line:
            continue
        key, _, value = line.partition('=')
        os.environ.setdefault(key.strip(), value.strip())


def require_env(*names: str) -> str:
    for name in names:
        value = os.environ.get(name, '').strip()
        if value:
            return value
    raise SeedError(f'Set one of: {", ".join(names)}')


# ---------------------------------------------------------------------------
# HTTP
# ---------------------------------------------------------------------------
class ApiClient:
    """Minimal JSON client for the OpenVoyage API."""

    def __init__(self, base_url: str, *, verify_ssl: bool = True) -> None:
        self.base_url = base_url.rstrip('/')
        self.token: str | None = None
        self.last_headers: dict[str, str] = {}
        self.ssl_context = None
        if not verify_ssl:
            self.ssl_context = ssl._create_unverified_context()

    def login(self, username: str, password: str) -> None:
        body = urllib.parse.urlencode(
            {'username': username, 'password': password}
        ).encode()
        payload = self._send(
            'POST',
            '/api/v1/login/access-token',
            body=body,
            content_type='application/x-www-form-urlencoded',
            authenticated=False,
        )
        token = payload.get('access_token') if isinstance(payload, dict) else None
        if not token:
            raise SeedError('Login succeeded but returned no access token')
        self.token = token

    def get(self, path: str, **query: object) -> object:
        if query:
            filtered = {k: v for k, v in query.items() if v is not None}
            path = f'{path}?{urllib.parse.urlencode(filtered)}'
        return self._send('GET', path)

    def post(
        self,
        path: str,
        payload: object = None,
        headers: dict[str, str] | None = None,
    ) -> object:
        return self._send(
            'POST',
            path,
            body=json.dumps(payload).encode() if payload is not None else b'',
            content_type='application/json',
            headers=headers,
        )

    def patch(self, path: str, payload: object) -> object:
        return self._send(
            'PATCH',
            path,
            body=json.dumps(payload).encode(),
            content_type='application/json',
        )

    def put(self, path: str, payload: object) -> object:
        return self._send(
            'PUT',
            path,
            body=json.dumps(payload).encode(),
            content_type='application/json',
        )

    def delete(self, path: str) -> object:
        return self._send('DELETE', path)

    def upload_image(self, path: str, filename: str, data: bytes) -> object:
        boundary = f'----openvoyage{uuid.uuid4().hex}'
        disposition = (
            f'Content-Disposition: form-data; name="file"; filename="{filename}"'
        )
        body = b''.join(
            (
                f'--{boundary}\r\n'.encode(),
                f'{disposition}\r\n'.encode(),
                b'Content-Type: image/jpeg\r\n\r\n',
                data,
                f'\r\n--{boundary}--\r\n'.encode(),
            )
        )
        return self._send(
            'POST',
            path,
            body=body,
            content_type=f'multipart/form-data; boundary={boundary}',
        )

    def _send(
        self,
        method: str,
        path: str,
        *,
        body: bytes | None = None,
        content_type: str | None = None,
        headers: dict[str, str] | None = None,
        authenticated: bool = True,
    ) -> object:
        request = urllib.request.Request(f'{self.base_url}{path}', data=body)
        request.get_method = lambda: method
        request.add_header('Accept', 'application/json')
        if content_type:
            request.add_header('Content-Type', content_type)
        if authenticated and self.token:
            request.add_header('Authorization', f'Bearer {self.token}')
        for key, value in (headers or {}).items():
            request.add_header(key, value)

        try:
            with urllib.request.urlopen(
                request,
                timeout=180,
                context=self.ssl_context,
            ) as response:
                raw = response.read()
                self.last_headers = dict(response.headers)
                if not raw:
                    return None
                try:
                    return json.loads(raw.decode('utf-8'))
                except (UnicodeDecodeError, json.JSONDecodeError) as exc:
                    content_type = response.headers.get(
                        'Content-Type',
                        'unknown',
                    )
                    preview = raw.decode('utf-8', errors='replace').strip()
                    preview = ' '.join(preview.split())[:400] or '<whitespace>'
                    raise SeedError(
                        f'{method} {path} expected a JSON response, but '
                        f'{response.geturl()} returned {content_type}: {preview}'
                    ) from exc
        except urllib.error.HTTPError as exc:
            detail = exc.read().decode('utf-8', errors='replace')[:600]
            raise SeedError(
                f'{method} {path} failed with HTTP {exc.code}: {detail}'
            ) from exc
        except urllib.error.URLError as exc:
            raise SeedError(
                f'{method} {path} could not reach the server: {exc.reason}'
            ) from exc


def download(url: str) -> bytes:
    request = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
    with urllib.request.urlopen(request, timeout=180) as response:
        return response.read()


# ---------------------------------------------------------------------------
# Routing
# ---------------------------------------------------------------------------
@dataclass(frozen=True)
class RoutedPath:
    """A road-following path plus the provider's own distance and duration."""

    points: list[tuple[float, float]]
    distance_meters: float
    duration_seconds: float


class GraphHopper:
    """Routing client that survives the free tier's minutely request limit.

    Routes are cached on disk between runs. The backend spends the same key
    generating itinerary leg geometry, so a re-run that had to fetch every
    route again would trip the limit before it finished.
    """

    def __init__(self, api_key: str, base_url: str) -> None:
        self.api_key = api_key
        self.base_url = base_url.rstrip('/')
        self._cache: dict[str, RoutedPath] = {}
        self._cache_path = Path(tempfile.gettempdir()) / 'openvoyage-seed-routes.json'
        self._disk_cache = self._load_disk_cache()

    def route(self, points: list[Waypoint], profile: str) -> RoutedPath:
        coordinates = tuple((point.latitude, point.longitude) for point in points)
        cache_key = hashlib.sha256(
            json.dumps([profile, coordinates]).encode()
        ).hexdigest()

        cached = self._cache.get(cache_key)
        if cached is not None:
            return cached

        stored = self._disk_cache.get(cache_key)
        if stored is not None:
            routed = RoutedPath(
                points=[(float(lat), float(lon)) for lat, lon in stored['points']],
                distance_meters=float(stored['distance_meters']),
                duration_seconds=float(stored['duration_seconds']),
            )
            self._cache[cache_key] = routed
            return routed

        routed = self._fetch(points, profile)
        self._cache[cache_key] = routed
        self._disk_cache[cache_key] = {
            'points': routed.points,
            'distance_meters': routed.distance_meters,
            'duration_seconds': routed.duration_seconds,
        }
        self._save_disk_cache()
        return routed

    def _fetch(self, points: list[Waypoint], profile: str) -> RoutedPath:
        query: list[tuple[str, str]] = [
            ('point', f'{point.latitude},{point.longitude}') for point in points
        ]
        query.extend(
            (
                ('vehicle', profile),
                ('points_encoded', 'false'),
                ('key', self.api_key),
            )
        )
        url = f'{self.base_url}/route?{urllib.parse.urlencode(query)}'
        request = urllib.request.Request(
            url,
            headers={'User-Agent': 'openvoyage-seed'},
        )

        payload: dict | None = None
        for attempt in range(1, ROUTE_ATTEMPTS + 1):
            try:
                with urllib.request.urlopen(request, timeout=60) as response:
                    payload = json.loads(response.read().decode('utf-8'))
                break
            except urllib.error.HTTPError as exc:
                detail = exc.read().decode('utf-8', errors='replace')[:400]
                if exc.code != 429 or attempt == ROUTE_ATTEMPTS:
                    raise SeedError(
                        f'GraphHopper {profile} route failed '
                        f'(HTTP {exc.code}): {detail}'
                    ) from exc

                wait = self._retry_delay(exc, attempt)
                print(f'  rate limited by GraphHopper, retrying in {wait}s')
                time_module.sleep(wait)

        if payload is None:
            raise SeedError(f'GraphHopper {profile} route returned no payload')

        paths = payload.get('paths') or []
        if not paths:
            raise SeedError(f'GraphHopper returned no {profile} path')

        path = paths[0]
        coordinates = path['points']['coordinates']
        if len(coordinates) < 2:
            raise SeedError(f'GraphHopper {profile} path has too few points')

        return RoutedPath(
            points=[(float(lat), float(lon)) for lon, lat in coordinates],
            distance_meters=float(path.get('distance', 0.0)),
            duration_seconds=float(path.get('time', 0)) / 1000.0,
        )

    @staticmethod
    def _retry_delay(exc: urllib.error.HTTPError, attempt: int) -> int:
        """Prefer GraphHopper's own reset hint over a blind backoff."""
        for header in ('X-RateLimit-Reset', 'Retry-After'):
            raw = exc.headers.get(header) if exc.headers else None
            if raw and raw.strip().isdigit():
                return max(1, min(180, int(raw.strip()) + 2))
        return min(120, 15 * 2 ** (attempt - 1))

    def _load_disk_cache(self) -> dict[str, dict]:
        if not self._cache_path.is_file():
            return {}
        try:
            return json.loads(self._cache_path.read_text(encoding='utf-8'))
        except OSError, ValueError:
            return {}

    def _save_disk_cache(self) -> None:
        try:
            self._cache_path.write_text(
                json.dumps(self._disk_cache),
                encoding='utf-8',
            )
        except OSError:
            pass


# ---------------------------------------------------------------------------
# Geometry
# ---------------------------------------------------------------------------
EARTH_RADIUS_M = 6_371_000.0
METERS_PER_DEGREE_LAT = 111_320.0


def haversine_meters(
    first: tuple[float, float],
    second: tuple[float, float],
) -> float:
    lat1, lon1 = math.radians(first[0]), math.radians(first[1])
    lat2, lon2 = math.radians(second[0]), math.radians(second[1])
    delta_lat = lat2 - lat1
    delta_lon = lon2 - lon1
    a = (
        math.sin(delta_lat / 2) ** 2
        + math.cos(lat1) * math.cos(lat2) * math.sin(delta_lon / 2) ** 2
    )
    return 2 * EARTH_RADIUS_M * math.asin(math.sqrt(a))


def bearing_degrees(
    first: tuple[float, float],
    second: tuple[float, float],
) -> float:
    lat1, lat2 = math.radians(first[0]), math.radians(second[0])
    delta_lon = math.radians(second[1] - first[1])
    y = math.sin(delta_lon) * math.cos(lat2)
    x = math.cos(lat1) * math.sin(lat2) - math.sin(lat1) * math.cos(lat2) * math.cos(
        delta_lon
    )
    return (math.degrees(math.atan2(y, x)) + 360.0) % 360.0


def cumulative_distances(points: list[tuple[float, float]]) -> list[float]:
    totals = [0.0]
    for index in range(1, len(points)):
        totals.append(totals[-1] + haversine_meters(points[index - 1], points[index]))
    return totals


def interpolate(
    points: list[tuple[float, float]],
    totals: list[float],
    target: float,
) -> tuple[float, float, float]:
    """Return (latitude, longitude, heading) at `target` metres along a path."""
    if target <= 0:
        return points[0][0], points[0][1], bearing_degrees(points[0], points[1])
    if target >= totals[-1]:
        return points[-1][0], points[-1][1], bearing_degrees(points[-2], points[-1])

    low, high = 0, len(totals) - 1
    while low < high - 1:
        middle = (low + high) // 2
        if totals[middle] <= target:
            low = middle
        else:
            high = middle

    span = totals[high] - totals[low]
    ratio = 0.0 if span <= 0 else (target - totals[low]) / span
    start, end = points[low], points[high]
    return (
        start[0] + (end[0] - start[0]) * ratio,
        start[1] + (end[1] - start[1]) * ratio,
        bearing_degrees(start, end),
    )


def jitter_coordinate(
    latitude: float,
    longitude: float,
    metres: float,
    rng: random.Random,
) -> tuple[float, float]:
    """Offset a coordinate by up to `metres` in a random direction."""
    distance = rng.uniform(0, metres)
    angle = rng.uniform(0, 2 * math.pi)
    delta_lat = (distance * math.cos(angle)) / METERS_PER_DEGREE_LAT
    scale = math.cos(math.radians(latitude)) or 1e-6
    delta_lon = (distance * math.sin(angle)) / (METERS_PER_DEGREE_LAT * scale)
    return latitude + delta_lat, longitude + delta_lon


# ---------------------------------------------------------------------------
# Track synthesis
# ---------------------------------------------------------------------------
def build_movement_plan(
    *,
    total_distance: float,
    moving_seconds: float,
    sample_seconds: int,
    rng: random.Random,
    break_after_fraction: float | None = None,
    break_seconds: float = 0.0,
) -> list[tuple[float, float, bool]]:
    """Plan (elapsed, distance travelled, stationary) triples for one recording.

    Distance advances by a smoothly drifting weight rather than a constant
    step, so the resulting speeds vary the way a real drive does instead of
    pinning to a single average.
    """
    steps = max(2, int(moving_seconds // sample_seconds))
    weights: list[float] = []
    weight = 1.0
    for _ in range(steps):
        weight = min(1.5, max(0.55, weight * math.exp(rng.gauss(0.0, 0.09))))
        weights.append(weight)

    total_weight = sum(weights)
    plan: list[tuple[float, float, bool]] = []
    elapsed = 0.0
    travelled = 0.0
    break_done = break_after_fraction is None

    for weight in weights:
        travelled += total_distance * (weight / total_weight)
        elapsed += sample_seconds
        plan.append((elapsed, travelled, False))

        if not break_done and travelled >= total_distance * break_after_fraction:
            break_done = True
            for _ in range(int(break_seconds // sample_seconds)):
                elapsed += sample_seconds
                plan.append((elapsed, travelled, True))

    return plan


def build_samples(
    *,
    routed: RoutedPath,
    plan: list[tuple[float, float, bool]],
    started_at: datetime,
    travel_mode: str,
    sample_seconds: int,
    jitter_metres: float,
    accuracy_range: tuple[float, float],
    altitude_base: float,
    rng: random.Random,
    not_after: datetime | None = None,
) -> list[dict]:
    points = routed.points
    totals = cumulative_distances(points)
    path_length = totals[-1]

    samples: list[dict] = []
    previous_distance = 0.0
    previous_heading = bearing_degrees(points[0], points[1])

    for elapsed, travelled, stationary in plan:
        recorded_at = started_at + timedelta(seconds=elapsed)
        if not_after is not None and recorded_at > not_after:
            break

        target = min(travelled, path_length)
        latitude, longitude, heading = interpolate(points, totals, target)
        if stationary:
            speed = rng.uniform(0.0, 0.3)
        else:
            speed = max(0.0, (travelled - previous_distance) / sample_seconds)
            previous_heading = heading
        previous_distance = travelled

        jittered_lat, jittered_lon = jitter_coordinate(
            latitude,
            longitude,
            jitter_metres,
            rng,
        )
        samples.append(
            {
                'id': str(uuid.uuid4()),
                'recorded_at': recorded_at.isoformat(),
                'latitude': round(jittered_lat, 6),
                'longitude': round(jittered_lon, 6),
                'accuracy_meters': round(rng.uniform(*accuracy_range), 1),
                'speed_mps': round(speed, 2),
                'heading_degrees': round(previous_heading, 1),
                'altitude_meters': round(altitude_base + rng.uniform(-12, 12), 2),
                'travel_mode': travel_mode,
            }
        )

    return samples


def local_to_utc(naive_local: datetime, zone: ZoneInfo) -> datetime:
    return naive_local.replace(tzinfo=zone).astimezone(timezone.utc)


def build_drive_session(
    *,
    routed: RoutedPath,
    departure_utc: datetime,
    rng: random.Random,
    not_after: datetime | None = None,
) -> GpsSession:
    """One driven leg, with a rest stop inserted on the long ones."""
    moving_seconds = routed.duration_seconds
    takes_a_break = timedelta(seconds=moving_seconds) >= DRIVE_BREAK_THRESHOLD
    break_seconds = DRIVE_BREAK_MINUTES * 60 if takes_a_break else 0.0

    plan = build_movement_plan(
        total_distance=cumulative_distances(routed.points)[-1],
        moving_seconds=moving_seconds,
        sample_seconds=DRIVE_SAMPLE_SECONDS,
        rng=rng,
        break_after_fraction=0.55 if takes_a_break else None,
        break_seconds=break_seconds,
    )
    samples = build_samples(
        routed=routed,
        plan=plan,
        started_at=departure_utc,
        travel_mode='CAR',
        sample_seconds=DRIVE_SAMPLE_SECONDS,
        jitter_metres=5.0,
        accuracy_range=(4.0, 12.0),
        altitude_base=180.0,
        rng=rng,
        not_after=not_after,
    )
    if not samples:
        raise SeedError('Drive produced no samples')

    last_recorded = datetime.fromisoformat(samples[-1]['recorded_at'])
    ended_at = None if not_after is not None else last_recorded
    return GpsSession(
        session_id=str(uuid.uuid4()),
        started_at=departure_utc,
        ended_at=ended_at,
        samples=samples,
    )


def build_walk_session(
    *,
    routed: RoutedPath,
    started_utc: datetime,
    rng: random.Random,
) -> GpsSession:
    """A city walk, timed from its own length rather than a fixed duration."""
    path_length = cumulative_distances(routed.points)[-1]
    moving_seconds = path_length / WALK_SPEED_MPS

    plan = build_movement_plan(
        total_distance=path_length,
        moving_seconds=moving_seconds,
        sample_seconds=WALK_SAMPLE_SECONDS,
        rng=rng,
    )
    samples = build_samples(
        routed=routed,
        plan=plan,
        started_at=started_utc,
        travel_mode='WALK',
        sample_seconds=WALK_SAMPLE_SECONDS,
        jitter_metres=8.0,
        accuracy_range=(5.0, 18.0),
        altitude_base=45.0,
        rng=rng,
    )
    if not samples:
        raise SeedError('Walk produced no samples')

    return GpsSession(
        session_id=str(uuid.uuid4()),
        started_at=started_utc,
        ended_at=datetime.fromisoformat(samples[-1]['recorded_at']),
        samples=samples,
    )


# ---------------------------------------------------------------------------
# Seeding steps
# ---------------------------------------------------------------------------
def resolve_stops(client: ApiClient) -> dict[str, ResolvedStop]:
    resolved: dict[str, ResolvedStop] = {}
    for spec in STOPS:
        matches = client.get(
            '/api/v1/places/geocode',
            query=spec.query,
            country_code=spec.country_code,
            limit=10,
        )
        if not isinstance(matches, list) or not matches:
            raise SeedError(f'No place found for {spec.query} ({spec.country_code})')

        # GeoNames carries several same-name places per country; the populated
        # city is always the largest of them.
        best = max(matches, key=lambda place: place.get('population') or 0)
        resolved[spec.key] = ResolvedStop(
            spec=spec,
            place_id=best['id'],
            latitude=float(best['latitude']),
            longitude=float(best['longitude']),
        )
        print(f'  resolved {spec.title} -> {best["full_name"]}')
    return resolved


def find_existing_trip(client: ApiClient) -> str | None:
    payload = client.get('/api/v1/trips', page_size=100)
    items = payload.get('items', []) if isinstance(payload, dict) else []
    for trip in items:
        if trip.get('name') == TRIP_NAME:
            return trip['id']
    return None


def upload_images(client: ApiClient, keys: list[str]) -> dict[str, str]:
    """Upload each distinct image once and return key -> media id."""
    media_ids: dict[str, str] = {}
    for index, key in enumerate(keys, start=1):
        url, _ = IMAGES[key]
        data = download(f'{url}?w=1600&q=80&fm=jpg&fit=max')
        response = client.upload_image('/api/v1/media', f'{key}.jpg', data)
        media_ids[key] = response['id']
        print(f'  [{index}/{len(keys)}] {key} ({len(data) // 1024} KB)')
    return media_ids


def create_itinerary(
    client: ApiClient,
    trip_id: str,
    stops: dict[str, ResolvedStop],
) -> int:
    revision = 0
    previous_stop_id: str | None = None

    for spec in STOPS:
        stop = stops[spec.key]
        payload: dict[str, object] = {
            'location': {'place_id': stop.place_id},
            'title': spec.title,
            'notes': spec.notes,
            'planned_nights': NIGHTS_PER_STOP,
            # after_stop_id only orders stops that share a date. Every stop
            # here has its own date, so the ordering falls out of the dates
            # and the anchor has to stay null.
            'placement': {
                'planned_start_date': spec.arrive.isoformat(),
                'after_stop_id': None,
            },
        }
        if previous_stop_id is not None:
            payload['incoming_travel'] = {
                'travel_mode': 'CAR',
                'notes': '',
                'operator': None,
                'reference': None,
            }

        response = client.post(
            f'/api/v1/trips/{trip_id}/itinerary/stops',
            payload,
            headers={'If-Match': f'"{revision}"'},
        )
        revision = response['itinerary_revision']

        created = next(
            (
                item
                for item in response['stops']
                if item['planned_start_date'] == spec.arrive.isoformat()
            ),
            None,
        )
        if created is None:
            raise SeedError(f'Stop for {spec.title} was not returned by the API')

        previous_stop_id = created['id']
        print(f'  {spec.title}: {spec.arrive} + {NIGHTS_PER_STOP} nights')

    return revision


def create_posts(
    client: ApiClient,
    trip_id: str,
    media_ids: dict[str, str],
    walks: dict[tuple[str, int], GpsSession],
) -> tuple[int, int]:
    """Create every post at the point on its walk where it was written.

    The coordinate comes straight off the track, so the backend reverse
    geocodes it to the neighbourhood the walk was in rather than filing every
    post at the same city centre.
    """
    published = 0
    drafts = 0

    for spec in POSTS:
        session = walks.get((spec.stop_key, spec.walk_index))
        if session is None or not session.samples:
            raise SeedError(
                f'No walk {spec.walk_index} recorded in {spec.stop_key} '
                f'for post {spec.title!r}'
            )

        last_index = len(session.samples) - 1
        sample = session.samples[round(spec.walk_fraction * last_index)]
        response = client.post(
            f'/api/v1/trips/{trip_id}/posts',
            {
                'title': spec.title,
                'body': spec.body,
                'location': {
                    'latitude': sample['latitude'],
                    'longitude': sample['longitude'],
                },
                'occurred_at': sample['recorded_at'],
                'media_ids': [media_ids[key] for key in spec.image_keys],
                'publish': spec.publish,
            },
        )

        if spec.publish:
            published += 1
        else:
            drafts += 1
        state = 'published' if spec.publish else 'draft'
        print(
            f'  {spec.title} ({state}, {len(spec.image_keys)} images) '
            f'@ {response["location"]["full_name"]}'
        )

    return published, drafts


def drive_total_seconds(routed: RoutedPath) -> float:
    """Wall-clock length of a driven leg, rest stop included."""
    moving = routed.duration_seconds
    if timedelta(seconds=moving) >= DRIVE_BREAK_THRESHOLD:
        return moving + DRIVE_BREAK_MINUTES * 60
    return moving


def build_sessions(
    stops: dict[str, ResolvedStop],
    hopper: GraphHopper,
    rng: random.Random,
    now: datetime,
) -> tuple[list[GpsSession], dict[tuple[str, int], GpsSession]]:
    """Assemble every recording for the trip, in chronological order.

    Returns the sessions plus a lookup of the city walks by (stop, index),
    which is what lets each post be pinned to a point on its own walk.
    """
    sessions: list[GpsSession] = []
    walks: dict[tuple[str, int], GpsSession] = {}

    def city_walks(stop_key: str) -> None:
        stop = stops[stop_key]
        for index, (loop, start_local) in enumerate(
            zip(stop.spec.walk_loops, WALK_TIMES[stop_key], strict=True)
        ):
            # Walk the loop out and back so it returns to where it started.
            waypoints = [*loop, loop[0]]
            routed = hopper.route(list(waypoints), 'foot')
            session = build_walk_session(
                routed=routed,
                started_utc=local_to_utc(start_local, stop.spec.timezone),
                rng=rng,
            )
            sessions.append(session)
            walks[(stop_key, index)] = session
            minutes = int((session.ended_at - session.started_at).total_seconds() // 60)
            print(
                f'  walk in {stop.spec.title}: '
                f'{len(session.samples)} samples over {minutes} min'
            )

    def drive(from_key: str, to_key: str, *, in_progress: bool = False) -> None:
        origin, destination = stops[from_key], stops[to_key]
        routed = hopper.route(
            [
                Waypoint(origin.latitude, origin.longitude),
                Waypoint(destination.latitude, destination.longitude),
            ],
            'car',
        )
        natural_departure = local_to_utc(
            datetime.combine(
                destination.spec.arrive,
                DEPARTURE_TIMES[from_key],
            ),
            origin.spec.timezone,
        )

        not_after = None
        departure = natural_departure
        if in_progress:
            not_after = now
            total_seconds = drive_total_seconds(routed)
            elapsed = (now - natural_departure).total_seconds()
            if not 0 < elapsed < MAX_NATURAL_PROGRESS * total_seconds:
                # Departing at the planned hour would put us past Barcelona
                # already, so slide the departure to keep the drive live.
                departure = now - timedelta(
                    seconds=IN_PROGRESS_FRACTION * total_seconds
                )

        session = build_drive_session(
            routed=routed,
            departure_utc=departure,
            rng=rng,
            not_after=not_after,
        )
        sessions.append(session)

        kilometres = int(routed.distance_meters // 1000)
        state = 'in progress, session left open' if in_progress else 'complete'
        print(
            f'  drive {origin.spec.title} -> {destination.spec.title}: '
            f'{len(session.samples)} samples, {kilometres} km ({state})'
        )

    city_walks('lisbon')
    drive('lisbon', 'porto')
    city_walks('porto')
    drive('porto', 'madrid')
    city_walks('madrid')
    drive('madrid', 'barcelona', in_progress=True)

    assert_no_overlap(sessions)
    return sessions, walks


def assert_no_overlap(sessions: list[GpsSession]) -> None:
    """The API rejects overlapping sessions, so catch it before uploading."""
    ordered = sorted(sessions, key=lambda session: session.started_at)
    for earlier, later in zip(ordered, ordered[1:], strict=False):
        earlier_end = earlier.ended_at
        if earlier_end is None and earlier.samples:
            earlier_end = datetime.fromisoformat(earlier.samples[-1]['recorded_at'])
        if earlier_end is not None and earlier_end >= later.started_at:
            raise SeedError(
                'Tracking sessions overlap: '
                f'{earlier.started_at.isoformat()} ends after '
                f'{later.started_at.isoformat()} begins'
            )


def upload_sessions(
    client: ApiClient,
    trip_id: str,
    sessions: list[GpsSession],
) -> int:
    total_accepted = 0

    for session in sessions:
        payload: dict[str, object] = {'started_at': session.started_at.isoformat()}
        if session.ended_at is not None:
            payload['ended_at'] = session.ended_at.isoformat()
        client.post(
            f'/api/v1/trips/{trip_id}/tracking/sessions/{session.session_id}',
            payload,
        )

        accepted = 0
        for start in range(0, len(session.samples), MAX_SAMPLES_PER_BATCH):
            batch = session.samples[start : start + MAX_SAMPLES_PER_BATCH]
            result = client.post(
                f'/api/v1/trips/{trip_id}/tracking/sessions/'
                f'{session.session_id}/samples/batch',
                {'samples': batch},
            )
            accepted += result['accepted_samples']
            if result['discarded_samples']:
                print(
                    f'    warning: {result["discarded_samples"]} samples '
                    'were discarded as out of session bounds'
                )

        total_accepted += accepted
        print(f'  session {session.session_id[:8]}: {accepted} samples stored')

    return total_accepted


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------
def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        '--force',
        action='store_true',
        help='delete an existing trip with the same name before seeding',
    )
    parser.add_argument(
        '--instance',
        '--base-url',
        dest='instance',
        default=None,
        metavar='URL',
        help=(
            'OpenVoyage instance API base URL '
            '(default: OPENVOYAGE_BASE_URL or http://localhost:8000); '
            '--base-url is retained as an alias'
        ),
    )
    parser.add_argument(
        '--username',
        default=None,
        help=(
            'username used to sign in (default: SEED_LOGIN_USERNAME, '
            'SEED_LOGIN_EMAIL, or E2E_LOGIN_EMAIL)'
        ),
    )
    parser.add_argument(
        '--password',
        default=None,
        help=(
            'password used to sign in '
            '(default: SEED_LOGIN_PASSWORD or E2E_LOGIN_PASSWORD)'
        ),
    )
    parser.add_argument(
        '--insecure',
        action='store_true',
        help='disable TLS certificate verification for instance API requests',
    )
    parser.add_argument(
        '--seed',
        type=int,
        default=20260822,
        help='random seed for the generated GPS noise',
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    load_dotenv(REPO_ROOT / '.env')

    base_url = (
        args.instance
        or os.environ.get('OPENVOYAGE_BASE_URL', '').strip()
        or 'http://localhost:8000'
    )
    username = (
        args.username
        if args.username is not None
        else require_env(
            'SEED_LOGIN_USERNAME',
            'SEED_LOGIN_EMAIL',
            'E2E_LOGIN_EMAIL',
        )
    )
    password = (
        args.password
        if args.password is not None
        else require_env(
            'SEED_LOGIN_PASSWORD',
            'E2E_LOGIN_PASSWORD',
        )
    )
    graphhopper_key = require_env('GRAPHHOPPER_API_KEY')
    graphhopper_url = (
        os.environ.get('GRAPHHOPPER_BASE_URL', '').strip()
        or 'https://graphhopper.com/api/1'
    )

    rng = random.Random(args.seed)
    hopper = GraphHopper(graphhopper_key, graphhopper_url)
    client = ApiClient(base_url, verify_ssl=not args.insecure)
    now = datetime.now(timezone.utc)

    if args.insecure:
        print('Warning: TLS certificate verification is disabled')
    print(f'Signing in to {base_url} as {username}')
    client.login(username, password)

    existing = find_existing_trip(client)
    if existing is not None:
        if not args.force:
            raise SeedError(
                f'A trip named {TRIP_NAME!r} already exists ({existing}). '
                'Re-run with --force to replace it.'
            )
        print(f'Deleting existing trip {existing}')
        client.delete(f'/api/v1/trips/{existing}')

    print('Resolving places')
    stops = resolve_stops(client)

    print('Uploading images')
    image_keys = [COVER_IMAGE_KEY]
    for spec in POSTS:
        for key in spec.image_keys:
            if key not in image_keys:
                image_keys.append(key)
    media_ids = upload_images(client, image_keys)

    print('Creating trip')
    trip = client.post(
        '/api/v1/trips',
        {
            'name': TRIP_NAME,
            'description': TRIP_DESCRIPTION,
            'media_id': media_ids[COVER_IMAGE_KEY],
            'visibility': 'PUBLIC',
            'start_date': ARRIVE_LISBON.isoformat(),
            'end_date': TRIP_END.isoformat(),
        },
    )
    trip_id = trip['id']
    print(f'  {trip_id}')

    client.put(
        f'/api/v1/trips/{trip_id}/live-location-settings',
        {'share_live_location': True},
    )

    print('Building itinerary')
    create_itinerary(client, trip_id, stops)

    print('Generating GPS tracks')
    sessions, walks = build_sessions(stops, hopper, rng, now)

    print('Uploading GPS tracks')
    accepted = upload_sessions(client, trip_id, sessions)

    print('Creating posts')
    published, drafts = create_posts(client, trip_id, media_ids, walks)

    print()
    print(f'Seeded {TRIP_NAME!r}')
    print(f'  trip id     {trip_id}')
    print(f'  stops       {len(STOPS)} ({NIGHTS_PER_STOP} nights each)')
    print(f'  posts       {published} published, {drafts} drafts')
    print(f'  images      {len(media_ids)}')
    print(f'  gps         {accepted} samples across {len(sessions)} sessions')
    print(f'  open now    {base_url}/trips/{trip_id}')
    return 0


if __name__ == '__main__':
    try:
        sys.exit(main())
    except SeedError as error:
        print(f'error: {error}', file=sys.stderr)
        sys.exit(1)
