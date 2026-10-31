from __future__ import annotations

from sqlalchemy.orm import Session

from services.app_settings_service import AppSettingsService
from services.media_cleanup_service import MediaCleanupService
from services.place_service import PlaceService

from .handlers import (
    GeoNamesImportJob,
    PlanningArtifactCleanupJob,
    OrphanedMediaCleanupJob,
    SoftwareUpdateCheckJob,
)


def create_software_update_check_job(db: Session) -> SoftwareUpdateCheckJob:
    return SoftwareUpdateCheckJob(db)


def create_geonames_import_job(db: Session) -> GeoNamesImportJob:
    app_settings = AppSettingsService(db)
    place_service = PlaceService(db)

    return GeoNamesImportJob(
        app_settings=app_settings,
        place_service=place_service,
    )


def create_planning_artifact_cleanup_job(db: Session) -> PlanningArtifactCleanupJob:
    return PlanningArtifactCleanupJob(db)


def create_orphaned_media_cleanup_job(
    db: Session,
) -> OrphanedMediaCleanupJob:
    app_settings = AppSettingsService(db)
    media_cleanup = MediaCleanupService(db)

    return OrphanedMediaCleanupJob(
        app_settings=app_settings,
        media_cleanup=media_cleanup,
    )
