from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest

from services.gps.tracking_service import SAMPLE_TIME_TOLERANCE, GpsTrackingService

STARTED_AT = datetime(2026, 8, 14, 8, 0, tzinfo=timezone.utc)
ENDED_AT = STARTED_AT + timedelta(hours=1)


def _within(recorded_at: datetime, lower: datetime, upper: datetime) -> bool:
    return GpsTrackingService._within_session_bounds(recorded_at, lower, upper)


@pytest.mark.unit
class TestLowerBound:
    def test_exactly_at_started_at_is_accepted(self) -> None:
        lower = STARTED_AT - SAMPLE_TIME_TOLERANCE
        assert _within(STARTED_AT, lower, ENDED_AT + SAMPLE_TIME_TOLERANCE) is True

    def test_one_microsecond_before_started_at_is_accepted_within_tolerance(
        self,
    ) -> None:
        lower = STARTED_AT - SAMPLE_TIME_TOLERANCE
        recorded_at = STARTED_AT - timedelta(microseconds=1)
        assert _within(recorded_at, lower, ENDED_AT + SAMPLE_TIME_TOLERANCE) is True

    def test_exactly_tolerance_before_started_at_is_accepted(self) -> None:
        lower = STARTED_AT - SAMPLE_TIME_TOLERANCE
        recorded_at = STARTED_AT - SAMPLE_TIME_TOLERANCE
        assert _within(recorded_at, lower, ENDED_AT + SAMPLE_TIME_TOLERANCE) is True

    def test_beyond_tolerance_before_started_at_is_discarded(self) -> None:
        lower = STARTED_AT - SAMPLE_TIME_TOLERANCE
        recorded_at = STARTED_AT - SAMPLE_TIME_TOLERANCE - timedelta(microseconds=1)
        assert _within(recorded_at, lower, ENDED_AT + SAMPLE_TIME_TOLERANCE) is False


@pytest.mark.unit
class TestUpperBoundEndedSession:
    upper = ENDED_AT + SAMPLE_TIME_TOLERANCE

    def test_exactly_at_ended_at_is_accepted(self) -> None:
        assert _within(ENDED_AT, STARTED_AT - SAMPLE_TIME_TOLERANCE, self.upper) is True

    def test_one_microsecond_after_ended_at_is_accepted_within_tolerance(self) -> None:
        recorded_at = ENDED_AT + timedelta(microseconds=1)
        assert (
            _within(recorded_at, STARTED_AT - SAMPLE_TIME_TOLERANCE, self.upper) is True
        )

    def test_exactly_tolerance_after_ended_at_is_accepted(self) -> None:
        recorded_at = ENDED_AT + SAMPLE_TIME_TOLERANCE
        assert (
            _within(recorded_at, STARTED_AT - SAMPLE_TIME_TOLERANCE, self.upper) is True
        )

    def test_beyond_tolerance_after_ended_at_is_discarded(self) -> None:
        recorded_at = ENDED_AT + SAMPLE_TIME_TOLERANCE + timedelta(microseconds=1)
        assert (
            _within(recorded_at, STARTED_AT - SAMPLE_TIME_TOLERANCE, self.upper)
            is False
        )


@pytest.mark.unit
class TestUpperBoundLiveSession:
    """Same three cases as the ended session, against utcnow() + TOLERANCE."""

    def test_exactly_at_now_is_accepted(self) -> None:
        now = datetime.now(timezone.utc)
        upper = now + SAMPLE_TIME_TOLERANCE
        assert _within(now, STARTED_AT - SAMPLE_TIME_TOLERANCE, upper) is True

    def test_exactly_tolerance_after_now_is_accepted(self) -> None:
        now = datetime.now(timezone.utc)
        upper = now + SAMPLE_TIME_TOLERANCE
        recorded_at = now + SAMPLE_TIME_TOLERANCE
        assert _within(recorded_at, STARTED_AT - SAMPLE_TIME_TOLERANCE, upper) is True

    def test_beyond_tolerance_after_now_is_discarded(self) -> None:
        now = datetime.now(timezone.utc)
        upper = now + SAMPLE_TIME_TOLERANCE
        recorded_at = now + SAMPLE_TIME_TOLERANCE + timedelta(microseconds=1)
        assert _within(recorded_at, STARTED_AT - SAMPLE_TIME_TOLERANCE, upper) is False
