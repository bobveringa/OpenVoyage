# Flight providers

Itinerary services receive a `FlightProviderBase` through `get_flight_provider`.
Adapters return normalized `FlightLookup` objects and raise `FlightUnavailable`
for provider failures. Credentials and raw provider payloads stay on the server.

Administrators configure flight lookup and automatic monitoring under **Admin → Routing**:

| Setting | Default | Purpose |
| --- | --- | --- |
| `flights.provider` | `none` | Select an adapter to enable lookup and monitoring, or `none` to disable both. |
| `flights.update_frequency` | `balanced` | Named preset for adaptive checks around departure and arrival. |
| `flights.aerodatabox_base_url` | `https://aerodatabox.p.rapidapi.com` | AeroDataBox-compatible endpoint, optionally including a path prefix. |
| `flights.aerodatabox_rapidapi_host` | `aerodatabox.p.rapidapi.com` | `X-RapidAPI-Host` request header. |
| `flights.rapidapi_api_key` | Unconfigured | Existing encrypted, write-only AeroDataBox RapidAPI key. |
| `flights.flightaware_base_url` | `https://aeroapi.flightaware.com/aeroapi` | FlightAware AeroAPI v4 endpoint. |
| `flights.flightaware_api_key` | Unconfigured | Encrypted, write-only AeroAPI key sent as `x-apikey`. |

The URL and host settings do not change the response format the adapter expects.
A different flight API requires its own adapter. Lookup is disabled until an
administrator selects a provider. Existing keys and explicit provider selections
are preserved. Changes apply to new planning
requests through the app settings cache without restarting the backend (other
worker processes may take up to the cache TTL, currently 60 seconds). Saved
flight schedules and unexpired candidates remain available after disabling lookup.

Select `flightaware` for FlightAware AeroAPI. Like AeroDataBox, production uses
the encrypted admin key. `FLIGHTAWARE_API_KEY` in the root `.env` is a local live-test
credential; copy its value into **Admin → Routing → FlightAware AeroAPI key** to
enable the running application. Setting the provider to `none` always disables calls.

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

The **Flight update frequency** slider in Admin → Routing offers five named presets.
The same preset controls when monitoring starts, routine pre-departure checks,
checks during the final 15 minutes before departure and while still awaiting takeoff,
and checks near arrival. A delayed estimate never postpones checks beyond the
original departure. Cruise checks remain every 30 minutes. Checks are capped at
phase boundaries so an infrequent interval cannot skip the more attentive window.

| Preset | Start before departure | Routine ground | Imminent/overdue departure | Arrival window | Near-arrival interval |
| --- | --- | --- | --- | --- | --- |
| Minimal | 30 min | 30 min | 30 min | 30 min | 30 min |
| Relaxed | 45 min | 20 min | 15 min | 30 min | 15 min |
| Balanced | 60 min | 20 min | 10 min | 30 min | 10 min |
| Frequent | 90 min | 15 min | 5 min | 45 min | 5 min |
| Very frequent | 120 min | 10 min | 5 min | 60 min | 5 min |

The dedicated monitor starts with the application, attempts a cycle immediately,
and waits 60 seconds after each cycle. A PostgreSQL session advisory lock on a
dedicated `NullPool` connection admits one owner per database; other processes
stand by. Monitoring bypasses the settings cache using a consistent raw snapshot,
decrypting only the selected provider's credentials. Provider `none` skips polling
and reconciliation without altering schedules, recordings, or saved facts.
Preset changes reschedule unchecked flights and successful pending checks on the
next enabled cycle. Rate-limit backoff is preserved. Settings changes and resets
serialize with configuration-error application so an old request cannot undo a
credential fix. Changes take effect after current work and the heartbeat delay.
The heartbeat is an idle delay, not a freshness or failover guarantee.

Flight tracking no longer has Jobs controls or execution rows. A selected provider
enables monitoring even when the legacy job was disabled; its old cron is ignored.
Stop all old processes before migrating and starting the new version. See
[deployment, rollback, shutdown and logging notes](../../../../docs/flight-monitor-release-notes.md).

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
