from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import datetime
from typing import Any

from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from core.setting_validators.theme_palette import validate_theme_palette
from models.api.user_preferences import TimeFormat, UserPreferencesPatch
from models.database.base import utcnow
from models.database.user_preferences import UserPreferences

DEFAULT_TIME_FORMAT = TimeFormat.TWENTY_FOUR_HOUR


class StoredUserPreferencesError(RuntimeError):
    """Raised when a persisted preference row cannot safely be applied."""


@dataclass(frozen=True)
class UserPreferencesRecord:
    """The preferences in effect for a user, stored or default."""

    time_format: TimeFormat
    theme_palette: dict[str, Any] | None
    updated_at: datetime | None


class UserPreferencesService:
    """Reads and writes the preference row owned by a single user.

    Args:
        db: SQLAlchemy session used for preference queries.
    """

    def __init__(self, db: Session) -> None:
        self.db = db

    def get_preferences(self, user_id: uuid.UUID) -> UserPreferencesRecord:
        """Return the user's stored preferences, or the defaults.

        Args:
            user_id: Owner of the preferences.

        Returns:
            The preferences in effect for the user. Users without a stored row
            get the defaults, and no row is created for them.

        Raises:
            StoredUserPreferencesError: If the stored row cannot be applied.
        """
        row = self.db.get(UserPreferences, user_id)
        if row is None:
            return UserPreferencesRecord(
                time_format=DEFAULT_TIME_FORMAT,
                theme_palette=None,
                updated_at=None,
            )
        return _record_from_row(row)

    def update_preferences(
        self,
        user_id: uuid.UUID,
        patch: UserPreferencesPatch,
    ) -> UserPreferencesRecord:
        """Merge a partial update into the user's preferences and persist it.

        Fields the patch leaves unset keep their current value, so the caller
        only sends what changed.

        Args:
            user_id: Owner of the preferences.
            patch: Validated partial update.

        Returns:
            The preferences in effect after the update.

        Raises:
            StoredUserPreferencesError: If the stored row cannot be applied.
        """
        current = self.get_preferences(user_id)
        changes = patch.model_dump(exclude_unset=True)
        time_format: TimeFormat = changes.get('time_format', current.time_format)
        theme_palette = changes.get('theme_palette', current.theme_palette)
        updated_at = utcnow()

        statement = insert(UserPreferences).values(
            user_id=user_id,
            time_format=time_format.value,
            theme_palette=theme_palette,
            created_at=updated_at,
            updated_at=updated_at,
        )
        self.db.execute(
            statement.on_conflict_do_update(
                index_elements=[UserPreferences.user_id],
                set_={
                    'time_format': statement.excluded.time_format,
                    'theme_palette': statement.excluded.theme_palette,
                    'updated_at': statement.excluded.updated_at,
                },
            )
        )
        self.db.commit()

        return UserPreferencesRecord(
            time_format=time_format,
            theme_palette=theme_palette,
            updated_at=updated_at,
        )


def _record_from_row(row: UserPreferences) -> UserPreferencesRecord:
    """Build a record from a stored row, rejecting values we cannot apply."""
    try:
        time_format = TimeFormat(row.time_format)
        theme_palette = (
            validate_theme_palette(row.theme_palette)
            if row.theme_palette is not None
            else None
        )
    except (TypeError, ValueError) as exc:
        raise StoredUserPreferencesError('Stored user preferences are invalid') from exc
    return UserPreferencesRecord(
        time_format=time_format,
        theme_palette=theme_palette,
        updated_at=row.updated_at,
    )
