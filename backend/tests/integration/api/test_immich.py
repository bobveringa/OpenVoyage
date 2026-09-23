import uuid

import pytest

from core import security
from factories.users import create_user
from models.database.immich import UserImmichConnection
from services.immich_service import FEATURE_DISABLED_DETAIL


def _auth_headers(user) -> dict[str, str]:
    tokens = security.create_auth_tokens(subject=user.id, email=user.email)
    return {'Authorization': f'Bearer {tokens["access_token"]}'}


@pytest.mark.integration
@pytest.mark.parametrize(
    ('method', 'path', 'json_body'),
    [
        ('get', '/users/me/immich', None),
        ('post', '/users/me/immich/test', {'server_url': 'https://photos.example.com', 'api_key': 'secret'}),
        ('put', '/users/me/immich', {'server_url': 'https://photos.example.com', 'api_key': 'secret'}),
        ('delete', '/users/me/immich', None),
        ('get', '/users/me/immich/albums', None),
        ('get', f'/trips/{uuid.uuid4()}/immich/albums', None),
        ('post', f'/trips/{uuid.uuid4()}/immich/albums', {'album_id': str(uuid.uuid4())}),
        ('delete', f'/trips/{uuid.uuid4()}/immich/albums/{uuid.uuid4()}', None),
        ('get', f'/trips/{uuid.uuid4()}/immich/albums/{uuid.uuid4()}/assets?page=1', None),
        ('get', f'/trips/{uuid.uuid4()}/immich/albums/{uuid.uuid4()}/assets/{uuid.uuid4()}/thumbnail', None),
        ('get', f'/trips/{uuid.uuid4()}/immich/albums/{uuid.uuid4()}/assets/{uuid.uuid4()}/display-image', None),
        ('post', f'/trips/{uuid.uuid4()}/immich/albums/{uuid.uuid4()}/imports', {'asset_id': str(uuid.uuid4())}),
    ],
)
def test_every_immich_route_is_disabled_by_default(
    client,
    db_session,
    api_prefix,
    method,
    path,
    json_body,
) -> None:
    user = create_user(db_session, password='UserPass123!')

    response = client.request(
        method.upper(),
        f'{api_prefix}{path}',
        headers=_auth_headers(user),
        json=json_body,
    )

    assert response.status_code == 403
    assert response.json() == {'detail': FEATURE_DISABLED_DETAIL}
    assert db_session.get(UserImmichConnection, user.id) is None
