import pytest
from alembic import command

from integration.services.test_flight_monitor_migration import alembic_config
from models.database.settings import AppSetting


@pytest.mark.parametrize(
    'preset', ['minimal', 'relaxed', 'balanced', 'frequent', 'very_frequent', None]
)
def test_migrates_polling_preferences_and_removes_legacy_provider_credentials(
    engine, db_session, preset
):
    config = alembic_config(engine)
    db = db_session
    db.commit()
    command.downgrade(config, 'a5d7f9012346')
    if preset:
        db.add(AppSetting(key='flights.update_frequency', value=preset))
    db.add_all(
        [
            AppSetting(key='flights.provider', value='aerodatabox'),
            AppSetting(
                key='flights.rapidapi_api_key', secret_value='old-encrypted-key'
            ),
            AppSetting(key='flights.aerodatabox_base_url', value='https://legacy.test'),
            AppSetting(key='flights.aerodatabox_rapidapi_host', value='legacy.test'),
        ]
    )
    db.commit()
    command.upgrade(config, 'head')
    db.expire_all()
    assert db.get(AppSetting, 'flights.provider').value == 'none'
    for key in (
        'flights.update_frequency',
        'flights.rapidapi_api_key',
        'flights.aerodatabox_base_url',
        'flights.aerodatabox_rapidapi_host',
    ):
        assert db.get(AppSetting, key) is None
    from services.app_settings_service import AppSettingsCache, AppSettingsService

    settings = AppSettingsService(db, cache=AppSettingsCache())
    assert settings.get_value('flights.check_interval_minutes') == 30
    assert settings.get_value('flights.check_more_often_before_departure') is (
        preset != 'minimal'
    )
