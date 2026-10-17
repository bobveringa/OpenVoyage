from datetime import datetime, timedelta, timezone

import pytest

from services.post_service import InvalidPostDateError, PostService

NOW = datetime(2026, 10, 17, 12, tzinfo=timezone.utc)


@pytest.mark.unit
@pytest.mark.parametrize('offset', [-7, 0, 9])
@pytest.mark.parametrize('seconds', [-1, 0, 1])
def test_post_dates_compare_instants(monkeypatch, offset, seconds):
    monkeypatch.setattr('services.post_service.utcnow', lambda: NOW)
    value = (NOW + timedelta(seconds=seconds)).astimezone(timezone(timedelta(hours=offset)))
    if seconds > 0:
        with pytest.raises(InvalidPostDateError):
            PostService._validate_occurred_at(value)
    else:
        assert PostService._validate_occurred_at(value) == value


@pytest.mark.unit
@pytest.mark.parametrize('seconds', [-1, 0, 1])
def test_offsetless_post_dates_are_utc(monkeypatch, seconds):
    monkeypatch.setattr('services.post_service.utcnow', lambda: NOW)
    value = (NOW + timedelta(seconds=seconds)).replace(tzinfo=None)
    if seconds > 0:
        with pytest.raises(InvalidPostDateError):
            PostService._validate_occurred_at(value)
    else:
        assert PostService._validate_occurred_at(value) == value.replace(tzinfo=timezone.utc)
