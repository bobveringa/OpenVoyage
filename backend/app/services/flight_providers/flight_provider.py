"""Provider-independent flight lookup contract and errors."""

from abc import ABC, abstractmethod
from dataclasses import dataclass
from datetime import datetime

from models.api.planning import Endpoint, FlightLookup, FlightLookupRequest


@dataclass(frozen=True)
class FlightMovement:
    scheduled_departure: datetime
    departure_airport: Endpoint
    status: str = 'UNKNOWN'
    departure_confirmed: bool = False
    arrival_confirmed: bool = False
    estimated_departure: datetime | None = None
    estimated_arrival: datetime | None = None
    actual_departure: datetime | None = None
    actual_arrival: datetime | None = None
    landing_airport: Endpoint | None = None
    diverted: bool = False


class FlightUnavailable(Exception):
    def __init__(
        self,
        reason='Flight lookup unavailable',
        retry_after_seconds=None,
        *,
        result='UNAVAILABLE',
    ):
        super().__init__(reason)
        self.reason = reason
        self.retry_after_seconds = retry_after_seconds
        self.result = result


class FlightProviderBase(ABC):
    name: str

    @abstractmethod
    def is_configured(self) -> bool: ...

    @abstractmethod
    def lookup(
        self, intent: FlightLookupRequest, *, timeout: float = 10
    ) -> list[FlightLookup]: ...

    def track(
        self, intent: FlightLookupRequest, *, timeout: float = 10
    ) -> list[FlightMovement]:
        raise FlightUnavailable(
            'Flight tracking is not configured', result='CONFIGURATION_ERROR'
        )


class DisabledFlightProvider(FlightProviderBase):
    name = 'none'

    def is_configured(self) -> bool:
        return False

    def lookup(
        self, intent: FlightLookupRequest, *, timeout: float = 10
    ) -> list[FlightLookup]:
        raise FlightUnavailable('Flight lookup is not configured')
