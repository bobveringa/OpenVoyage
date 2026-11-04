"""Resolve the IANA time zone for a pair of coordinates.

Posts store the zone of where they happened (``posts.occurred_timezone``) so
clients can show the local clock time. The zone always comes from
timezonefinder's boundary data, never from GeoNames ``Place.timezone``: posts
can be placed on any point, not only on a known place.
"""

from __future__ import annotations

import threading
from functools import lru_cache
from typing import TYPE_CHECKING
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

# The ``posts.occurred_timezone`` backfill migration (01276188172b) has a
# frozen copy of ``resolve_timezone``; changes here don't affect it.

if TYPE_CHECKING:
    from timezonefinder import TimezoneFinder

_finder: TimezoneFinder | None = None
_finder_lock = threading.Lock()


def _get_finder() -> TimezoneFinder:
    """Return the shared finder, creating it on first use.

    Creating it loads the boundary data (a few milliseconds); lookups on the
    shared instance are cheap, so one per process is enough.
    """
    global _finder
    if _finder is None:
        with _finder_lock:
            if _finder is None:
                from timezonefinder import TimezoneFinder

                _finder = TimezoneFinder()
    return _finder


@lru_cache(maxsize=1024)
def _is_loadable(zone: str) -> bool:
    """Same check as ``place_service.valid_timezone``: can zoneinfo load it?"""
    try:
        ZoneInfo(zone)
    except ZoneInfoNotFoundError, ValueError:
        return False
    return True


def longitude_fallback_timezone(longitude: float) -> str:
    """Return the nautical ``Etc/GMT±N`` zone for a longitude.

    The ``Etc`` sign is inverted on purpose (POSIX style): ``Etc/GMT-9`` is
    UTC+9. Longitude 0 maps to ``Etc/GMT``.
    """
    offset_hours = max(-12, min(12, round(longitude / 15)))
    if offset_hours == 0:
        return 'Etc/GMT'
    # A positive (eastern) offset gets a minus sign in the Etc name.
    return f'Etc/GMT{-offset_hours:+d}'


def resolve_timezone(latitude: float, longitude: float) -> str:
    """Return the IANA time zone name at the given coordinates.

    Uses timezonefinder; where it has no zone, falls back to the nautical
    ``Etc/GMT±N`` zone for the longitude. The result is always a name that
    ``zoneinfo`` can load, never ``None``.
    """
    zone = _get_finder().timezone_at(lng=longitude, lat=latitude)
    if zone and _is_loadable(zone):
        return zone
    return longitude_fallback_timezone(longitude)
