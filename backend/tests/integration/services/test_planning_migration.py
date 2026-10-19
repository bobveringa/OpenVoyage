from pathlib import Path

import pytest
from alembic import command
from alembic.config import Config
from sqlalchemy import select, text
from models.database.itinerary import (
    ItineraryTravelLeg,
    ItineraryTravelSegment,
    ItinerarySegmentRoute,
)
from integration.services.test_itinerary_route_service import plan  # noqa: F401


@pytest.mark.parametrize(
    'old_mode,expected_mode,source',
    [('CAR', 'CAR', 'USER'), ('UNKNOWN', 'FLIGHT', 'AUTO')],
)
def test_upgrade_preserves_alpha_intent_without_provider_calls(
    engine, db_session, plan, old_mode, expected_mode, source  # noqa: F811
):
    _, _, _, _, _, leg, data = plan
    leg_id = leg['id']
    location_id = data['stops'][-1]['location']['id']
    db_session.commit()
    config = Config(str(Path(__file__).resolve().parents[3] / 'alembic.ini'))
    config.set_main_option(
        'script_location', str(Path(__file__).resolve().parents[3] / 'app/alembic')
    )
    config.set_main_option(
        'sqlalchemy.url', engine.url.render_as_string(hide_password=False)
    )
    command.downgrade(config, 'b6d8e0f2a491')
    with engine.begin() as connection:
        connection.execute(
            text(
                'UPDATE itinerary_travel_legs SET travel_mode=:mode, notes=:notes WHERE id=:id'
            ),
            {'mode': old_mode, 'notes': 'Keep connection notes', 'id': leg_id},
        )
        connection.execute(
            text('UPDATE locations SET latitude=-33.92, longitude=18.42 WHERE id=:id'),
            {'id': location_id},
        )
    command.upgrade(config, 'head')
    db_session.expire_all()
    connection = db_session.get(ItineraryTravelLeg, leg_id)
    assert connection.notes == 'Keep connection notes'
    segments = list(
        db_session.scalars(
            select(ItineraryTravelSegment).where(
                ItineraryTravelSegment.leg_id == leg_id
            )
        )
    )
    assert len(segments) == 1
    assert segments[0].travel_mode == expected_mode
    assert segments[0].mode_source == source
    assert db_session.scalar(select(ItinerarySegmentRoute)) is None
