from __future__ import annotations

import copy

import pytest

from core.setting_validators.theme_palette import DEFAULT_THEME_PALETTE
from factories.users import create_user
from models.api.user_preferences import TimeFormat, UserPreferencesPatch
from models.database.user_preferences import UserPreferences
from services.user_preferences_service import (
    StoredUserPreferencesError,
    UserPreferencesService,
)


@pytest.mark.integration
def test_get_preferences_returns_defaults_without_storing_a_row(db_session) -> None:
    user = create_user(db_session)
    service = UserPreferencesService(db_session)

    record = service.get_preferences(user.id)

    assert record.time_format == TimeFormat.TWENTY_FOUR_HOUR
    assert record.theme_palette is None
    assert record.updated_at is None
    assert db_session.get(UserPreferences, user.id) is None


@pytest.mark.integration
def test_update_preferences_keeps_fields_the_patch_leaves_unset(db_session) -> None:
    user = create_user(db_session)
    service = UserPreferencesService(db_session)
    palette = copy.deepcopy(DEFAULT_THEME_PALETTE)
    palette['light']['primary'] = '#246b49'

    service.update_preferences(
        user.id,
        UserPreferencesPatch(time_format=TimeFormat.TWELVE_HOUR),
    )
    record = service.update_preferences(
        user.id,
        UserPreferencesPatch(theme_palette=palette),
    )

    assert record.time_format == TimeFormat.TWELVE_HOUR
    assert record.theme_palette['light']['primary'] == '#246B49'
    assert record.updated_at is not None
    assert service.get_preferences(user.id) == record


@pytest.mark.integration
def test_update_preferences_clears_the_palette_when_the_patch_sets_null(
    db_session,
) -> None:
    user = create_user(db_session)
    service = UserPreferencesService(db_session)
    service.update_preferences(
        user.id,
        UserPreferencesPatch(theme_palette=copy.deepcopy(DEFAULT_THEME_PALETTE)),
    )

    record = service.update_preferences(
        user.id,
        UserPreferencesPatch(theme_palette=None),
    )

    assert record.theme_palette is None
    assert db_session.get(UserPreferences, user.id).theme_palette is None


@pytest.mark.integration
def test_get_preferences_rejects_a_stored_palette_it_cannot_apply(db_session) -> None:
    user = create_user(db_session)
    db_session.add(
        UserPreferences(
            user_id=user.id,
            time_format=TimeFormat.TWENTY_FOUR_HOUR.value,
            theme_palette={'schema_version': 1},
        )
    )
    db_session.commit()
    service = UserPreferencesService(db_session)

    with pytest.raises(StoredUserPreferencesError):
        service.get_preferences(user.id)
