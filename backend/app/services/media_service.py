import logging
import os
import uuid

import puremagic
from core.app_settings import MEDIA_MAX_UPLOAD_SIZE_MB_KEY
from core.db import get_engine
from fastapi import BackgroundTasks, UploadFile
from models.database.media import Media, MediaStatus, MediaStorageBackend, MediaType
from models.database.posts import Post, PostComment, PostMedia
from models.database.trips import Trip
from models.database.user import User, UserProfile
from services.trip_access import get_trip_read_access
from services.app_settings_service import AppSettingsService
from sqlalchemy import select
from sqlalchemy.orm import Session
from utils.media.image_util import generate_image_thumbnail, get_image_info
from utils.media.image_util import clean_image
from utils.media.video_util import VideoCleaningError, clean_video, generate_video_thumbnail, get_video_info
from utils.media.storage import (
    register_active, unregister_active, staging_directory, remove_staging,
    remove_promoted, storage_prefix,
)


logger = logging.getLogger(__name__)


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
    return str(storage_prefix(media_id))


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
    """Coordinates private uploads and deferred cleaning and thumbnail jobs.

    Args:
        db: SQLAlchemy session used for media persistence.
        background_tasks: FastAPI background task queue for thumbnail jobs.
    """

    def __init__(
        self,
        db: Session,
        background_tasks: BackgroundTasks,
        app_settings_service: AppSettingsService,
    ) -> None:
        """Initialize the service.

        Args:
            db: SQLAlchemy session used for database reads and writes.
            background_tasks: FastAPI background task queue for deferred work.
        """
        self.db = db
        self.background_tasks = background_tasks
        self.app_settings_service = app_settings_service

    def upload_media(self, file: UploadFile, user: User, *, media_id: uuid.UUID | None = None) -> Media:
        """Stage an uploaded file and defer cleaning, inspection and thumbnails.

        Args:
            file: Uploaded media file to validate and persist.
            user: Authenticated user who owns the uploaded media.

        Returns:
            Persisted media row.

        Raises:
            MediaTooLargeError: The upload exceeds the configured size limit.
            UnsupportedMediaTypeError: The upload MIME type is unsupported.
        """
        max_size_mb = self.app_settings_service.get_value(MEDIA_MAX_UPLOAD_SIZE_MB_KEY)
        max_size = int(max_size_mb) * 1_000_000
        if file.size is not None and file.size > max_size:
            raise MediaTooLargeError(
                f'File size {file.size} exceeds the maximum allowed size of '
                f'{max_size} bytes'
            )

        content_type = detect_content_type(file)
        media_type = ALLOWED_MIME_TYPES.get(content_type)
        if media_type is None:
            raise UnsupportedMediaTypeError(f'Unsupported media type: {content_type!r}')

        media_id = media_id or uuid.uuid4()
        register_active(media_id)
        path = str(staging_directory(media_id) / ('original' + extension_for(content_type)))

        try:
            os.makedirs(os.path.dirname(path), exist_ok=True)
            copy_upload_file(file, path, max_size)

            media = Media(
                id=media_id,
                storage_path=path,
                media_type=media_type,
                content_type=content_type,
                caption='',
                status=MediaStatus.UPLOADED,
                storage_backend=MediaStorageBackend.LOCAL,
                created_by=user.id,
            )
            self.db.add(media)
            self.db.commit()
        except Exception:
            self.db.rollback()
            try:
                remove_staging(media_id)
            finally:
                unregister_active(media_id)
            raise

        self.background_tasks.add_task(process_media, media.id)
        return media

    def find_by_id(self, media_id: uuid.UUID) -> Media | None:
        """Return a media row by id, or ``None`` when it does not exist.

        Args:
            media_id: Id of the media row to load.

        Returns:
            Media row when found, otherwise ``None``.
        """
        return self.db.get(Media, media_id)

    def can_read_media(
        self,
        media: Media,
        current_user_id: uuid.UUID | None,
    ) -> bool:
        """Return whether the current user may read a media file.

        Profile pictures are public. Trip cover media and published post media
        follow their trip visibility; private trip media is readable by members.
        Upload owners can read their own media before it is attached anywhere.
        """
        if current_user_id is not None and media.created_by == current_user_id:
            return True

        if self._is_profile_picture(media.id):
            return True

        if self._is_readable_trip_cover(media.id, current_user_id):
            return True

        return self._is_readable_post_media(media.id, current_user_id) or self._is_readable_comment_media(
            media.id, current_user_id
        )

    def _is_profile_picture(self, media_id: uuid.UUID) -> bool:
        statement = (
            select(UserProfile.user_id)
            .where(UserProfile.profile_picture_media_id == media_id)
            .limit(1)
        )
        return self.db.execute(statement).first() is not None

    def _is_readable_trip_cover(
        self,
        media_id: uuid.UUID,
        current_user_id: uuid.UUID | None,
    ) -> bool:
        trip_ids = self.db.execute(
            select(Trip.id).where(Trip.cover_media_id == media_id)
        ).scalars()

        for trip_id in trip_ids:
            access = get_trip_read_access(
                self.db,
                trip_id=trip_id,
                current_user_id=current_user_id,
            )
            if access is not None:
                return True

        return False

    def _is_readable_post_media(
        self,
        media_id: uuid.UUID,
        current_user_id: uuid.UUID | None,
    ) -> bool:
        post_rows = self.db.execute(
            select(Post.id)
            .add_columns(Post.trip_id, Post.published_at)
            .join(PostMedia, PostMedia.post_id == Post.id)
            .where(PostMedia.media_id == media_id)
        ).all()

        for _post_id, trip_id, published_at in post_rows:
            access = get_trip_read_access(
                self.db,
                trip_id=trip_id,
                current_user_id=current_user_id,
            )
            if access is None:
                continue
            if published_at is not None or access.can_read_drafts:
                return True

        return False

    def _is_readable_comment_media(
        self,
        media_id: uuid.UUID,
        current_user_id: uuid.UUID | None,
    ) -> bool:
        post_rows = self.db.execute(
            select(Post.trip_id, Post.published_at)
            .join(PostComment, PostComment.post_id == Post.id)
            .where(PostComment.media_id == media_id)
        ).all()
        for trip_id, published_at in post_rows:
            access = get_trip_read_access(
                self.db, trip_id=trip_id, current_user_id=current_user_id
            )
            if access is not None and (published_at is not None or access.can_read_drafts):
                return True
        return False


