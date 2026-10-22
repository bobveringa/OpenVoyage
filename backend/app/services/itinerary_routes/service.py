from services.planning_service import PlanningService
from services.location_service import LocationService
from services.place_service import PlaceService
from services.flight_providers import FlightProviderBase


class ItineraryRouteService(PlanningService):
    def __init__(
        self,
        *,
        db,
        route_provider=None,
        flight_provider: FlightProviderBase | None = None,
    ):
        super().__init__(
            db, LocationService(db, PlaceService(db)), route_provider, flight_provider
        )

    def invalidate(self, connection):
        # Reads independently check effective-input hashes, including inherited endpoints.
        for resolved in self.build(connection):
            row = next(s for s in connection.segments if s.id == resolved.id)
            if row.route and row.route.input_hash != resolved.input_hash:
                row.input_version += 1
                row.route = None
