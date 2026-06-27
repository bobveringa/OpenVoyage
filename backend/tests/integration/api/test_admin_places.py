from __future__ import annotations

from unittest.mock import Mock

import pytest

from api.deps import get_place_service
from core import security
from factories.users import create_user
from main import app
from models.database.user import UserRole
from services.place_service import GeoNamesDataset, PlaceImportResult


def _auth_headers(user) -> dict[str, str]:
    tokens = security.create_auth_tokens(subject=user.id, email=user.email)
    return {'Authorization': f'Bearer {tokens["access_token"]}'}


@pytest.mark.integration
def test_import_places_requires_admin(client, db_session, api_prefix) -> None:
    user = create_user(db_session, password='AdminPass123!')

    response = client.post(
        f'{api_prefix}/admin/places/import',
        headers=_auth_headers(user),
        json={'dataset': 'cities500'},
    )

    assert response.status_code == 403


@pytest.mark.integration
def test_import_places_triggers_place_service(client, db_session, api_prefix) -> None:
    admin = create_user(
        db_session,
        password='AdminPass123!',
        role=UserRole.ADMIN,
    )
    place_service = Mock()
    place_service.import_geonames_dataset.return_value = PlaceImportResult(
        dataset=GeoNamesDataset.CITIES_500,
        processed=2,
    )
    app.dependency_overrides[get_place_service] = lambda: place_service

    response = client.post(
        f'{api_prefix}/admin/places/import',
        headers=_auth_headers(admin),
        json={'dataset': 'cities500'},
    )

    assert response.status_code == 200
    assert response.json() == {
        'dataset': 'cities500',
        'processed': 2,
    }
    place_service.import_geonames_dataset.assert_called_once_with(
        dataset=GeoNamesDataset.CITIES_500
    )
