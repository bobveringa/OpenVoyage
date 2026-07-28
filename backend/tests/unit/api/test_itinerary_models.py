from datetime import date

from models.api.itinerary import is_itinerary_stop_visited


def test_itinerary_stop_is_visited_on_departure_date() -> None:
    today = date(2026, 7, 28)

    assert is_itinerary_stop_visited(
        planned_start_date=date(2026, 7, 28),
        planned_nights=0,
        today=today,
    )
    assert is_itinerary_stop_visited(
        planned_start_date=date(2026, 7, 27),
        planned_nights=1,
        today=today,
    )
    assert not is_itinerary_stop_visited(
        planned_start_date=date(2026, 7, 28),
        planned_nights=1,
        today=today,
    )
    assert not is_itinerary_stop_visited(
        planned_start_date=date(2026, 7, 29),
        planned_nights=0,
        today=today,
    )
