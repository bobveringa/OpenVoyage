import uuid
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit


def build_media_urls(
    base_url: str,
    media_id: uuid.UUID,
    *,
    media_token: str | None = None,
) -> tuple[str, str]:
    base = base_url.rstrip('/')
    media_url = f'{base}/api/v1/media/{media_id}/content'
    query_params = {}
    if media_token:
        query_params['media_token'] = media_token

    media_url = append_query_params(media_url, query_params)
    thumbnail_url = append_query_params(media_url, {'thumbnail': 'true'})
    return media_url, thumbnail_url


def append_query_params(url: str, params: dict[str, str]) -> str:
    if not params:
        return url

    parts = urlsplit(url)
    query = dict(parse_qsl(parts.query, keep_blank_values=True))
    query.update(params)
    return urlunsplit(
        (
            parts.scheme,
            parts.netloc,
            parts.path,
            urlencode(query),
            parts.fragment,
        )
    )