def process_media(media_id: uuid.UUID) -> None:
    """Clean and promote privately staged media before enabling any access."""
    register_active(media_id)
    try:
        with Session(get_engine()) as db:
            media = db.get(Media, media_id)
            if media is None or media.status != MediaStatus.UPLOADED:
                return
            original = media.storage_path
            extension = extension_for(media.content_type)
            directory = staging_directory(media.id)
            clean_path = str(directory / ('clean' + extension))
            thumb_path = str(directory / 'thumbnail.webp')
            final_path = get_media_storage_path(media.id) + extension
            final_thumb = get_media_storage_path(media.id) + '.thumb.webp'
            stage = 'start'
            try:
                media.status = MediaStatus.PROCESSING
                db.commit()
                stage = 'clean'
                if media.media_type == MediaType.IMAGE:
                    clean_image(original, clean_path, media.content_type)
                elif media.media_type == MediaType.VIDEO:
                    clean_video(original, clean_path)
                else:
                    raise UnsupportedMediaTypeError('Unsupported media type')
                stage = 'inspect'
                width, height, duration = _extract_media_info(clean_path, media.media_type)
                stage = 'thumbnail'
                if media.media_type == MediaType.IMAGE:
                    generate_image_thumbnail(clean_path, thumb_path)
                else:
                    generate_video_thumbnail(clean_path, thumb_path, timestamp=0.0)
                    # Rebuild pixels using the same image policy as upload thumbnails.
                    clean_image(thumb_path, str(directory / 'clean-thumbnail.webp'), THUMBNAIL_CONTENT_TYPE)
                    os.replace(str(directory / 'clean-thumbnail.webp'), thumb_path)
                stage = 'promote'
                os.makedirs(os.path.dirname(final_path), exist_ok=True)
                os.replace(clean_path, final_path)
                os.replace(thumb_path, final_thumb)
                remove_staging(media.id)
                media.storage_path = final_path
                media.thumbnail_storage_path = final_thumb
                media.thumbnail_content_type = THUMBNAIL_CONTENT_TYPE
                media.width, media.height, media.duration = width, height, duration
                media.status = MediaStatus.READY
                stage = 'ready_commit'
                db.commit()
            except Exception as error:
                # Report only controlled codes and stages, never source paths,
                # metadata-bearing exception text, tracebacks or subprocess output.
                reason = error.code if isinstance(error, VideoCleaningError) else type(error).__name__
                logger.warning('media_processing_failed media_id=%s stage=%s reason=%s', media_id, stage, reason)
                try:
                    db.rollback()
                    # No subprocess output or metadata-bearing exception is logged.
                    media = db.get(Media, media_id)
                    if media is not None:
                        media.status = MediaStatus.FAILED
                        media.thumbnail_storage_path = None
                        media.thumbnail_content_type = None
                        media.width = media.height = media.duration = None
                        db.commit()
                finally:
                    # Database failures must not prevent filesystem cleanup.
                    # Any filesystem failure remains recoverable at startup.
                    try:
                        remove_staging(media_id)
                    finally:
                        remove_promoted(media_id)
    finally:
        unregister_active(media_id)
