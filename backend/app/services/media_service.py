import os
import shutil
import uuid

import puremagic
from core.config import settings
from fastapi import BackgroundTasks, UploadFile
from models.database.media import Media, MediaStatus, MediaStorageBackend, MediaType
from models.database.user import User
from sqlalchemy.orm import Session
from utils.media.image_util import generate_image_thumbnail, get_image_info
from utils.media.video_util import generate_video_thumbnail, get_video_info

ALLOWED_MIME_TYPES = {
    'image/jpeg',
    'image/png',
    'image/webp',
    'video/mp4',
    'video/webm',
}

MIME_TYPE_EXTENSIONS = {
    'image/jpeg': '.jpg',
    'image/png': '.png',
    'image/webp': '.webp',
    'video/mp4': '.mp4',
    'video/webm': '.webm',
}


def get_media_storage_path(media_id: uuid.UUID) -> str:
    media_id_hex = str(media_id).replace('-', '')
    return os.path.join(
        settings.media_root, media_id_hex[:2], media_id_hex[2:4], str(media_id)
    )


def get_content_type_from_file(
    file: UploadFile,
):
    magic_content_type = puremagic.magic_stream(file.file)
    if len(magic_content_type) > 0:
        return magic_content_type[0].mime_type
    raise ValueError('Unsupported media type')


def get_extension_for_content_type(content_type: str) -> str:
    return MIME_TYPE_EXTENSIONS.get(content_type, '')


THUMBNAIL_CONTENT_TYPE = 'image/webp'


class MediaService:
    def __init__(
        self,
        db: Session,
        background_tasks: BackgroundTasks,
    ):
        self.db = db
        self.background_tasks = background_tasks

    def create_thumbnail(
        self,
        media: Media,
        media_path: str,
    ):
        extension = get_extension_for_content_type(THUMBNAIL_CONTENT_TYPE)
        new_storage_path = get_media_storage_path(media.id) + '.thumb' + extension
        os.makedirs(os.path.dirname(new_storage_path), exist_ok=True)
        if media.media_type == MediaType.IMAGE:
            generate_image_thumbnail(
                file_path=media_path,
                destination=new_storage_path,
                content_type=THUMBNAIL_CONTENT_TYPE,
            )
        elif media.media_type == MediaType.VIDEO:
            thumbnail_timestamp = min(1, media.duration) if media.duration else 0
            generate_video_thumbnail(
                file_path=media_path,
                dest=new_storage_path,
                timestamp=thumbnail_timestamp,
            )
        else:
            raise ValueError('Unsupported media type')

        media.status = MediaStatus.READY
        media.thumbnail_storage_path = new_storage_path
        media.thumbnail_content_type = THUMBNAIL_CONTENT_TYPE
        self.db.add(media)
        self.db.commit()

    def upload_media(
        self,
        file: UploadFile,
        user: User,
    ) -> Media:
        # We generate the ID here as we use it for parts of storage
        if file.size is not None and file.size > settings.MAX_MEDIA_SIZE:
            raise ValueError('Media is too large')

        media_id = uuid.uuid4()

        content_type = get_content_type_from_file(file)
        if not content_type.startswith(('image/', 'video/')):
            raise ValueError('Unsupported media type')

        if content_type not in ALLOWED_MIME_TYPES:
            raise ValueError('Unsupported media type')

        path = get_media_storage_path(media_id) + get_extension_for_content_type(
            content_type
        )
        os.makedirs(os.path.dirname(path), exist_ok=True)

        with open(path, 'wb') as f:
            shutil.copyfileobj(file.file, f)

        media_type = MediaType.IMAGE
        if content_type.startswith('video/'):
            media_type = MediaType.VIDEO

        width = None
        height = None
        duration = None
        if media_type == MediaType.IMAGE:
            img_info = get_image_info(path)
            width = img_info.width
            height = img_info.height
        elif media_type == MediaType.VIDEO:
            video_info = get_video_info(path)
            width = video_info.width
            height = video_info.height
            duration = round(video_info.duration)

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

        # We do not yet delete the temporary file we created. instead
        # we are going to start a background job to create a thumbnail.

        self.background_tasks.add_task(
            self.create_thumbnail,
            media,
            path,
        )

        return media

    def find_by_id(
        self,
        media_id: uuid.UUID,
    ) -> Media | None:
        media = self.db.get(Media, media_id)
        return media
