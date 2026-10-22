from pathlib import Path

import pytest
from alembic import command
from alembic.config import Config
from sqlalchemy import select, text
from models.database.itinerary import (
    ItineraryConnection,
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
    _, _, _, _, _, connection, data = plan
    connection_id = connection['id']
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
            {'mode': old_mode, 'notes': 'Keep connection notes', 'id': connection_id},
        )
        connection.execute(
            text('UPDATE locations SET latitude=-33.92, longitude=18.42 WHERE id=:id'),
            {'id': location_id},
        )
    command.upgrade(config, 'head')
    db_session.expire_all()
    connection = db_session.get(ItineraryConnection, connection_id)
    assert connection.notes == 'Keep connection notes'
    segments = list(
        db_session.scalars(
            select(ItineraryTravelSegment).where(
                ItineraryTravelSegment.connection_id == connection_id
            )
        )
    )
    assert len(segments) == 1
    assert segments[0].travel_mode == expected_mode
    assert segments[0].mode_source == source
    assert db_session.scalar(select(ItinerarySegmentRoute)) is None


def test_connection_rename_round_trip_preserves_rows_and_relationships(engine, db_session, plan):  # noqa: F811
    from datetime import timedelta
    import uuid
    from models.database.base import utcnow
    from models.database.itinerary import ItineraryPlanningArtifact

    user, trip, _, _, revision, connection, _ = plan
    artifact_id = uuid.uuid4()
    db_session.add(ItineraryPlanningArtifact(
        id=artifact_id, kind='PREVIEW', trip_id=trip.id,
        connection_id=uuid.UUID(connection['id']), created_by_user_id=user.id,
        itinerary_revision=int(revision.strip('"')), input_hash='a' * 64,
        payload={'preserved': True}, expires_at=utcnow() + timedelta(days=1),
    ))
    db_session.commit()
    root = Path(__file__).resolve().parents[3]
    config = Config(str(root / 'alembic.ini'))
    config.set_main_option('script_location', str(root / 'app/alembic'))
    config.set_main_option('sqlalchemy.url', engine.url.render_as_string(hide_password=False))
    command.downgrade(config, 'e4b8c2d6f103')
    with engine.connect() as sql:
        assert str(sql.scalar(text('SELECT leg_id FROM itinerary_planning_artifacts WHERE id=:id'), {'id': artifact_id})) == connection['id']
        assert sql.scalar(text('SELECT count(*) FROM itinerary_travel_legs')) == 1
    command.upgrade(config, 'head')
    db_session.expire_all()
    artifact = db_session.get(ItineraryPlanningArtifact, artifact_id)
    assert str(artifact.connection_id) == connection['id']
    assert artifact.payload == {'preserved': True}
    persisted = db_session.get(ItineraryConnection, uuid.UUID(connection['id']))
    assert str(persisted.segments[0].id) == connection['segments'][0]['id']
