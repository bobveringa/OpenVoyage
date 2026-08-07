from __future__ import annotations

from datetime import timedelta

from sqlalchemy.orm import Session

from core.app_settings import MEDIA_ORPHAN_RETENTION_DAYS_KEY, PLACES_GEONAMES_DATASET_KEY
from models.database.base import utcnow
from services.app_settings_service import AppSettingsService
from services.itinerary_routes import ItineraryRouteService
from services.media_cleanup_service import MediaCleanupService
from services.place_service import GeoNamesDataset, PlaceService
from services.route_providers import RouteProviderFactory

from .base import Job, JobResult
from .definitions import JobKey

route_provider_factory = RouteProviderFactory()


class GeoNamesImportJob(Job):
    key = JobKey.GEONAMES_IMPORT

    def __init__(self, db: Session) -> None:
        self.db = db

    def run(self) -> JobResult:
        dataset = GeoNamesDataset(
            AppSettingsService(self.db).get_value(PLACES_GEONAMES_DATASET_KEY)
        )
        result = PlaceService(self.db).import_geonames_dataset(dataset, replace_existing=True)
        return JobResult({'dataset': result.dataset.value, 'deleted': result.deleted, 'processed': result.processed})


class ItineraryRouteMaintenanceJob(Job):
    key = JobKey.ITINERARY_ROUTE_MAINTENANCE

    def __init__(self, db: Session) -> None:
        self.db = db

    def run(self) -> JobResult:
        app_settings = AppSettingsService(self.db)
        provider = route_provider_factory.create_routing_provider(app_settings)
        result = ItineraryRouteService(db=self.db, route_provider=provider).run_route_maintenance(queue_limit=500, generation_limit=500)
        queue = result.queue
        generation = result.generation
        # Older in-process route-service instances can return a maintenance
        # summary as a component after a hot reload. Check the result shape
        # instead of class identity, since the reloaded summary class differs
        # from the one imported by this module.
        while (
            not hasattr(queue, 'skipped_provider_unavailable')
            and hasattr(queue, 'queue')
        ):
            queue = queue.queue
        while (
            not hasattr(generation, 'attempted')
            and hasattr(generation, 'generation')
        ):
            generation = generation.generation
        return JobResult({
            'attempted': generation.attempted, 'failed': generation.failed,
            'queued_missing': queue.queued_missing, 'queued_retries': queue.queued_retries,
            'ready': generation.ready, 'skipped': generation.skipped,
            'skipped_max_attempts': queue.skipped_max_attempts,
            'skipped_provider_unavailable': queue.skipped_provider_unavailable,
        })


class OrphanedMediaCleanupJob(Job):
    key = JobKey.ORPHANED_MEDIA_CLEANUP

    def __init__(self, db: Session) -> None:
        self.db = db

    def run(self) -> JobResult:
        days = AppSettingsService(self.db).get_value(MEDIA_ORPHAN_RETENTION_DAYS_KEY)
        result = MediaCleanupService(self.db).cleanup_orphans(cutoff=utcnow() - timedelta(days=days))
        return JobResult(result.__dict__)
