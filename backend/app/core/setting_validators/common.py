from __future__ import annotations

from typing import Any

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
