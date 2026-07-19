import os
import uuid

from starlette import status
from starlette.responses import StreamingResponse

from api.deps import CurrentUser, MediaServiceDep, OptionalCurrentUser
from fastapi import APIRouter, HTTPException, UploadFile, Request
from fastapi.responses import FileResponse
from models.api.media import MediaUploadResponse
from models.database.media import MediaStatus, MediaType
from services.media_service import MediaTooLargeError, UnsupportedMediaTypeError

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
    except (MediaTooLargeError, UnsupportedMediaTypeError) as e:
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


def parse_range_header(range_header: str, file_size: int) -> tuple[int, int]:
    if not range_header.startswith('bytes=') or ',' in range_header:
        raise ValueError('Only a single byte range is supported')

    start_str, end_str = range_header.removeprefix('bytes=').split('-', 1)
    if not start_str and not end_str:
        raise ValueError('Range must include a start or suffix length')

    if start_str:
        start = int(start_str)
        end = int(end_str) if end_str else file_size - 1
    else:
        suffix_length = int(end_str)
        if suffix_length <= 0:
            raise ValueError('Suffix range length must be positive')
        start = max(file_size - suffix_length, 0)
        end = file_size - 1

    if start < 0 or end < start or start >= file_size:
        raise ValueError('Requested range is not satisfiable')

    return start, min(end, file_size - 1)


@router.get('/{media_id}/content')
def get_media_content(
    request: Request,
    media_service: MediaServiceDep,
    user: OptionalCurrentUser,
    media_id: uuid.UUID,
    thumbnail: bool = False,
    share_token: str | None = None,
):
    media = media_service.find_by_id(media_id)
    if not media:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
        )

    if not media_service.can_read_media(
        media,
        user.id if user else None,
        share_token=share_token,
    ):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
        )

    if thumbnail:
        storage_path = media.thumbnail_storage_path
        media_type = MediaType.IMAGE
        content_type = media.thumbnail_content_type
    else:
        storage_path = media.storage_path
        media_type = media.media_type
        content_type = media.content_type

    if media.status != MediaStatus.READY and thumbnail:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail='Media thumbnail is not ready',
        )

    if storage_path is None or not os.path.exists(storage_path):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
        )

    if media_type == MediaType.IMAGE:
        return FileResponse(
            path=storage_path,
            media_type=content_type,
        )
    elif media_type == MediaType.VIDEO:
        file_size = os.path.getsize(storage_path)
        range_header = request.headers.get('Range')

        if range_header:
            # 1. Parse Range header (e.g., 'bytes=0-1024' or 'bytes=1024-')
            try:
                start, end = parse_range_header(range_header, file_size)
                length = end - start + 1

            except (ValueError, IndexError):
                raise HTTPException(
                    status_code=status.HTTP_416_RANGE_NOT_SATISFIABLE,
                    detail='Invalid or unsatisfiable Range header.',
                    headers={'Content-Range': f'bytes */{file_size}'},
                )

            # 2. Prepare streaming response headers
            headers = {
                'Content-Range': f'bytes {start}-{end}/{file_size}',
                'Accept-Ranges': 'bytes',
                'Content-Length': str(length),
            }

            # 3. Return Partial Content (206)
            return StreamingResponse(
                content=iter_file(storage_path, start, length),
                status_code=status.HTTP_206_PARTIAL_CONTENT,
                headers=headers,
                media_type=content_type,
            )
        else:
            return StreamingResponse(
                content=iter_file(storage_path),
                headers={
                    'Accept-Ranges': 'bytes',
                    'Content-Length': str(file_size),
                },
                media_type=content_type,
            )
    raise HTTPException(
        status_code=status.HTTP_404_NOT_FOUND,
    )
