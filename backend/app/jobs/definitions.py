from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from datetime import timedelta
from enum import Enum
from typing import TYPE_CHECKING

from sqlalchemy.orm import Session

if TYPE_CHECKING:
    from .base import Job


class JobKey(str, Enum):
    GEONAMES_IMPORT = 'geonames_import'
    ITINERARY_ROUTE_MAINTENANCE = 'itinerary_route_maintenance'
    ORPHANED_MEDIA_CLEANUP = 'orphaned_media_cleanup'


@dataclass(frozen=True)
class JobDefinition:
    key: JobKey
    name: str
    description: str
    factory: Callable[[Session], 'Job']
    default_enabled: bool
    default_cron: str
    default_timezone: str = 'UTC'
    minimum_interval: timedelta = timedelta(hours=1)
    run_on_start_until_first_success: bool = True


def _definitions() -> tuple[JobDefinition, ...]:
    # Imported lazily to keep the base contract free of factory imports.
    from .factories import (
        create_geonames_import_job,
        create_itinerary_route_maintenance_job,
        create_orphaned_media_cleanup_job,
    )

    return (
        JobDefinition(
            key=JobKey.GEONAMES_IMPORT,
            name='GeoNames places',
            description='Replace the GeoNames places dataset.',
            factory=create_geonames_import_job,
            default_enabled=True,
            default_cron='0 0 1 * *',
            minimum_interval=timedelta(days=1),
        ),
        JobDefinition(
            key=JobKey.ITINERARY_ROUTE_MAINTENANCE,
            name='Itinerary route maintenance',
            description='Backfill missing routes and retry due route failures.',
            factory=create_itinerary_route_maintenance_job,
            default_enabled=True,
            default_cron='0 0 * * *',
        ),
        JobDefinition(
            key=JobKey.ORPHANED_MEDIA_CLEANUP,
            name='Orphaned media cleanup',
            description='Delete old media that is no longer referenced.',
            factory=create_orphaned_media_cleanup_job,
            default_enabled=True,
            default_cron='0 0 * * *',
        ),
    )


JOB_DEFINITIONS = _definitions()
JOB_DEFINITIONS_BY_KEY = {
    definition.key.value: definition for definition in JOB_DEFINITIONS
}
if len(JOB_DEFINITIONS_BY_KEY) != len(JOB_DEFINITIONS):
    raise RuntimeError('Duplicate job keys in registry')
