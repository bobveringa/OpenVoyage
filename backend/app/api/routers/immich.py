import uuid
from typing import NoReturn

from fastapi import APIRouter, HTTPException, Query, Request, Response
from starlette import status

from api.deps import CurrentUser, ImmichServiceDep
from core import security
from core.app_settings_encryption import AppSettingsEncryptionError
from models.api.immich import (
    ImmichAlbumLinkCreateRequest,
    ImmichAlbumLinkResponse,
    ImmichAlbumResponse,
    ImmichAssetPageResponse,
    ImmichAssetResponse,
    ImmichConnectionRequest,
    ImmichConnectionResponse,
    ImmichConnectionStateResponse,
    ImmichImportRequest,
)
from models.api.media import MediaUploadResponse
from models.api.users import TripMemberUserResponse
from services.immich_client import (
    ImmichCredentialsError,
    ImmichInvalidConnectionError,
    ImmichNotFoundError,
    ImmichPolicyError,
    ImmichTimeoutError,
    ImmichUnavailableError,
)
from services.immich_service import (
    FEATURE_DISABLED_DETAIL,
    ImmichAccessError,
    ImmichAlbumLinkRecord,
    ImmichConnectionConflictError,
    ImmichConnectionMissingError,
    ImmichFeatureDisabledError,
)
from services.media_service import MediaTooLargeError, UnsupportedMediaTypeError


user_router = APIRouter(prefix='/users/me/immich', tags=['immich'])
trip_router = APIRouter(prefix='/trips/{trip_id}/immich/albums', tags=['immich'])


def _raise_http_error(exc: Exception) -> NoReturn:
    if isinstance(exc, ImmichFeatureDisabledError):
        raise HTTPException(status_code=403, detail=FEATURE_DISABLED_DETAIL) from exc
    if isinstance(exc, (ImmichPolicyError, ImmichAccessError)):
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    if isinstance(
        exc,
        (
            ImmichInvalidConnectionError,
            ImmichConnectionMissingError,
            MediaTooLargeError,
            UnsupportedMediaTypeError,
        ),
    ):
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if isinstance(exc, (ImmichConnectionConflictError, ImmichCredentialsError)):
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    if isinstance(exc, ImmichNotFoundError):
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    if isinstance(exc, ImmichTimeoutError):
        raise HTTPException(status_code=504, detail=str(exc)) from exc
    if isinstance(exc, ImmichUnavailableError):
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    if isinstance(exc, AppSettingsEncryptionError):
        raise HTTPException(
            status_code=500,
            detail='App settings encryption is not configured',
        ) from exc
    raise exc


def _album_link_response(
    record: ImmichAlbumLinkRecord,
    media_base_url: str,
) -> ImmichAlbumLinkResponse:
    return ImmichAlbumLinkResponse(
        id=record.link.id,
        name=record.name,
        connected_by=TripMemberUserResponse.from_model(
            record.connected_by,
            media_base_url=media_base_url,
        ),
        can_remove=record.can_remove,
    )


@user_router.get('', response_model=ImmichConnectionStateResponse)
def get_connection(
    service: ImmichServiceDep,
    user: CurrentUser,
) -> ImmichConnectionStateResponse:
    try:
        connection = service.get_connection(user.id)
    except Exception as exc:
        _raise_http_error(exc)
    return ImmichConnectionStateResponse(
        connection=(
            ImmichConnectionResponse(server_url=connection.server_url)
            if connection is not None
            else None
        )
    )


@user_router.post('/test', status_code=status.HTTP_204_NO_CONTENT)
def test_connection(
    payload: ImmichConnectionRequest,
    service: ImmichServiceDep,
    user: CurrentUser,
) -> None:
    try:
        service.test_connection(user.id, payload.server_url, payload.api_key)
    except Exception as exc:
        _raise_http_error(exc)


@user_router.put('', response_model=ImmichConnectionResponse)
def save_connection(
    payload: ImmichConnectionRequest,
    service: ImmichServiceDep,
    user: CurrentUser,
) -> ImmichConnectionResponse:
    try:
        connection = service.save_connection(
            user.id,
            payload.server_url,
            payload.api_key,
        )
    except Exception as exc:
        _raise_http_error(exc)
    return ImmichConnectionResponse(server_url=connection.server_url)


@user_router.delete('', status_code=status.HTTP_204_NO_CONTENT)
def disconnect(service: ImmichServiceDep, user: CurrentUser) -> None:
    try:
        service.disconnect(user.id)
    except Exception as exc:
        _raise_http_error(exc)


