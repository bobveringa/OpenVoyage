import uuid


def build_media_urls(base_url: str, media_id: uuid.UUID) -> tuple[str, str]:
    base = base_url.rstrip('/')
    media_url = f'{base}/api/v1/media/{media_id}/content'
    thumbnail_url = f'{media_url}?thumbnail=true'
    return media_url, thumbnail_url
