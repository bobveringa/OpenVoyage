import typing
import uuid

from pydantic import BaseModel

if typing.TYPE_CHECKING:
    from models.database.media import Media


class MediaUploadResponse(BaseModel):
    id: uuid.UUID

    @classmethod
    def from_model(cls, media: 'Media') -> 'MediaUploadResponse':
        return cls(
            id=media.id,
        )
