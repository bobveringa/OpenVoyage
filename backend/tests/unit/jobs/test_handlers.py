from types import SimpleNamespace
from unittest.mock import Mock

from jobs import handlers


def test_route_maintenance_job_unwraps_reloaded_summary_components(
    fake_db: Mock,
    monkeypatch,
) -> None:
    queue = SimpleNamespace(
        queued_missing=0,
        queued_retries=0,
        skipped_max_attempts=0,
        skipped_provider_unavailable=True,
    )
    generation = SimpleNamespace(attempted=0, ready=0, failed=0, skipped=0)
    legacy_result = SimpleNamespace(
        queue=SimpleNamespace(queue=queue),
        generation=SimpleNamespace(generation=generation),
    )
    route_service = Mock()
    route_service.run_route_maintenance.return_value = legacy_result

    monkeypatch.setattr(handlers, 'AppSettingsService', lambda _db: Mock())
    monkeypatch.setattr(
        handlers.route_provider_factory,
        'create_routing_provider',
        lambda _settings: None,
    )
    monkeypatch.setattr(
        handlers,
        'ItineraryRouteService',
        lambda **_kwargs: route_service,
    )

    result = handlers.ItineraryRouteMaintenanceJob(fake_db).run()

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
