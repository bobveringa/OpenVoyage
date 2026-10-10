import uuid
from collections.abc import Iterable

from models.database.media import Media, MediaStatus


class MediaNotReadyError(Exception):
    def __init__(self, media_ids: list[uuid.UUID]) -> None:
        self.media_ids = media_ids
        super().__init__('Media is not ready')


def require_ready_media(media: Iterable[Media]) -> None:
    pending = list(dict.fromkeys(item.id for item in media if item.status != MediaStatus.READY))
    if pending:
        raise MediaNotReadyError(pending)
