"""Validation for administrator-controlled flight API destinations."""

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


def validate_flight_interval(value: int) -> int:
    if value not in (5, 10, 15, 30, 60):
        raise ValueError('Choose 5, 10, 15, 30 or 60 minutes')
    return value
