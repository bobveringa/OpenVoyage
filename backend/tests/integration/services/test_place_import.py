from unittest.mock import Mock

from sqlalchemy import select

from factories.locations import create_location
from factories.places import create_place
from factories.trips import create_trip
from factories.users import create_user
from models.database.places import Place
from services import place_service
from services.place_service import GeoNamesDataset, PlaceService


def test_replace_large_geonames_dataset_preserves_imported_and_referenced_places(
    db_session, monkeypatch, tmp_path
):
    imported = create_place(db_session, external_id='0')
    stale = create_place(db_session, external_id='stale')
    referenced = create_place(db_session, external_id='referenced')
    airport = create_place(db_session, external_id='airport')
    custom = create_place(db_session, external_id='custom')
    airport.feature_code = 'AIRP'
    for place in (imported, stale, referenced, airport):
        place.external_source = 'geonames'
    db_session.commit()

    user = create_user(db_session)
    trip = create_trip(db_session, owner_id=user.id)
    location = create_location(db_session, trip_id=trip.id, created_by=user.id)
    location.source_place_id = referenced.id
    db_session.commit()

    # Exercise real parsing and cleanup above PostgreSQL's bind parameter limit.
    # Upserts are covered separately; only the cleanup needs this many IDs.
    count = 65_536
    monkeypatch.setattr(
        place_service,
        '_iter_geonames_rows',
        lambda path: (
            [
                str(i), 'City', 'City', '', '52.3', '4.7', 'P', 'PPL',
                'NL', '', '07', '', '', '', '1', '', '',
                'Europe/Amsterdam', '2026-10-20',
            ]
            for i in range(count)
        ),
    )
    service = PlaceService(db_session)
    monkeypatch.setattr(service, '_upsert_places', Mock())
    expected_ids = {place.id for place in (imported, referenced, airport, custom)}

    result = service.import_geonames_zip(
        tmp_path / 'cities1000.zip',
        GeoNamesDataset.CITIES_1000,
        replace_existing=True,
    )

    assert result.processed == count
    assert result.deleted == 1
    assert set(db_session.scalars(select(Place.id))) == expected_ids
    db_session.refresh(location)
    assert location.source_place_id == referenced.id
