import os
import uuid

import puremagic
from core.config import settings
from core.db import get_engine
from fastapi import BackgroundTasks, UploadFile
from models.database.media import Media, MediaStatus, MediaStorageBackend, MediaType
from models.database.user import User
from sqlalchemy.orm import Session
from utils.media.image_util import generate_image_thumbnail, get_image_info
from utils.media.video_util import generate_video_thumbnail, get_video_info


class MediaTooLargeError(Exception):
    """Raised when the uploaded file exceeds the configured size limit."""


class UnsupportedMediaTypeError(Exception):
    """Raised when the uploaded file's MIME type is not permitted."""


ALLOWED_MIME_TYPES: dict[str, MediaType] = {
    'image/jpeg': MediaType.IMAGE,
    'image/png': MediaType.IMAGE,
    'image/webp': MediaType.IMAGE,
    'video/mp4': MediaType.VIDEO,
    'video/webm': MediaType.VIDEO,
}

MIME_TYPE_EXTENSIONS: dict[str, str] = {
    'image/jpeg': '.jpg',
    'image/png': '.png',
    'image/webp': '.webp',
    'video/mp4': '.mp4',
    'video/webm': '.webm',
}

THUMBNAIL_CONTENT_TYPE = 'image/webp'


def get_media_storage_path(media_id: uuid.UUID) -> str:
    """Return the local filesystem path prefix for a media object.

    Args:
        media_id: Id of the media object.

    Returns:
        Path prefix used for the media file and related derived files.
    """
    hex_id = str(media_id).replace('-', '')
    return os.path.join(settings.media_root, hex_id[:2], hex_id[2:4], str(media_id))


def detect_content_type(file: UploadFile) -> str:
    """Detect the uploaded file MIME type and reset the stream position.

    Args:
        file: FastAPI upload whose stream should be inspected.

    Returns:
        Detected MIME type.

    Raises:
        UnsupportedMediaTypeError: No MIME type could be detected.
    """
    matches = puremagic.magic_stream(file.file)
    file.file.seek(0)
    if not matches:
        raise UnsupportedMediaTypeError('Could not determine media type')
    return matches[0].mime_type


def extension_for(content_type: str) -> str:
    """Return the preferred file extension for a supported MIME type.

    Args:
        content_type: MIME type to map to a file extension.

    Returns:
        File extension including the leading dot, or an empty string if unknown.
    """
    return MIME_TYPE_EXTENSIONS.get(content_type, '')


def copy_upload_file(file: UploadFile, path: str, max_size: int) -> int:
    """Copy an upload to disk while enforcing the configured byte limit.

    Args:
        file: FastAPI upload whose stream should be copied.
        path: Destination path on local storage.
        max_size: Maximum number of bytes allowed during copy.

    Returns:
        Number of bytes written.

    Raises:
        MediaTooLargeError: The upload stream exceeds ``max_size``.
    """
    bytes_written = 0
    with open(path, 'wb') as f:
        while chunk := file.file.read(1024 * 1024):
            bytes_written += len(chunk)
            if bytes_written > max_size:
                raise MediaTooLargeError(
                    f'File size exceeds the maximum allowed size of {max_size} bytes'
                )
            f.write(chunk)
    return bytes_written


def _extract_media_info(
    path: str,
    media_type: MediaType,
) -> tuple[int, int, int | None]:
    """Return dimensions and duration for a stored media file.

    Args:
        path: Local filesystem path to the media file.
        media_type: Classified media type for the file.

    Returns:
        Tuple of ``(width, height, duration)`` where duration is ``None`` for images.

    Raises:
        UnsupportedMediaTypeError: The media type cannot be inspected.
    """
    if media_type == MediaType.IMAGE:
        info = get_image_info(path)
        return info.width, info.height, None

    if media_type == MediaType.VIDEO:
        info = get_video_info(path)
        return info.width, info.height, round(info.duration)

    raise UnsupportedMediaTypeError(
        f'Cannot extract info for media type: {media_type!r}'
    )


