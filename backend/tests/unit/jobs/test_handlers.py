from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import Mock

from jobs import handlers
from services.media_cleanup_service import MediaCleanupResult
from services.place_service import GeoNamesDataset, PlaceImportResult


def test_geonames_import_job_uses_injected_services() -> None:
    app_settings = Mock()
    app_settings.get_value.return_value = GeoNamesDataset.CITIES_500.value

    place_service = Mock()
    place_service.import_geonames_dataset.return_value = PlaceImportResult(
        dataset=GeoNamesDataset.CITIES_500,
        deleted=12,
        processed=34,
    )

    job = handlers.GeoNamesImportJob(
        app_settings=app_settings,
        place_service=place_service,
    )
    result = job.run()

    place_service.import_geonames_dataset.assert_called_once_with(
        GeoNamesDataset.CITIES_500,
        replace_existing=True,
    )
    assert result.summary == {
        'dataset': 'cities500',
        'deleted': 12,
        'processed': 34,
    }


def test_route_maintenance_job_summarizes_result() -> None:
    queue = SimpleNamespace(
        queued_missing=0,
        queued_retries=0,
        skipped_max_attempts=0,
        skipped_provider_unavailable=True,
    )
    generation = SimpleNamespace(attempted=0, ready=0, failed=0, skipped=0)
    maintenance_result = SimpleNamespace(queue=queue, generation=generation)
    route_service = Mock()
    route_service.run_route_maintenance.return_value = maintenance_result

    job = handlers.ItineraryRouteMaintenanceJob(route_service=route_service)
    result = job.run()

    assert result.summary == {
        'attempted': 0,
        'failed': 0,
        'queued_missing': 0,
        'queued_retries': 0,
        'ready': 0,
        'skipped': 0,
        'skipped_max_attempts': 0,
        'skipped_provider_unavailable': True,
    }


def test_orphaned_media_cleanup_job_uses_injected_services(monkeypatch) -> None:
    now = datetime(2026, 8, 7, tzinfo=timezone.utc)
    monkeypatch.setattr(handlers, 'utcnow', lambda: now)

    app_settings = Mock()
    app_settings.get_value.return_value = 14

    media_cleanup = Mock()
    media_cleanup.cleanup_orphans.return_value = MediaCleanupResult(
        deleted_files=2,
        deleted_media=1,
        scanned=3,
    )

    job = handlers.OrphanedMediaCleanupJob(
        app_settings=app_settings,
        media_cleanup=media_cleanup,
    )
    result = job.run()

    expected_cutoff = datetime(2026, 7, 24, tzinfo=timezone.utc)
    media_cleanup.cleanup_orphans.assert_called_once_with(cutoff=expected_cutoff)
    assert result.summary == {
        'deleted_files': 2,
        'deleted_media': 1,
        'failed_media': 0,
        'missing_files': 0,
        'scanned': 3,
    }
