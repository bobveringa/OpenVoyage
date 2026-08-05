from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from threading import Barrier

from cryptography.fernet import Fernet
import pytest
from sqlalchemy.orm import Session

from core.app_settings import (
    ROUTING_GRAPHHOPPER_API_KEY,
    ROUTING_GRAPHHOPPER_BASE_URL_KEY,
    ROUTING_PROVIDER_KEY,
)
from core.app_settings_encryption import AppSettingsEncryption
from models.database.settings import AppSetting
from services.app_settings_service import (
    AppSettingNotFoundError,
    AppSettingsCache,
    AppSettingsService,
)
from services.route_providers import GraphHopperRouteProvider, RouteProviderFactory


def _service(db_session, cache: AppSettingsCache | None = None):
    encryption = AppSettingsEncryption(Fernet.generate_key().decode('ascii'))
    return AppSettingsService(
        db_session,
        encryption,
        cache=cache or AppSettingsCache(),
    )


@pytest.mark.integration
def test_update_and_reset_invalidate_effective_value_cache(db_session) -> None:
    cache = AppSettingsCache()
    service = _service(db_session, cache)

    assert service.get_value('theme.darkmode') == 'system'
    service.update_setting('theme.darkmode', 'enabled', updated_by=None)
    assert service.get_value('theme.darkmode') == 'enabled'
    service.reset_setting('theme.darkmode')
    assert service.get_value('theme.darkmode') == 'system'


@pytest.mark.integration
def test_existing_value_is_not_revalidated_or_rewritten_on_read(db_session) -> None:
    db_session.add(AppSetting(key=ROUTING_PROVIDER_KEY, value='legacy-provider'))
    db_session.commit()
    service = _service(db_session)

    value = service.get_value(ROUTING_PROVIDER_KEY)
    record = service.get_admin_setting(ROUTING_PROVIDER_KEY)

    assert value == 'legacy-provider'
    assert record.value == 'legacy-provider'
    assert db_session.get(AppSetting, ROUTING_PROVIDER_KEY).value == 'legacy-provider'


@pytest.mark.integration
def test_orphaned_row_is_not_available_by_key(db_session) -> None:
    db_session.add(AppSetting(key='orphan.setting', value='ignored'))
    db_session.commit()
    service = _service(db_session)

    with pytest.raises(AppSettingNotFoundError):
        service.get_value('orphan.setting')
    with pytest.raises(AppSettingNotFoundError):
        service.get_admin_setting('orphan.setting')


@pytest.mark.integration
def test_route_factory_keeps_snapshot_until_new_factory_is_created(
    db_session,
) -> None:
    encryption_key = Fernet.generate_key().decode('ascii')
    service = AppSettingsService(
        db_session,
        AppSettingsEncryption(encryption_key),
        cache=AppSettingsCache(),
    )
    service.update_setting(ROUTING_PROVIDER_KEY, 'graphhopper', updated_by=None)
    service.update_setting(
        ROUTING_GRAPHHOPPER_BASE_URL_KEY,
        'https://example.test/api/1',
        updated_by=None,
    )
    service.update_setting(
        ROUTING_GRAPHHOPPER_API_KEY,
        'first-secret',
        updated_by=None,
    )
    factory = RouteProviderFactory()

    first_provider = factory.create_routing_provider(service)
    service.update_setting(
        ROUTING_GRAPHHOPPER_API_KEY,
        'replacement-secret',
        updated_by=None,
    )
    cached_provider = factory.create_routing_provider(service)
    replacement_provider = RouteProviderFactory().create_routing_provider(service)

    assert isinstance(first_provider, GraphHopperRouteProvider)
    assert cached_provider is first_provider
    assert first_provider.api_key == 'first-secret'
    assert isinstance(replacement_provider, GraphHopperRouteProvider)
    assert replacement_provider.api_key == 'replacement-secret'

    service.reset_setting(ROUTING_GRAPHHOPPER_API_KEY)

    assert factory.create_routing_provider(service) is first_provider
    assert RouteProviderFactory().create_routing_provider(service) is None


@pytest.mark.integration
def test_concurrent_first_writes_use_atomic_upsert(db_session) -> None:
    bind = db_session.get_bind()
    barrier = Barrier(2)

    def update(value: str) -> str:
        with Session(bind=bind) as session:
            service = AppSettingsService(
                session,
                AppSettingsEncryption(None),
                cache=AppSettingsCache(),
            )
            barrier.wait(timeout=5)
            return service.update_setting(
                'theme.darkmode',
                value,
                updated_by=None,
            ).value

    with ThreadPoolExecutor(max_workers=2) as executor:
        results = list(executor.map(update, ('enabled', 'disabled')))

    db_session.expire_all()
    row = db_session.get(AppSetting, 'theme.darkmode')
    assert len(results) == 2
    assert all(result in {'enabled', 'disabled'} for result in results)
    assert row is not None
    assert row.value in {'enabled', 'disabled'}


@pytest.mark.integration
def test_concurrent_update_and_reset_are_atomic(db_session) -> None:
    _service(db_session).update_setting(
        'theme.darkmode',
        'enabled',
        updated_by=None,
    )
    bind = db_session.get_bind()
    barrier = Barrier(2)

    def update() -> tuple[str, object]:
        with Session(bind=bind) as session:
            service = AppSettingsService(
                session,
                AppSettingsEncryption(None),
                cache=AppSettingsCache(),
            )
            barrier.wait(timeout=5)
            record = service.update_setting(
                'theme.darkmode',
                'disabled',
                updated_by=None,
            )
            return 'update', record.value

    def reset() -> tuple[str, object]:
        with Session(bind=bind) as session:
            service = AppSettingsService(
                session,
                AppSettingsEncryption(None),
                cache=AppSettingsCache(),
            )
            barrier.wait(timeout=5)
            record = service.reset_setting('theme.darkmode')
            return 'reset', record.value

    with ThreadPoolExecutor(max_workers=2) as executor:
        update_future = executor.submit(update)
        reset_future = executor.submit(reset)
        results = {update_future.result(), reset_future.result()}

    db_session.expire_all()
    row = db_session.get(AppSetting, 'theme.darkmode')
    assert {operation for operation, _value in results} == {'update', 'reset'}
    assert all(value in {'disabled', 'system'} for _operation, value in results)
    assert row is None or row.value == 'disabled'
