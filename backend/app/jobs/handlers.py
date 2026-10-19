from __future__ import annotations

from dataclasses import asdict
from datetime import timedelta

from core.app_settings import (
    MEDIA_ORPHAN_RETENTION_DAYS_KEY,
    PLACES_GEONAMES_DATASET_KEY,
)
from models.database.base import utcnow
from services.app_settings_service import AppSettingsService
from services.media_cleanup_service import MediaCleanupService
from services.place_service import GeoNamesDataset, PlaceService

from .base import Job, JobResult
from .definitions import JobKey


class GeoNamesImportJob(Job):
    key = JobKey.GEONAMES_IMPORT

    def __init__(
        self,
        app_settings: AppSettingsService,
        place_service: PlaceService,
    ) -> None:
        self.app_settings = app_settings
        self.place_service = place_service

    def run(self) -> JobResult:
        dataset_name = self.app_settings.get_value(PLACES_GEONAMES_DATASET_KEY)
        dataset = GeoNamesDataset(dataset_name)
        result = self.place_service.import_geonames_dataset(
            dataset,
            replace_existing=True,
        )

        reference_summary = self.place_service.import_airport_reference_data()
        summary = {
            **reference_summary,
            'dataset': result.dataset.value,
            'deleted': result.deleted,
            'processed': result.processed,
        }
        return JobResult(summary)


class PlanningArtifactCleanupJob(Job):
    key = JobKey.PLANNING_ARTIFACT_CLEANUP

    def __init__(self, db):
        self.db = db

    def run(self) -> JobResult:
        from sqlalchemy import delete
        from models.database.itinerary import ItineraryPlanningArtifact
        result = self.db.execute(delete(ItineraryPlanningArtifact).where(ItineraryPlanningArtifact.expires_at <= utcnow()))
        self.db.commit()
        return JobResult({'deleted': result.rowcount})


class OrphanedMediaCleanupJob(Job):
    key = JobKey.ORPHANED_MEDIA_CLEANUP

    def __init__(
        self,
        app_settings: AppSettingsService,
        media_cleanup: MediaCleanupService,
    ) -> None:
        self.app_settings = app_settings
        self.media_cleanup = media_cleanup

    def run(self) -> JobResult:
        retention_days = self.app_settings.get_value(MEDIA_ORPHAN_RETENTION_DAYS_KEY)
        cutoff = utcnow() - timedelta(days=retention_days)
        result = self.media_cleanup.cleanup_orphans(cutoff=cutoff)

        summary = asdict(result)
        return JobResult(summary)
