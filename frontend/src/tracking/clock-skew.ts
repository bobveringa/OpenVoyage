export const CLOCK_SKEW_THRESHOLD_MS = 10_000

export type ClockSkewCheck = {
  withinTolerance: boolean
  skewMs: number
}

// §3.1/§11: compares the device clock against a server Date header. A large
// skew makes recorded_at values land outside the server's acceptance window
// (see the backend's discarded_samples bucket), so this is checked and
// surfaced *before* a recording starts rather than discovered mid-session.
export function checkClockSkew(
  serverDate: Date,
  deviceNow: Date = new Date(),
): ClockSkewCheck {
  const skewMs = deviceNow.getTime() - serverDate.getTime()
  return {
    skewMs,
    withinTolerance: Math.abs(skewMs) <= CLOCK_SKEW_THRESHOLD_MS,
  }
}
