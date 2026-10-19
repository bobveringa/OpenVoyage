from datetime import datetime, timezone
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

    place_service.import_airport_reference_data.return_value = {'airports': 2, 'timezones_backfilled': 3}
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
        'airports': 2, 'timezones_backfilled': 3,
        'dataset': 'cities500',
        'deleted': 12,
        'processed': 34,
    }


def test_planning_artifact_job_deletes_only_expired_artifacts():
    db = Mock()
    db.execute.return_value.rowcount = 2
    result = handlers.PlanningArtifactCleanupJob(db).run()
    assert result.summary == {'deleted': 2}
    assert 'expires_at <=' in str(db.execute.call_args.args[0])
    db.commit.assert_called_once()


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