@user_router.get('/albums', response_model=list[ImmichAlbumResponse])
def list_personal_albums(
    service: ImmichServiceDep,
    user: CurrentUser,
) -> list[ImmichAlbumResponse]:
    try:
        albums = service.list_personal_albums(user.id)
    except Exception as exc:
        _raise_http_error(exc)
    return [ImmichAlbumResponse.model_validate(album) for album in albums]


@trip_router.get('', response_model=list[ImmichAlbumLinkResponse])
def list_trip_albums(
    request: Request,
    trip_id: uuid.UUID,
    service: ImmichServiceDep,
    user: CurrentUser,
) -> list[ImmichAlbumLinkResponse]:
    try:
        records = service.list_trip_albums(trip_id, user.id)
    except Exception as exc:
        _raise_http_error(exc)
    media_base_url = str(request.base_url).rstrip('/')
    return [_album_link_response(record, media_base_url) for record in records]


@trip_router.post('', response_model=ImmichAlbumLinkResponse)
def connect_album(
    request: Request,
    response: Response,
    trip_id: uuid.UUID,
    payload: ImmichAlbumLinkCreateRequest,
    service: ImmichServiceDep,
    user: CurrentUser,
) -> ImmichAlbumLinkResponse:
    try:
        record, created = service.connect_album(trip_id, user.id, payload.album_id)
    except Exception as exc:
        _raise_http_error(exc)
    response.status_code = 201 if created else 200
    return _album_link_response(record, str(request.base_url).rstrip('/'))


@trip_router.delete('/{link_id}', status_code=status.HTTP_204_NO_CONTENT)
def remove_album_link(
    trip_id: uuid.UUID,
    link_id: uuid.UUID,
    service: ImmichServiceDep,
    user: CurrentUser,
) -> None:
    try:
        service.remove_album_link(trip_id, link_id, user.id)
    except Exception as exc:
        _raise_http_error(exc)


@trip_router.get('/{link_id}/assets', response_model=ImmichAssetPageResponse)
def list_assets(
    trip_id: uuid.UUID,
    link_id: uuid.UUID,
    service: ImmichServiceDep,
    user: CurrentUser,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=50),
) -> ImmichAssetPageResponse:
    try:
        asset_page = service.list_assets(trip_id, link_id, user.id, page, page_size)
    except Exception as exc:
        _raise_http_error(exc)
    base_path = f'/api/v1/trips/{trip_id}/immich/albums/{link_id}/assets'
    return ImmichAssetPageResponse(
        items=[
            ImmichAssetResponse(
                id=asset.id,
                media_type=asset.media_type,
                thumbnail_url=f'{base_path}/{asset.id}/thumbnail',
                display_image_url=(
                    f'{base_path}/{asset.id}/display-image'
                    if asset.media_type == 'IMAGE'
                    else None
                ),
            )
            for asset in asset_page.items
        ],
        next_page=asset_page.next_page,
    )


@trip_router.get('/{link_id}/assets/{asset_id}/thumbnail')
def get_thumbnail(
    trip_id: uuid.UUID,
    link_id: uuid.UUID,
    asset_id: uuid.UUID,
    service: ImmichServiceDep,
    user: CurrentUser,
) -> Response:
    try:
        result = service.get_asset_media(
            trip_id,
            link_id,
            asset_id,
            user.id,
            display=False,
        )
    except Exception as exc:
        _raise_http_error(exc)
    return Response(
        content=result.content,
        media_type=result.content_type or 'application/octet-stream',
        headers={'Cache-Control': 'private, no-store'},
    )


@trip_router.get('/{link_id}/assets/{asset_id}/display-image')
def get_display_image(
    trip_id: uuid.UUID,
    link_id: uuid.UUID,
    asset_id: uuid.UUID,
    service: ImmichServiceDep,
    user: CurrentUser,
) -> Response:
    try:
        result = service.get_asset_media(
            trip_id,
            link_id,
            asset_id,
            user.id,
            display=True,
        )
    except Exception as exc:
        _raise_http_error(exc)
    return Response(
        content=result.content,
        media_type=result.content_type or 'application/octet-stream',
        headers={'Cache-Control': 'private, no-store'},
    )


@trip_router.post(
    '/{link_id}/imports',
    response_model=MediaUploadResponse,
    status_code=status.HTTP_201_CREATED,
)
def import_asset(
    request: Request,
    trip_id: uuid.UUID,
    link_id: uuid.UUID,
    payload: ImmichImportRequest,
    service: ImmichServiceDep,
    user: CurrentUser,
) -> MediaUploadResponse:
    try:
        media = service.import_asset(trip_id, link_id, payload.asset_id, user)
    except Exception as exc:
        _raise_http_error(exc)
    return MediaUploadResponse.from_model(
        media,
        media_base_url=str(request.base_url).rstrip('/'),
        media_token=security.create_media_url_token(media.id),
    )
