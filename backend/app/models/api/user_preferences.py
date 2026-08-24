from __future__ import annotations

from datetime import datetime
from enum import Enum
from typing import Any

from pydantic import BaseModel, ConfigDict, field_validator, model_validator

from core.setting_validators.theme_palette import validate_theme_palette


class TimeFormat(str, Enum):
    TWELVE_HOUR = '12-hour'
    TWENTY_FOUR_HOUR = '24-hour'


class UserPreferencesResponse(BaseModel):
    time_format: TimeFormat
    theme_palette: dict[str, Any] | None
    updated_at: datetime | None


class UserPreferencesPatch(BaseModel):
    model_config = ConfigDict(extra='forbid')

    time_format: TimeFormat | None = None
    theme_palette: dict[str, Any] | None = None

    @field_validator('time_format', mode='before')
    @classmethod
    def validate_time_format(cls, value: Any) -> Any:
        if value is None:
            raise ValueError('time_format cannot be null')
        return value

    @field_validator('theme_palette')
    @classmethod
    def validate_theme_palette(
        cls,
        value: dict[str, Any] | None,
    ) -> dict[str, Any] | None:
        if value is None:
            return None
        return validate_theme_palette(value)

    @model_validator(mode='after')
    def validate_patch(self) -> 'UserPreferencesPatch':
        if not self.model_fields_set:
            raise ValueError('At least one preference must be supplied')
        return self
