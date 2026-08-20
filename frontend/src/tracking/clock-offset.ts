// §1/§4: the device→server clock offset, measured once from an HTTP `Date`
// header plus the round-trip time of the request that carried it. Adding the
// result to a device timestamp expresses it in server time, which is what
// lets the server judge every uploaded sample against a consistent clock
// instead of two disagreeing ones (see tracking-service.ts's error-budget
// table for why 5s of residual error is expected even after correction).

// Mirrors the backend's SAMPLE_TIME_TOLERANCE (tracking_service.py). The two
// constants cannot literally share a value across the network boundary — keep
// them in sync by hand if either changes.
export const CLOCK_OFFSET_TOLERANCE_MS = 5_000

// Anything beyond this cannot be a measurement artifact (RTT asymmetry, `Date`
// header quantisation, clock drift) — it can only be a broken or hostile
// server/device clock. Trusting it would let that clock poison every
// timestamp for the rest of the session, so the estimate is discarded and the
// caller falls back to 0 instead.
export const MAX_PLAUSIBLE_OFFSET_MS = 24 * 60 * 60 * 1000

export type ClockOffsetMeasurement = {
  // The response's `Date` header, as epoch milliseconds.
  dateHeaderMs: number
  // Date.now() taken immediately before the request was sent.
  t0: number
  // Date.now() taken immediately after the response was received.
  t1: number
}

// offsetMs is what to *add* to a device timestamp to express it in server
// time. Returns 0 (never throws, never trusts an implausible reading) so a
// broken measurement degrades to "no correction" rather than a poisoned one.
export function estimateClockOffsetMs(measurement: ClockOffsetMeasurement): number {
  const { dateHeaderMs, t0, t1 } = measurement

  // HTTP Date is truncated to the second (RFC 7231), so the true server time
  // at the moment the header was generated lies in [dateHeaderMs,
  // dateHeaderMs + 1000). The midpoint is the best point estimate.
  const serverMidpointMs = dateHeaderMs + 500
  // Assume symmetric latency: the server's clock has advanced by half the
  // round trip between generating the header and this measurement being
  // taken at t1.
  const estimatedServerNowAtT1 = serverMidpointMs + (t1 - t0) / 2
  const offsetMs = estimatedServerNowAtT1 - t1

  if (!Number.isFinite(offsetMs) || Math.abs(offsetMs) > MAX_PLAUSIBLE_OFFSET_MS) {
    return 0
  }
  return offsetMs
}

// Applies a measured offset to a raw device-time ISO timestamp, producing the
// corrected value to put on the wire. The local queue itself always keeps the
// raw value (C4) — this is only ever called at the point a request payload is
// being built.
export function applyClockOffset(deviceIso: string, offsetMs: number): string {
  if (offsetMs === 0) {
    return deviceIso
  }
  return new Date(Date.parse(deviceIso) + offsetMs).toISOString()
}
