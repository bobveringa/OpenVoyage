import uuid
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from models.api.media import MediaUploadResponse
from models.api.users import TripMemberUserResponse


class ImmichConnectionRequest(BaseModel):
    model_config = ConfigDict(extra='forbid')

    server_url: str = Field(min_length=1, max_length=2048)
    api_key: str = Field(default='', max_length=4096)


class ImmichConnectionResponse(BaseModel):
    server_url: str


class ImmichConnectionStateResponse(BaseModel):
    connection: ImmichConnectionResponse | None


class ImmichAlbumResponse(BaseModel):
    id: uuid.UUID
    name: str


class ImmichAlbumLinkCreateRequest(BaseModel):
    model_config = ConfigDict(extra='forbid')

    album_id: uuid.UUID


class ImmichAlbumLinkResponse(BaseModel):
    id: uuid.UUID
    name: str | None
    connected_by: TripMemberUserResponse
    can_remove: bool


class ImmichAssetResponse(BaseModel):
    id: uuid.UUID
    media_type: Literal['IMAGE', 'VIDEO']
    thumbnail_url: str
    display_image_url: str | None


class ImmichAssetPageResponse(BaseModel):
    items: list[ImmichAssetResponse]
    next_cursor: str | None


class ImmichImportRequest(BaseModel):
    model_config = ConfigDict(extra='forbid')

    asset_id: uuid.UUID


__all__ = [
    'ImmichAlbumLinkCreateRequest',
    'ImmichAlbumLinkResponse',
    'ImmichAlbumResponse',
    'ImmichAssetPageResponse',
    'ImmichAssetResponse',
    'ImmichConnectionRequest',
    'ImmichConnectionResponse',
    'ImmichConnectionStateResponse',
    'ImmichImportRequest',
    'MediaUploadResponse',
]
