"""Named polling presets concentrate flight checks around movement boundaries."""

from dataclasses import dataclass
from datetime import timedelta


@dataclass(frozen=True)
class FlightPollingPolicy:
    lead_minutes: int
    ground_minutes: int
    departure_minutes: int
    arrival_window_minutes: int
    arrival_minutes: int

    def first_check(self, departure):
        return departure - timedelta(minutes=self.lead_minutes)

    def next_check(self, flight, now):
        if flight.status == 'CANCELLED':
            return None
        arrival = flight.estimated_arrival or flight.scheduled_arrival
        if now >= (arrival or flight.scheduled_departure) + timedelta(hours=6):
            return None
        if flight.session:
            if arrival:
                arrival_window = arrival - timedelta(
                    minutes=self.arrival_window_minutes
                )
                if now >= arrival_window:
                    return now + timedelta(minutes=self.arrival_minutes)
                return min(now + timedelta(minutes=30), arrival_window)
            return now + timedelta(minutes=30)
        # A revised departure must not postpone checks indefinitely while a
        # flight remains on the ground after its original scheduled departure.
        departure = min(
            flight.scheduled_departure,
            flight.estimated_departure or flight.scheduled_departure,
        )
        first = self.first_check(departure)
        if now < first:
            return first
        imminent = departure - timedelta(minutes=15)
        if now >= imminent or flight.status in ('BOARDING', 'GATE_CLOSED'):
            return now + timedelta(minutes=self.departure_minutes)
        return min(now + timedelta(minutes=self.ground_minutes), imminent)


FLIGHT_POLLING_POLICIES = {
    'minimal': FlightPollingPolicy(30, 30, 30, 30, 30),
    'relaxed': FlightPollingPolicy(45, 20, 15, 30, 15),
    'balanced': FlightPollingPolicy(60, 20, 10, 30, 10),
    'frequent': FlightPollingPolicy(90, 15, 5, 45, 5),
    'very_frequent': FlightPollingPolicy(120, 10, 5, 60, 5),
}
