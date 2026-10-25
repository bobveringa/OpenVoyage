# Flight providers

Itinerary services receive a `FlightProviderBase` through `get_flight_provider`.
Adapters return normalized `FlightLookup` objects and raise `FlightUnavailable`
for provider failures. Credentials and raw provider payloads stay on the server.

Administrators configure flight lookup and automatic monitoring under **Admin → Routing**:

| Setting | Default | Purpose |
| --- | --- | --- |
| `flights.provider` | `none` | Select an adapter to enable lookup and monitoring, or `none` to disable both. |
| `flights.check_interval_minutes` | `30` | Check every 5, 10, 15, 30 or 60 minutes during flight. |
| `flights.check_more_often_before_departure` | `true` | Check at least every 10 minutes on the ground. |
| `flights.flightaware_base_url` | `https://aeroapi.flightaware.com/aeroapi` | FlightAware AeroAPI v4 endpoint. |
| `flights.flightaware_api_key` | Unconfigured | Encrypted, write-only AeroAPI key sent as `x-apikey`. |

Select `flightaware` to use FlightAware AeroAPI with the encrypted admin key.
`FLIGHTAWARE_API_KEY` in the root `.env` is only a local live-test credential;
production reads the write-only admin setting. `none` disables requests.
The migration removes AeroDataBox settings and credentials and changes its selection
to `none`. Saved schedules and history keep their original metadata.

The adapter accepts IATA and ICAO flight numbers (including `w6 4514` and `FR5682`)
and codeshares, and matches the scheduled departure's date in the origin timezone.
Lookup uses gate schedules, `/schedules` for dates beyond tomorrow, and `/history/flights`
for older dates. Availability depends on the AeroAPI subscription and schedule coverage.
Tracking uses actual runway departure/arrival, never estimates or gate departure as
confirmation of flight. Airport metadata is resolved by exact IATA/ICAO code from local
places first, for both lookup and tracking. Missing, ambiguous, or incomplete local
airports fall back to AeroAPI. Import airport reference data to populate local coverage.
Public AeroAPI airport metadata is cached for six hours per backend process and API base URL;
the whole operation shares a ten-second timeout and limits supplementary requests.
Requests fetch one page and never automatically retry billable calls. Rate limits
and credential failures use the existing provider failure/backoff behavior.

Checks begin one hour before the earlier of scheduled and estimated departure.
With **Check more often before departure** enabled, ground checks use the shorter
of ten minutes and the selected interval. A delayed estimate cannot postpone this
window. Confirmed departure switches to the selected interval for the entire flight.
Changing cadence reschedules future checks without an immediate extra request;
provider backoff takes precedence.

Ground checks fetch status only. Airborne checks also fetch
`/flights/{fa_flight_id}/track?include_estimated_positions=false&include_surface_positions=false`.
Observed points retain their provider timestamps and merge by timestamp, with the
latest valid correction winning. Shorter or failed responses cannot erase history
or move the marker backward. The observed route is solid; the local remaining arc
is dashed. Without observations the existing time-based arc remains available.
Flight positions and paths bypass privacy zones, including owner edits. Normal
trip access, live sharing and published-post boundaries still apply.

Arrival is saved before fetching the final track. Final retrieval is separate,
persisted work: at most three attempts including the arrival check, with a six-hour
deadline from arrival confirmation. Attempts are reserved before HTTP, survive
restarts, use the selected cadence and respect quota backoff. A nonempty response
settles history immediately; configuration errors and exhaustion stop retries.
Failed final retrieval keeps retained points or a usable arc fallback. Owner edits,
deletion, manual completion and manual/next-flight stops cancel pending retrieval;
results recheck that cancellation under the trip lock before applying.

The dedicated monitor starts with the application, attempts a cycle immediately,
and waits 60 seconds after each cycle. A PostgreSQL session advisory lock on a
dedicated `NullPool` connection admits one owner per database; other processes
stand by. Monitoring bypasses the settings cache using a consistent raw snapshot,
decrypting only the selected provider's credentials. Provider `none` skips polling
and reconciliation without altering schedules, recordings, or saved facts.
Cadence changes reschedule successful pending checks. Rate-limit backoff is preserved. Settings changes and resets
serialize with configuration-error application so an old request cannot undo a
credential fix. Changes take effect after current work and the heartbeat delay.
The heartbeat is an idle delay, not a freshness or failover guarantee.

Flight tracking no longer has Jobs controls or execution rows. A selected provider
enables monitoring even when the legacy job was disabled; its old cron is ignored.
Stop all old processes before migrating and starting the new version. Observed recordings and pending final retrieval must be removed or settled before downgrading the schema.

Manual lookups are unaffected. Actual GPS history stays visible in Travel; gray
guidance replaces only the current leg, and later airport transfers remain planned
until their flight lands. Plan always retains the complete itinerary.

Opt-in live checks (billable) read the environment key without persisting it:
`RUN_LIVE_FLIGHTAWARE_TESTS=1 python -m pytest tests/integration/services/test_flightaware_live.py`
from `backend/`. These example flights must operate on the current date.
API reference: https://www.flightaware.com/aeroapi/portal/documentation

To add an API:

1. Implement `FlightProviderBase` in a new module, with a stable `name`, an
   `is_configured()` check, and `lookup(intent, timeout=...)`. Return `FlightLookup`
   objects with your provider name, airport snapshots, timezone-aware scheduled
   times when available, and a UTC fetch time. Respect the timeout and bound
   response sizes; translate failures into `FlightUnavailable` without secrets.
2. Register any endpoint and credential settings in `core.app_settings`. Keep
   them admin-only and use secret settings for credentials.
3. Add the provider name to the `flights.provider` choices and its construction
   to `FlightProviderFactory`. Keep API-specific parsing inside the adapter.
4. Add its admin setting labels and group to `frontend/src/components/admin/admin-sections.tsx`,
   and update flight attribution in the frontend when adding another source.
5. Add adapter and factory tests. The itinerary services need no provider-specific
   changes. If the API contract changes, run `npm run api:generate` in `frontend/`.
