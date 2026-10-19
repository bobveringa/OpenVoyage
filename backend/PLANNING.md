# Planning segments

Adjacent-stop connections contain 1–20 ordered segments. User intent, road calculations and matched flight schedules are stored separately. The alpha migration preserves trips, stops, locations and connection notes; old generated routes can be calculated again.

## Upgrade reference data

From backend/, using the project Python environment:

    python -m alembic upgrade head
    python scripts/import_airports.py

The second command streams GeoNames reference data, imports airports and IATA/ICAO codes, and backfills IANA time zones on all matching existing places, including cities. It preserves UUIDs and does not import every feature from the full dump just to fill time zones. Missing or invalid zones remain null. Subsequent GeoNames jobs refresh reference data. The schema migration makes no network requests.

## Optional providers

Administrators configure Routing → Flights · AeroDataBox → AeroDataBox RapidAPI key in the admin panel. The existing settings service encrypts this secret, redacts it from admin responses and excludes it from public settings. Resetting the setting disables new lookups without deleting saved schedules. This flight setting does not require a server restart.

Flight numbers, departure dates, manual airports, notes and mixed journeys remain editable without a flight key. Scheduled durations require a usable lookup match. GraphHopper routing is independently configured through its existing admin settings.

The application does not read a production flight credential from .env. The opt-in live test uses .env RAPIDAPI_API_KEY to populate the encrypted setting in a disposable database, then checks configured and unconfigured behavior:

    $env:RUN_LIVE_FLIGHT_TESTS = '1'
    python -m pytest tests/integration/services/test_flight_live.py
    Remove-Item Env:RUN_LIVE_FLIGHT_TESTS

This test makes a dated KL597 lookup and consumes provider units. Ordinary tests mock providers and do not require keys.

## Calculation behavior

- New connections suggest Flight from 1,000 km straight-line distance or an already available matching driving estimate of at least 12 hours; otherwise Car. Defaults make no provider calls. Explicit choices survive later edits.
- Opening a road route chooser, selecting a road mode, Preview and manual Retry calculate routes. Road previews request up to three distinct GraphHopper alternatives (a via point uses a single route). Choosing a card updates the map locally; saving adopts the exact server-held option. Missing road calculations draw no pretend road line. Flight and unsupported transit connections are dashed approximations. Reads and saves do not call providers. Canceling a preview creates no saved trip locations.
- Each calculation has at most two simultaneous calls, a 10-second call timeout and a 30-second overall calculation deadline. Completed results survive partial failures. Provider-producing actions are locally throttled to 20 per minute per editor/trip, with one active request per editor/trip in each process. No work is queued.
- Unsupported modes use approximate geometry. Mixed flight/ground journeys have no combined total. Complete flight-only chains include layovers and compare offset-aware instants in UTC.
- Revision checks, scoped expiring artifacts and effective-input hashes protect current travel from stale results. Network requests run outside database transactions.
- Removing selected travel requires confirmation against the current revision. Leaving a trip revokes temporary artifacts while saved travel remains trip-owned. Account deletion separately clears provider snapshots owned by that account.
