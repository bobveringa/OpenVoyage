from __future__ import annotations

from collections.abc import Generator

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.engine import URL, Engine
from sqlalchemy.orm import Session

from api.deps import get_db
from api.deps import route_provider_factory
from main import app
from services.app_settings_service import app_settings_cache


@pytest.fixture(scope='function', autouse=True)
def reset_process_settings_state() -> Generator[None, None, None]:
    app_settings_cache.clear()
    route_provider_factory.reset_cache()
    yield
    app_settings_cache.clear()
    route_provider_factory.reset_cache()


@pytest.fixture(scope='function')
def engine(test_db_url: URL) -> Generator[Engine, None, None]:
    """Engine bound to the per-test isolated database."""
    eng = create_engine(test_db_url)
    try:
        yield eng
    finally:
        eng.dispose()


@pytest.fixture(scope='function')
def db_session(engine: Engine) -> Generator[Session, None, None]:
    """Plain session – each test gets its own database so no rollback tricks needed."""
    with Session(bind=engine) as session:
        yield session


@pytest.fixture(scope='function')
def client(db_session: Session) -> Generator[TestClient, None, None]:
    def override_get_db() -> Generator[Session, None, None]:
        yield db_session

    app.dependency_overrides[get_db] = override_get_db
    with TestClient(app) as test_client:
        yield test_client
    app.dependency_overrides.clear()
