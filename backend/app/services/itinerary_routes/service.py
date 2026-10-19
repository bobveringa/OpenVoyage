from services.planning_service import PlanningService
from services.location_service import LocationService
from services.place_service import PlaceService


class ItineraryRouteService(PlanningService):
    def __init__(
        self, *, db, route_provider=None, background_tasks=None, flight_provider=None
    ):
        super().__init__(
            db, LocationService(db, PlaceService(db)), route_provider, flight_provider
        )

    def invalidate(self, leg):
        # Reads independently check effective-input hashes, including inherited endpoints.
        for resolved in self.build(leg):
            row = next(s for s in leg.segments if s.id == resolved.id)
            if row.route and row.route.input_hash != resolved.input_hash:
                row.input_version += 1
                row.route = None
