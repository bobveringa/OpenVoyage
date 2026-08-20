export const CLOCK_SKEW_THRESHOLD_MS = 10_000

export type ClockSkewCheck = {
  withinTolerance: boolean
  skewMs: number
}

// §3.1/§11: a coarse device-vs-server comparison, used only to decide
// whether a skew is worth mentioning to the user. It is *not* what makes
// recording correct — clock-offset.ts's RTT-aware estimate is what gets
// applied to outgoing timestamps (C1-C4). Once that correction exists, a
// large result here is advisory (worth fixing the device clock) rather than
// a reason to block starting: see startTracking's non-blocking notice and
// the uploader's live re-check.
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
