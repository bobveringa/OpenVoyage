from __future__ import annotations

from dataclasses import dataclass
from datetime import timedelta
from enum import Enum
from typing import TYPE_CHECKING

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
    job_type: type['Job']
    default_enabled: bool
    default_cron: str
    default_timezone: str = 'UTC'
    minimum_interval: timedelta = timedelta(hours=1)
    run_on_start_until_first_success: bool = True


def _definitions() -> tuple[JobDefinition, ...]:
    # Imported lazily to keep the base contract free of handler imports.
    from .handlers import (
        GeoNamesImportJob,
        ItineraryRouteMaintenanceJob,
        OrphanedMediaCleanupJob,
    )
    return (
        JobDefinition(JobKey.GEONAMES_IMPORT, 'GeoNames places', 'Replace the GeoNames places dataset.', GeoNamesImportJob, True, '0 0 1 * *', minimum_interval=timedelta(days=1)),
        JobDefinition(JobKey.ITINERARY_ROUTE_MAINTENANCE, 'Itinerary route maintenance', 'Backfill missing routes and retry due route failures.', ItineraryRouteMaintenanceJob, True, '0 0 * * *'),
        JobDefinition(JobKey.ORPHANED_MEDIA_CLEANUP, 'Orphaned media cleanup', 'Delete old media that is no longer referenced.', OrphanedMediaCleanupJob, True, '0 0 * * *'),
    )


JOB_DEFINITIONS = _definitions()
JOB_DEFINITIONS_BY_KEY = {definition.key.value: definition for definition in JOB_DEFINITIONS}
if len(JOB_DEFINITIONS_BY_KEY) != len(JOB_DEFINITIONS):
    raise RuntimeError('Duplicate job keys in registry')
if any(definition.key != definition.job_type.key for definition in JOB_DEFINITIONS):
    raise RuntimeError('Job handler key does not match registry definition')
