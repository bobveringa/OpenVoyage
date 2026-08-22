from __future__ import annotations

from collections.abc import Generator

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.engine import URL, Engine
from sqlalchemy.orm import Session

import core.db
from api.deps import get_db
from api.deps import route_provider_factory
from jobs.runner import JobRunner
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
def engine(
    test_db_url: URL, monkeypatch: pytest.MonkeyPatch
) -> Generator[Engine, None, None]:
    """
    Engine bound to the per-test isolated database.

    It also replaces the process-wide engine, because ``get_db`` is not the
    only way into the database: the lifespan job runtime and the background
    thumbnail task build their own sessions from ``core.db.get_engine``, and
    that engine is built from the POSTGRES_* settings. Leaving it alone means
    the suite needs a configured database next to the Testcontainer, and
    quietly writes to it when there is one.
    """
    eng = create_engine(test_db_url)
    monkeypatch.setattr(core.db, '_engine', eng)
    try:
        yield eng
    finally:
        eng.dispose()


@pytest.fixture(scope='function', autouse=True)
def idle_job_runner(monkeypatch: pytest.MonkeyPatch) -> None:
    """
    Keep the lifespan job runtime from executing work behind the test.

    Starting the app bootstraps the scheduled jobs and queues every one that
    has never succeeded. A per-test database is always in that state, so each
    test would otherwise kick off the GeoNames import — a dataset download —
    on a background thread. Queuing still happens, and the scheduler still
    reports next run times; only the thread that would run the work stays down.
    """
    monkeypatch.setattr(JobRunner, 'start', lambda self: None)


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
