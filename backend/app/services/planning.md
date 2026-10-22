# Trip connections

The itinerary owns the topology: connections join adjacent stops, with optional
departure and return connections to locations outside those stops.

## Responsibilities

- `ItineraryService` authorizes access, locks the trip for revision checks,
  manages topology, and coordinates previews and saves.
- `PlanningService` resolves intent and endpoints, prepares automatic defaults,
  persists segments, and builds connection responses.
- `RouteCalculator` performs bounded provider calls without database access.
- `PlanningArtifactStore` stores and validates actor-owned previews and flight
  candidates against their trip, connection, inputs, revision, and expiry.
- `ConnectionDraft` and `ResolvedSegment` describe temporary state explicitly.
- `select_route` applies the same option selection in preview and persistence.
  Preview options keep their original order even when an alternative is selected.

Provider work happens outside the trip lock. After calculation, authorization,
revision, and resolved inputs are checked again before saving an artifact or route.

## API contracts

Connection endpoints live under `/trips/{trip_id}/itinerary/connections`.
Itinerary and map overview collections use `connections`; stop details use
`incoming_connection` and `outgoing_connection`.

Creating, replacing, or refreshing a connection returns:

```json
{
  "itinerary_revision": 7,
  "connection": { "id": "...", "segments": [] }
}
```

The existing ETag also carries that revision. Stop mutations and connection
deletion return the full itinerary with its revision. Mutations require the
quoted revision in `If-Match`.

Errors share `detail.code`, `detail.message`, optional `detail.segment_id`,
`detail.connections`, and `detail.validation_errors`. Request validation issues
contain `location`, `message`, and `type`. Warnings contain `code`, `message`,
and an optional `segment_id`. These contracts are documented in OpenAPI.

Removing customized connections requires retrying the same revision with
`confirm_connection_deletion=true` after user confirmation.

Stop creation, editing, and deletion never call providers during persistence.
The frontend then calculates newly created or invalidated road connections,
serially using each returned revision. Unchanged pending connections and
metadata-only edits do not trigger calculation.

The public map overview continues to expose only its explicit allowlist;
structured warnings, notes, schedules, and other planning details stay private.

## Schema and generated clients

Migration `f2a4c6e8b013` renames the existing connection table and foreign-key
columns in place. It supports downgrade without replacing existing rows.
Historical migrations retain their original schema names.

After changing API models, run `npm run api:generate` in `frontend/`.
