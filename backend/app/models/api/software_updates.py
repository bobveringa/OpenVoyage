from datetime import datetime
from typing import Literal

from pydantic import BaseModel


class ServerVersionResponse(BaseModel):
    version: str


class SoftwareReleaseResponse(BaseModel):
    version: str
    url: str
    published_at: datetime


class SoftwareUpdateResponse(BaseModel):
    installed_version: str
    latest_release: SoftwareReleaseResponse | None
    comparison: Literal['update_available', 'up_to_date', 'ahead', 'unknown']
    check_status: Literal['never_checked', 'checking', 'ok', 'failed', 'disabled']
    checks_enabled: bool
    last_attempt_at: datetime | None
    last_success_at: datetime | None
    next_allowed_check_at: datetime | None
    error_code: str | None
    is_stale: bool
