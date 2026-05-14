from __future__ import annotations

import pytest

from api.routers.login import _authenticate_user
from factories.users import create_user


@pytest.mark.integration
def test_authenticate_user_returns_none_when_user_missing(db_session) -> None:
    user = _authenticate_user(
        session=db_session, email='missing@example.com', password='x'
    )
    assert user is None


@pytest.mark.integration
def test_authenticate_user_rehashes_password_when_needed(
    db_session, monkeypatch
) -> None:
    create_user(db_session, email='exists@example.com', password='original')

    from core import security

    monkeypatch.setattr(
        security, 'verify_password', lambda _plain, _hash: (True, 'new_hash')
    )

    user = _authenticate_user(
        session=db_session, email='exists@example.com', password='x'
    )

    assert user is not None
    assert user.password_hash == 'new_hash'
