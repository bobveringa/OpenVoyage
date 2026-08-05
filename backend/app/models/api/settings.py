from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict

from core.app_settings import SettingValueType, SettingVisibility


class PublicSettingsResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    settings: dict[str, Any]
    updated_at: datetime | None


class AdminSettingResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    key: str
    value_type: SettingValueType
    visibility: SettingVisibility
    description: str
    value: Any | None
    default_value: Any | None
    runtime_safe: bool
    validation: dict[str, Any] | None
    is_configured: bool
    updated_at: datetime | None


class AdminSettingsListResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    settings: list[AdminSettingResponse]
    updated_at: datetime | None


class AppSettingUpdateRequest(BaseModel):
    value: Any
