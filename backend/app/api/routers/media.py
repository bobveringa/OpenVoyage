import os
import uuid

from starlette import status
from starlette.responses import StreamingResponse

from api.deps import CurrentUser, MediaServiceDep
from fastapi import APIRouter, HTTPException, UploadFile, Request
from fastapi.responses import FileResponse
from models.api.media import MediaUploadResponse
from models.database.media import MediaType

router = APIRouter(prefix='/media', tags=['media'])


@router.post(
    '',
    response_model=MediaUploadResponse,
    status_code=status.HTTP_201_CREATED,
)
def upload_media(
    media_service: MediaServiceDep,
    user: CurrentUser,
    file: UploadFile,
):
    try:
        media = media_service.upload_media(file, user)
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e),
        )

    return MediaUploadResponse.from_model(media)


def iter_file(
    path: str, start: int = 0, length: int | None = None, chunk_size: int = 1024 * 1024
):
    with open(path, 'rb') as file:
        if start > 0:
            file.seek(start)

        remaining = length
        while remaining is None or remaining > 0:
            read_size = (
                min(chunk_size, remaining) if remaining is not None else chunk_size
            )
            chunk = file.read(read_size)
            if not chunk:
                break
            if remaining is not None:
                remaining -= len(chunk)
            yield chunk


@router.get('/{media_id}/content')
def get_media_content(
    request: Request,
    media_service: MediaServiceDep,
    media_id: uuid.UUID,
    size: str | None = None,
):
    media = media_service.find_by_id(media_id)
    if not media:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
        )

    if size == 'thumbnail':
        storage_path = media.thumbnail_storage_path
        media_type = MediaType.IMAGE
        content_type = media.thumbnail_content_type
    else:
        storage_path = media.storage_path
        media_type = media.media_type
        content_type = media.content_type

    if media_type == MediaType.IMAGE:
        return FileResponse(
            path=storage_path,
            media_type=content_type,
        )
    elif media_type == MediaType.VIDEO:
        file_size = os.path.getsize(storage_path)
        range_header = request.headers.get('Range')

        if range_header:
            # Parse Range header like 'bytes=0-1024'
            byte1, byte2 = 0, None
            match = range_header.replace('bytes=', '').split('-')
            byte1 = int(match[0])
            if match[1]:
                byte2 = int(match[1])

            start = byte1
            end = byte2 if byte2 is not None else file_size - 1
            length = end - start + 1

            headers = {
                'Content-Range': f'bytes {start}-{end}/{file_size}',
                'Accept-Ranges': 'bytes',
                'Content-Length': str(length),
            }
            return StreamingResponse(
                content=iter_file(storage_path, start, length),
                status_code=status.HTTP_206_PARTIAL_CONTENT,
                headers=headers,
                media_type=content_type,
            )
        else:
            return StreamingResponse(
                content=iter_file(storage_path),
                media_type=content_type,
            )
    raise HTTPException(
        status_code=status.HTTP_404_NOT_FOUND,
    )
