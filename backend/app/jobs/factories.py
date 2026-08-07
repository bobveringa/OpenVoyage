from __future__ import annotations

from sqlalchemy.orm import Session

from services.app_settings_service import AppSettingsService
from services.itinerary_routes import ItineraryRouteService
from services.media_cleanup_service import MediaCleanupService
from services.place_service import PlaceService
from services.route_providers import RouteProviderFactory

from .handlers import (
    GeoNamesImportJob,
    ItineraryRouteMaintenanceJob,
    OrphanedMediaCleanupJob,
)

route_provider_factory = RouteProviderFactory()


def create_geonames_import_job(db: Session) -> GeoNamesImportJob:
    app_settings = AppSettingsService(db)
    place_service = PlaceService(db)

    return GeoNamesImportJob(
        app_settings=app_settings,
        place_service=place_service,
    )


def create_itinerary_route_maintenance_job(
    db: Session,
) -> ItineraryRouteMaintenanceJob:
    app_settings = AppSettingsService(db)
    route_provider = route_provider_factory.create_routing_provider(app_settings)
    route_service = ItineraryRouteService(
        db=db,
        route_provider=route_provider,
    )

    return ItineraryRouteMaintenanceJob(route_service=route_service)


def create_orphaned_media_cleanup_job(
    db: Session,
) -> OrphanedMediaCleanupJob:
    app_settings = AppSettingsService(db)
    media_cleanup = MediaCleanupService(db)

    return OrphanedMediaCleanupJob(
        app_settings=app_settings,
        media_cleanup=media_cleanup,
    )
