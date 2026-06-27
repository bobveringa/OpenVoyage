"""
Root test conftest.

Starts a PostgreSQL Testcontainer once per session, runs Alembic migrations,
and marks the resulting database as a PostgreSQL *template* so that each test
can cheaply ``CREATE DATABASE … TEMPLATE …`` instead of re-running migrations.
"""

from __future__ import annotations

import sys
import uuid
from collections.abc import Generator
from pathlib import Path

import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.engine import URL

# ---------------------------------------------------------------------------
# Path bootstrapping – keep imports stable regardless of CWD
# ---------------------------------------------------------------------------
BACKEND_ROOT = Path(__file__).resolve().parents[1]
APP_ROOT = BACKEND_ROOT / 'app'
TEST_ROOT = BACKEND_ROOT / 'tests'
for _p in (BACKEND_ROOT, APP_ROOT, TEST_ROOT):
    if str(_p) not in sys.path:
        sys.path.insert(0, str(_p))


# ---------------------------------------------------------------------------
# Testcontainers – one PostgreSQL container for the whole test-run
# ---------------------------------------------------------------------------
from testcontainers.postgres import PostgresContainer  # noqa: E402

# Template database name (immutable after migrations)
_TEMPLATE_DB = 'test_template'


@pytest.fixture(scope='session')
def pg_container() -> Generator[PostgresContainer, None, None]:
    """Start a PostGIS PostgreSQL container that lives for the entire session."""
    with PostgresContainer(
        image='postgis/postgis:18-3.6',
        username='test',
        password='test',
        dbname='postgres',
        driver='pg8000',
    ) as pg:
        yield pg


@pytest.fixture(scope='session')
def pg_admin_url(pg_container: PostgresContainer) -> URL:
    """Admin URL pointing at the default ``postgres`` database."""
    return URL.create(
        drivername='postgresql+pg8000',
        username=pg_container.username,
        password=pg_container.password,
        host=pg_container.get_container_host_ip(),
        port=int(pg_container.get_exposed_port(5432)),
        database='postgres',
    )


@pytest.fixture(scope='session')
def pg_template_db(pg_admin_url: URL) -> str:
    """
    Create the template database, run Alembic migrations once, then mark it
    as a template so ``CREATE DATABASE … TEMPLATE …`` is near-instant.

    Returns the template database name.
    """
    admin_engine = create_engine(pg_admin_url, isolation_level='AUTOCOMMIT')

    with admin_engine.connect() as conn:
        conn.execute(text(f'CREATE DATABASE "{_TEMPLATE_DB}"'))

    # Build a URL that points at the template DB for Alembic
    template_url = pg_admin_url.set(database=_TEMPLATE_DB)
    _run_alembic_migrations(template_url.render_as_string(hide_password=False))

    # Terminate any remaining connections and mark as template
    with admin_engine.connect() as conn:
        conn.execute(
            text(
                f'SELECT pg_terminate_backend(pid) '
                f'FROM pg_stat_activity '
                f"WHERE datname = '{_TEMPLATE_DB}' AND pid <> pg_backend_pid()"
            )
        )
        conn.execute(
            text(
                f'ALTER DATABASE "{_TEMPLATE_DB}" WITH is_template = true allow_connections = false'
            )
        )

    admin_engine.dispose()
    return _TEMPLATE_DB


def _run_alembic_migrations(database_url: str) -> None:
    """Run ``alembic upgrade head`` against the given database URL."""
    from alembic import command
    from alembic.config import Config

    alembic_ini = BACKEND_ROOT / 'alembic.ini'
    cfg = Config(str(alembic_ini))
    cfg.set_main_option('sqlalchemy.url', database_url)
    command.upgrade(cfg, 'head')


# ---------------------------------------------------------------------------
# Per-test isolated database (created from the template)
# ---------------------------------------------------------------------------
@pytest.fixture(scope='function')
def test_db_name() -> str:
    """Unique database name for a single test."""
    return f'test_{uuid.uuid4().hex[:12]}'


@pytest.fixture(scope='function')
def test_db_url(
    pg_admin_url: URL,
    pg_template_db: str,
    test_db_name: str,
) -> Generator[URL, None, None]:
    """
    Create a fresh database from the template before the test and drop it
    afterwards.  ``CREATE DATABASE … TEMPLATE …`` copies pages at the
    filesystem level — it's extremely fast.
    """
    admin_engine = create_engine(pg_admin_url, isolation_level='AUTOCOMMIT')

    with admin_engine.connect() as conn:
        conn.execute(
            text(f'CREATE DATABASE "{test_db_name}" TEMPLATE "{pg_template_db}"')
        )

    yield pg_admin_url.set(database=test_db_name)

    with admin_engine.connect() as conn:
        # Terminate stale connections before dropping
        conn.execute(
            text(
                f'SELECT pg_terminate_backend(pid) '
                f'FROM pg_stat_activity '
                f"WHERE datname = '{test_db_name}' AND pid <> pg_backend_pid()"
            )
        )
        conn.execute(text(f'DROP DATABASE IF EXISTS "{test_db_name}"'))

    admin_engine.dispose()


# ---------------------------------------------------------------------------
# Convenience fixtures used across all test types
# ---------------------------------------------------------------------------
@pytest.fixture(scope='session')
def api_prefix() -> str:
    from core.config import settings

    return settings.API_V1_STR
