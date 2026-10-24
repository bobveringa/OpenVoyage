# OpenVoyage agent guidance

## Code map

- `backend/app/`: FastAPI application; `backend/tests/`: pytest tests.
- `frontend/src/`: React and TypeScript application.

## Rules

- Preserve privacy and access rules for trips, shared links, GPS tracks, and media. Add regression tests when changing them.
- Regenerate frontend API files with `npm run api:generate` after API contract changes; do not edit generated files directly.
- Artifacts from debugging (e.g. screenshots, logs, etc.) should be stored in `private/artifacts/<name>`

## Checks

- Lint: run `python -m ruff check backend` from the root.
- Backend: run `python -m pytest` from `backend/`.
- Frontend: run `npm run test:unit` and `npm run test:e2e` from `frontend/`.
- Checks are optional for documentation.

