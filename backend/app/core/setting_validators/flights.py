"""Validation for administrator-controlled flight API destinations."""

import re
from urllib.parse import urlsplit

from core.setting_validators.common import validate_http_url


def validate_flight_base_url(value: str) -> str:
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


def validate_rapidapi_host(value: str) -> str:
    if not re.fullmatch(r'[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?', value):
        raise ValueError('RapidAPI host must be a hostname without scheme or path')
    return value
