from __future__ import annotations

from typing import Any
from urllib.parse import urlsplit

from pydantic import AnyHttpUrl, TypeAdapter, ValidationError


_HTTP_URL_ADAPTER = TypeAdapter(AnyHttpUrl)


def validate_http_url(value: Any) -> str:
    """Require a complete HTTP or HTTPS URL without changing its representation."""
    try:
        _HTTP_URL_ADAPTER.validate_python(value)
    except ValidationError as exc:
        raise ValueError('Value must be a valid HTTP or HTTPS URL') from exc
    return value


def validate_http_url_template(value: Any) -> str:
    """Require an HTTP(S) template while allowing placeholder syntax."""
    lower_value = value.lower()
    if not (lower_value.startswith('http://') or lower_value.startswith('https://')):
        raise ValueError('Value must be an HTTP or HTTPS URL template')
    if any(character.isspace() for character in value):
        raise ValueError('Value must not contain whitespace')
    return value


def validate_service_base_url(value: str) -> str:
    """An HTTP(S) API base URL without credentials, query or fragment."""
    validate_http_url(value)
    parsed = urlsplit(value)
    if (
        parsed.username is not None
        or parsed.password is not None
        or parsed.query
        or parsed.fragment
        or any(character.isspace() for character in value)
    ):
        raise ValueError('Base URL must not include credentials, query, or fragment')
    return value
