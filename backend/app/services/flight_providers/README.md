# Flight providers

Itinerary services receive a `FlightProviderBase` through `get_flight_provider`.
Adapters return normalized `FlightLookup` objects and raise `FlightUnavailable`
for provider failures. Credentials and raw provider payloads stay on the server.

Administrators configure flight lookup under **Admin → Routing**:

| Setting | Default | Purpose |
| --- | --- | --- |
| `flights.provider` | `aerodatabox` | Select an adapter, or `none` to disable lookup. |
| `flights.aerodatabox_base_url` | `https://aerodatabox.p.rapidapi.com` | AeroDataBox-compatible endpoint, optionally including a path prefix. |
| `flights.aerodatabox_rapidapi_host` | `aerodatabox.p.rapidapi.com` | `X-RapidAPI-Host` request header. |
| `flights.rapidapi_api_key` | Unconfigured | Existing encrypted, write-only AeroDataBox RapidAPI key. |

The URL and host settings do not change the response format the adapter expects.
A different flight API requires its own adapter. Defaults preserve existing
installations and keys; no database migration is needed. Changes apply to new
requests through the app settings cache without restarting the backend (other
worker processes may take up to the cache TTL, currently 60 seconds). Saved
flight schedules and unexpired candidates remain available after disabling lookup.

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