class MediaService:
    """Coordinates media uploads, metadata persistence, and thumbnail jobs.

    Args:
        db: SQLAlchemy session used for media persistence.
        background_tasks: FastAPI background task queue for thumbnail jobs.
    """

    def __init__(self, db: Session, background_tasks: BackgroundTasks) -> None:
        """Initialize the service.

        Args:
            db: SQLAlchemy session used for database reads and writes.
            background_tasks: FastAPI background task queue for deferred work.
        """
        self.db = db
        self.background_tasks = background_tasks

    def upload_media(self, file: UploadFile, user: User) -> Media:
        """Store an uploaded media file and queue thumbnail generation.

        Args:
            file: Uploaded media file to validate and persist.
            user: Authenticated user who owns the uploaded media.

        Returns:
            Persisted media row.

        Raises:
            MediaTooLargeError: The upload exceeds the configured size limit.
            UnsupportedMediaTypeError: The upload MIME type is unsupported.
        """
        if file.size is not None and file.size > settings.MAX_MEDIA_SIZE:
            raise MediaTooLargeError(
                f'File size {file.size} exceeds the maximum allowed size of '
                f'{settings.MAX_MEDIA_SIZE} bytes'
            )

        content_type = detect_content_type(file)
        media_type = ALLOWED_MIME_TYPES.get(content_type)
        if media_type is None:
            raise UnsupportedMediaTypeError(f'Unsupported media type: {content_type!r}')

        media_id = uuid.uuid4()
        path = get_media_storage_path(media_id) + extension_for(content_type)
        os.makedirs(os.path.dirname(path), exist_ok=True)

        try:
            copy_upload_file(file, path, int(settings.MAX_MEDIA_SIZE))
            width, height, duration = _extract_media_info(path, media_type)

            media = Media(
                id=media_id,
                storage_path=path,
                media_type=media_type,
                content_type=content_type,
                caption='',
                status=MediaStatus.UPLOADED,
                storage_backend=MediaStorageBackend.LOCAL,
                created_by=user.id,
                duration=duration,
                width=width,
                height=height,
            )
            self.db.add(media)
            self.db.commit()
        except Exception:
            if os.path.exists(path):
                os.remove(path)
            raise

        self.background_tasks.add_task(create_thumbnail, media.id, path)
        return media

    def find_by_id(self, media_id: uuid.UUID) -> Media | None:
        """Return a media row by id, or ``None`` when it does not exist.

        Args:
            media_id: Id of the media row to load.

        Returns:
            Media row when found, otherwise ``None``.
        """
        return self.db.get(Media, media_id)


def create_thumbnail(media_id: uuid.UUID, media_path: str) -> None:
    """Create and persist a thumbnail for a previously uploaded media file.

    Args:
        media_id: Id of the media row to update after thumbnail generation.
        media_path: Local filesystem path to the original media file.

    Raises:
        UnsupportedMediaTypeError: The media type cannot be thumbnailed.
    """
    with Session(get_engine()) as db:
        media = db.get(Media, media_id)
        if media is None:
            return

        thumb_extension = extension_for(THUMBNAIL_CONTENT_TYPE)
        thumb_path = get_media_storage_path(media.id) + '.thumb' + thumb_extension
        os.makedirs(os.path.dirname(thumb_path), exist_ok=True)

        try:
            if media.media_type == MediaType.IMAGE:
                generate_image_thumbnail(
                    file_path=media_path,
                    destination=thumb_path,
                    content_type=THUMBNAIL_CONTENT_TYPE,
                )
            elif media.media_type == MediaType.VIDEO:
                timestamp = min(1.0, media.duration) if media.duration else 0.0
                generate_video_thumbnail(
                    file_path=media_path,
                    dest=thumb_path,
                    timestamp=timestamp,
                )
            else:
                raise UnsupportedMediaTypeError(
                    f'Cannot thumbnail media type: {media.media_type!r}'
                )
        except Exception:
            if os.path.exists(thumb_path):
                os.remove(thumb_path)
            media.status = MediaStatus.FAILED
            db.add(media)
            db.commit()
            raise

        media.status = MediaStatus.READY
        media.thumbnail_storage_path = thumb_path
        media.thumbnail_content_type = THUMBNAIL_CONTENT_TYPE
        db.add(media)
        db.commit()
