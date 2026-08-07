from __future__ import annotations

import logging
import uuid
from types import SimpleNamespace
from unittest.mock import Mock

from models.api.itinerary import ItineraryRouteType
from models.database.itinerary import ItineraryTravelRouteStatus
from services.itinerary_routes.resolver import ItineraryRouteResolver


def test_invalid_provider_geometry_logs_warning_and_returns_simple_route(
    caplog,
) -> None:
    leg_id = uuid.uuid4()
    from_location = SimpleNamespace(longitude=5.4697, latitude=51.4416)
    to_location = SimpleNamespace(longitude=5.1214, latitude=52.0907)
    leg = SimpleNamespace(
        id=leg_id,
        from_stop=SimpleNamespace(location=from_location),
        to_stop=SimpleNamespace(location=to_location),
    )
    route = SimpleNamespace(
        id=leg_id,
        status=ItineraryTravelRouteStatus.READY,
        geometry_geojson={'type': 'LineString', 'coordinates': [[5.4697]]},
        distance_meters=123,
        duration_seconds=456,
    )
    db = Mock()
    db.get.return_value = route

    with caplog.at_level(
        logging.WARNING,
        logger='services.itinerary_routes.resolver',
    ):
        response = ItineraryRouteResolver(db).response_for_leg(leg)

    assert response.type == ItineraryRouteType.SIMPLE
    assert response.geometry.coordinates == [
        (from_location.longitude, from_location.latitude),
        (to_location.longitude, to_location.latitude),
    ]
    assert 'Invalid provider route geometry' in caplog.text
