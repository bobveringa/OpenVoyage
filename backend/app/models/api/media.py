import typing
import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel
from models.database.media import MediaType
from utils.media.url_util import build_media_urls

if typing.TYPE_CHECKING:
    from models.database.media import Media


class MediaUploadResponse(BaseModel):
    id: uuid.UUID

    @classmethod
    def from_model(cls, media: 'Media') -> 'MediaUploadResponse':
        return cls(
            id=media.id,
        )


class MediaUrls(BaseModel):
    content: str
    thumbnail: str


class MediaMetadata(BaseModel):
    caption: str
    created_at: datetime
    updated_at: datetime


class ImageTechnicalInfo(BaseModel):
    width: int
    height: int


class VideoTechnicalInfo(BaseModel):
    width: int
    height: int
    duration: int


class MediaResponse(BaseModel):
    id: uuid.UUID
    media_type: Literal['IMAGE', 'VIDEO']
    urls: MediaUrls
    metadata: MediaMetadata
    technical_info: ImageTechnicalInfo | VideoTechnicalInfo

    @classmethod
    def from_model(cls, media: 'Media', media_base_url: str = '') -> 'MediaResponse':
        if (
            media.thumbnail_storage_path is None
            or media.width is None
            or media.height is None
        ):
            raise ValueError('Ready media must include thumbnail, width, and height')

        content_url, thumbnail_url = build_media_urls(media_base_url, media.id)
        urls = MediaUrls(content=content_url, thumbnail=thumbnail_url)

        metadata = MediaMetadata(
            caption=media.caption,
            created_at=media.created_at,
            updated_at=media.updated_at,
        )

        if isinstance(media.media_type, MediaType):
            media_type_value = media.media_type.value
        else:
            media_type_value = str(media.media_type).upper()

        if media_type_value == 'VIDEO':
            if media.duration is None:
                raise ValueError('Ready video media must include duration')
            technical_info: ImageTechnicalInfo | VideoTechnicalInfo = (
                VideoTechnicalInfo(
                    width=media.width,
                    height=media.height,
                    duration=media.duration,
                )
            )
        else:
            technical_info = ImageTechnicalInfo(
                width=media.width,
                height=media.height,
            )

        if media_type_value == 'VIDEO':
            media_type_literal: Literal['IMAGE', 'VIDEO'] = 'VIDEO'
        elif media_type_value == 'IMAGE':
            media_type_literal = 'IMAGE'
        else:
            raise ValueError(f'Unsupported media_type: {media.media_type!r}')

        return cls(
            id=media.id,
            media_type=media_type_literal,
            urls=urls,
            metadata=metadata,
            technical_info=technical_info,
        )
