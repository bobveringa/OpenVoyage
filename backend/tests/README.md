# Backend Test Architecture

This folder uses a layered pytest setup focused on speed, isolation, and contract confidence.

## Test Categories

- `unit`: Isolated tests for pure business logic in `services/` and `utils/`.
  - No real database calls.
  - External integrations are mocked (`puremagic`, `ffmpeg/ffprobe`, filesystem-heavy code, background tasks).
  - Target: fast feedback on every commit.

- `integration`: API and persistence tests for FastAPI routers.
  - Uses real DB schema created via Alembic migrations.
  - Exercises request/response contracts and DB interactions through `TestClient`.
  - Target: high confidence in endpoint behavior and schema compatibility.

## Database Strategy (Alembic + Postgres)

`tests/integration/conftest.py` provisions a temporary database per test session:

1. Create a random test database name.
2. Run `alembic upgrade head` against that test DB.
3. For each test, use an outer transaction + nested SAVEPOINT.
4. Roll back outer transaction after each test for isolation.
5. On session teardown, run `alembic downgrade base` and drop the DB.

This combines migration realism with fast per-test cleanup.

## Fixture Layers

- `tests/conftest.py`
  - Import path bootstrap.
  - Shared API prefix fixture.

- `tests/integration/conftest.py`
  - Temporary DB lifecycle.
  - Alembic migration setup.
  - Transactional `db_session` fixture.
  - FastAPI `client` fixture with dependency override for `get_db`.

- `tests/unit/conftest.py`
  - Lightweight mocks (`fake_db`, `fake_background_tasks`).

## Factories

Reusable builders live in `tests/factories/`:

- `create_user(...)`
- `create_media(...)`

Use them in integration tests for concise setup.

## Running Tests

Flight unit tests mock the provider and HTTP responses; no real flight provider or
API key is required. Ordinary integration tests also stub flight lookups and
disable the application's background flight monitor. Database integration tests
require Docker for their temporary PostGIS database.

Only these explicitly enabled flight tests make real, potentially billable
FlightAware requests and require `FLIGHTAWARE_API_KEY` in the environment or root
`.env`:

- `tests/integration/services/test_flightaware_live.py`: set `RUN_LIVE_FLIGHTAWARE_TESTS=1`.
- `tests/integration/services/test_flight_live.py`: set `RUN_LIVE_FLIGHT_TESTS=1`.

Both modules skip by default. Mocked flight numbers are fixed synthetic examples
using airlines outside Europe; the opt-in live checks use QF12 and NZ6, which must
operate on the requested dates. Do not replace mocked examples with personal trips.

```powershell
cd C:\Users\BobVe\PycharmProjects\TravelBlog\backend
python -m pytest -m unit
python -m pytest -m integration
python -m pytest
```

## Coverage

Coverage is enabled in `pytest.ini` via `--cov=app --cov-report=term-missing`.
Increase strictness later by adding a threshold:

```ini
addopts = -ra --strict-markers --cov=app --cov-report=term-missing --cov-fail-under=85
```

