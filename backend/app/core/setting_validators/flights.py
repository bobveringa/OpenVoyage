"""Validation for administrator-controlled flight API destinations."""

from core.setting_validators.common import validate_service_base_url


def validate_flight_base_url(value: str) -> str:
    return validate_service_base_url(value)


def validate_flight_interval(value: int) -> int:
    if value not in (5, 10, 15, 30, 60):
        raise ValueError('Choose 5, 10, 15, 30 or 60 minutes')
    return value
