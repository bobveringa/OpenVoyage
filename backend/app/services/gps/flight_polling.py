"""Flight cadence, independent of viewer activity and provider backoff."""

from dataclasses import dataclass
from datetime import timedelta


@dataclass(frozen=True)
class FlightPollingPolicy:
    check_interval_minutes: int = 30
    check_more_often_before_departure: bool = True

    def first_check(self, departure):
        return departure - timedelta(hours=1)

    def next_check(self, flight, now):
        if flight.status == 'CANCELLED':
            return None
        arrival = flight.estimated_arrival or flight.scheduled_arrival
        if now >= (arrival or flight.scheduled_departure) + timedelta(hours=6):
            return None
        if flight.session:
            return now + timedelta(minutes=self.check_interval_minutes)
        departure = min(
            flight.scheduled_departure,
            flight.estimated_departure or flight.scheduled_departure,
        )
        first = self.first_check(departure)
        if now < first:
            return first
        minutes = self.check_interval_minutes
        if self.check_more_often_before_departure:
            minutes = min(minutes, 10)
        return now + timedelta(minutes=minutes)
