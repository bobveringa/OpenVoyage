# Dedicated flight monitor (2026-10-24)

Flight monitoring now runs in an application-owned thread independently of
maintenance jobs. It starts with FastAPI, checks persisted due flights immediately,
and waits 60 seconds after each cycle. There is no backlog of heartbeat ticks.
The existing flight frequency presets, grouping, backoff, GPS history, privacy,
and owner completion rules still apply. Flight reads do not trigger writes.

Admin → Routing → Flight provider controls **both** planning lookup and automatic
monitoring. A selected provider enables monitoring even if the legacy Flight
tracking job was disabled. Selecting `none` disables both without changing due
times or saved facts. Valid credentials are required. There is no second toggle,
run-now action, or editable heartbeat. Settings take effect on the next cycle,
after any current work and its heartbeat delay. Requests already in progress
finish cooperatively. Credential updates and resets still rearm eligible flights
suspended by configuration errors; rate-limit backoff is preserved.

Flight tracking no longer appears in Jobs. Its legacy enabled flag, cron,
timezone, audit fields, and completed execution history remain stored for history
and rollback, but have no effect on monitoring. Custom slow cron schedules must
be replaced by a suitable existing flight frequency preset. No new executions
are created. Retired job controls return 404; execution history remains readable.

## Deployment and rollback

Stop **all** old application processes, run `alembic upgrade head` from `backend/`,
then start the new application. Mixed old/new runtimes are unsupported: the old
job does not take the monitor lock, and a migration cannot stop an in-flight
request. The migration marks queued/running legacy flight executions failed and
leaves provider settings and the legacy schedule unchanged, including when the
legacy job row is absent.

For rollback, stop all new processes, downgrade the database, and only then
restore/start the previous application. Apply the same stop-first cutover to an
application-only rollback. The old job resumes its original enabled flag and
schedule; an originally disabled job stays disabled. Migration-failed executions
are not revived. If no legacy row existed, the old version bootstraps its defaults.

## Operations

One process holds the session advisory lock `openvoyage.flight_monitor`
(`0x4F56464D`, `1`) on a dedicated PostgreSQL connection using `NullPool`.
Flight settings changes use the separate transaction lock (`0x4F56464D`, `2`).
Monitor connections use a 5-second connect timeout and 10-second statement and
lock timeouts. They never enter the application connection pool. Settings
snapshots bypass the normal 60-second cache and resolve only selected credentials.
Stale configuration failures cannot undo a concurrent credential fix.

Structured logs identify process instances, ownership changes, enablement,
provider refusals, cycle failures and shutdown. Healthy cycles log at debug level.
Use existing flight freshness fields for diagnosis; there is no monitor history
table or status endpoint. `/health` remains database readiness, independent of
disabled tracking, standby state, and provider outages.

Shutdown interrupts heartbeat waits and stops starting new trips/provider groups.
It waits for current I/O and atomic application of collected results. Network
timeouts do not guarantee a hard shutdown deadline. Connection loss discards
uncommitted results; failover waits for PostgreSQL to release the old session
and a standby heartbeat. A request interrupted before commit can be repeated.
There are no exactly-once request or 60-second freshness guarantees. Maintenance
job coordination across multiple backend processes remains a separate limitation.
