"""Provider-independent flight lookup contract and errors."""

from abc import ABC, abstractmethod

from models.api.planning import FlightLookup, FlightLookupRequest


class FlightUnavailable(Exception):
    def __init__(self, reason='Flight lookup unavailable', retry_after_seconds=None):
        super().__init__(reason)
        self.reason = reason
        self.retry_after_seconds = retry_after_seconds


class FlightProviderBase(ABC):
    name: str

    @abstractmethod
    def is_configured(self) -> bool: ...

    @abstractmethod
    def lookup(
        self, intent: FlightLookupRequest, *, timeout: float = 10
    ) -> list[FlightLookup]: ...


class DisabledFlightProvider(FlightProviderBase):
    name = 'none'

    def is_configured(self) -> bool:
        return False

    def lookup(
        self, intent: FlightLookupRequest, *, timeout: float = 10
    ) -> list[FlightLookup]:
        raise FlightUnavailable('Flight lookup is not configured')
