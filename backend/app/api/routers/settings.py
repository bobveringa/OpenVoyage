from __future__ import annotations

from typing import NoReturn

from fastapi import APIRouter, HTTPException, Response
from starlette import status

from api.deps import AppSettingsServiceDep, CurrentAdmin
from core.app_settings import AppSettingValidationError
from core.app_settings_encryption import AppSettingsEncryptionError
from models.api.settings import (
    AdminSettingResponse,
    AdminSettingsListResponse,
    AppSettingUpdateRequest,
    PublicSettingsResponse,
)
from services.app_settings_service import (
    AppSettingNotFoundError,
    StoredAppSettingError,
)

public_router = APIRouter(prefix='/settings', tags=['settings'])
admin_router = APIRouter(prefix='/admin/settings', tags=['admin'])


def _raise_http_error(exc: Exception) -> NoReturn:
    if isinstance(exc, AppSettingNotFoundError):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail='Setting not found',
        ) from exc
    if isinstance(exc, AppSettingValidationError):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=[
                {
                    'loc': ['body', 'value'],
                    'msg': str(exc),
                    'type': 'value_error',
                }
            ],
        ) from exc
    if isinstance(exc, AppSettingsEncryptionError):
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail='App settings encryption is not configured',
        ) from exc
    if isinstance(exc, StoredAppSettingError):
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail='Stored app setting is invalid',
        ) from exc
    raise exc


@public_router.get('/public', response_model=PublicSettingsResponse)
def get_public_settings(
    app_settings_service: AppSettingsServiceDep,
    response: Response,
) -> PublicSettingsResponse:
    try:
        record = app_settings_service.get_public_settings()
    except StoredAppSettingError as exc:
        _raise_http_error(exc)
    response.headers['Cache-Control'] = 'no-store'
    return PublicSettingsResponse.model_validate(record)


@admin_router.get('', response_model=AdminSettingsListResponse)
def list_admin_settings(
    app_settings_service: AppSettingsServiceDep,
    _admin: CurrentAdmin,
) -> AdminSettingsListResponse:
    try:
        record = app_settings_service.list_admin_settings()
    except StoredAppSettingError as exc:
        _raise_http_error(exc)
    return AdminSettingsListResponse.model_validate(record)


@admin_router.get('/{setting_key}', response_model=AdminSettingResponse)
def get_admin_setting(
    setting_key: str,
    app_settings_service: AppSettingsServiceDep,
    _admin: CurrentAdmin,
) -> AdminSettingResponse:
    try:
        record = app_settings_service.get_admin_setting(setting_key)
    except (AppSettingNotFoundError, StoredAppSettingError) as exc:
        _raise_http_error(exc)
    return AdminSettingResponse.model_validate(record)


@admin_router.patch('/{setting_key}', response_model=AdminSettingResponse)
def update_admin_setting(
    setting_key: str,
    payload: AppSettingUpdateRequest,
    app_settings_service: AppSettingsServiceDep,
    admin: CurrentAdmin,
) -> AdminSettingResponse:
    try:
        record = app_settings_service.update_setting(
            setting_key,
            payload.value,
            updated_by=admin.id,
        )
    except (
        AppSettingNotFoundError,
        AppSettingValidationError,
        AppSettingsEncryptionError,
        StoredAppSettingError,
    ) as exc:
        _raise_http_error(exc)
    return AdminSettingResponse.model_validate(record)


@admin_router.post('/{setting_key}/reset', response_model=AdminSettingResponse)
def reset_admin_setting(
    setting_key: str,
    app_settings_service: AppSettingsServiceDep,
    _admin: CurrentAdmin,
) -> AdminSettingResponse:
    try:
        record = app_settings_service.reset_setting(setting_key)
    except (AppSettingNotFoundError, StoredAppSettingError) as exc:
        _raise_http_error(exc)
    return AdminSettingResponse.model_validate(record)
