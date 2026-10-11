# Polarsteps 8.0.0 tracker analysis

Source artifact: `private/polarsteps_v8.apk` (SHA-256
`07c193a2b1c4d6a2eb5692f82ca54a3fd34571fec9eb8ad40d4e662cb98a9fd4`).
The observations below come from static decompilation of the shipped APK. They
describe its Android client, not measured battery use or server behavior.

## Observed client design

- A foreground location service, a fused-location `PendingIntent` receiver, and
  a lookup alarm receiver run in a separate `:tracker` process. The receiver
  serializes batched locations to `tracker_data.alp` before the UI consumes them.
  REA evidence: `ev_23f6d9b9c3bbfc721830309d39477d1a7c631089843a9431ab0d377004bc75a8`,
  `ev_bc5df2df4e5b9a8bd782e3a9c82a4a321981083cf4a8b15a9a1726832f64d78d`,
  `ev_9f194d8b72e6068498648f51e25d48f0332d3a6165d77cf06516ed74d8fb4405`.
- Four location request profiles map to trip modes. The interval is a request
  hint; updates can be delayed and batched. REA evidence:
  `ev_8ec8db84cf8873b09336e57d796675abc5a79d3bf22926c734f813443465c65c`,
  `ev_a24bc8482ea3217c530dd3ba549816f306c39f7501a8c362510011c10aa80059`.

  | Mode | Interval | Min interval | Max delay | Min distance | Fused priority | Lookup alarm |
  | --- | ---: | ---: | ---: | ---: | --- | ---: |
  | Ultra light | 60 min | 30 min | 120 min | 500 m | Passive | 8 h |
  | Light | 15 min | 15 min | 30 min | 500 m | Passive | 2 h |
  | Balanced | 10 min | 10 min | 30 min | 150 m | Balanced | 20 min |
  | High | 6 min | 6 min | 15 min | 150 m | High accuracy | 20 min |

- Lookup alarms use `setAndAllowWhileIdle`; a significant-motion trigger can
  request an earlier fix. In High mode, a lookup races Google Play Services'
  fused location provider against Android `LocationManager`'s `gps` provider
  with a 15-second overall timeout and chooses the more accurate result. The
  direct GPS branch returns no fix in the other modes. REA evidence:
  `ev_968297f3c853ce6d4b5d48bf73e661ed12b70bf70c53551f011bdc9b3054ee46`,
  `ev_e58e1f90834342a8f12590dd8df0bd2dd7124098a1f79988ed97425ae99ff28e`,
  `ev_858f0aaccb12c7e9639b60f33b72585945448b30042b2cedea09ff1ccad2384b`,
  `ev_dce3d1f5579772ed75eb3c6050dcc3ffd760b2d22817a261d2f2e328ce351747`,
  `ev_9c43e7d319bf6ff8a9b5611eee9bed54eedbdde0fb5e9891d73cf06fb34fb5f6`,
  `ev_89614c13795423205bcf6a9ebc38861c477326cdfc5fb5d4080beca003541898`.

## OpenVoyage implementation decisions

Smart tracking uses those four request profiles during an active recording.
The slider adds a fifth, OpenVoyage-specific 10-second high-detail option.
The service, location receivers, boot receiver, and private IPC provider share
a separate `:tracker` process. The Capacitor plugin asks that provider for
state and buffered fixes; it no longer reads tracker memory or the fix file
from the UI process. The UI detaches its event receiver when paused and drains
the native buffer on resume, so background fixes do not wake the WebView.
Binder death detection also detaches after a UI crash. Fixes cross
the IPC boundary in bounded batches. The receivers persist batched fixes while
the WebView is absent. A sticky foreground service restores the same recording
after tracker process eviction, and a recording token prevents stale receiver
deliveries from entering a later trip.
The tracker persists notification Stop and hard engine failure, including the
stop time. On foreground return or UI process restart, the WebView drains the
last fixes and closes the recording instead of starting it again.
Stopping the recording removes the request, alarm, and motion trigger.
An active recording is restored after a device reboot when background location
permission permits a location foreground service at boot.

On devices without Google Play Services, the platform location engine keeps
the sparse interval. If there is no coarse location backend, it asks for GPS
quality so low-power tiers do not silently stop producing fixes. The platform
engine does not have the APK's dual-source lookup race or a process-independent
location receiver; its foreground service is responsible for the request.
Likewise, OpenVoyage's Google Play Services lookup currently uses one
`getCurrentLocation` request. These are fidelity limits, not observations
about Polarsteps.
