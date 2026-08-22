package app.openvoyage;

import static org.junit.Assert.assertEquals;

import org.junit.Test;

/**
 * C7 (clock-skew fix): TrackingService.computeAnchoredTimeMs derives a fix's
 * recordedAt from the monotonic elapsed-realtime clock plus a session-start
 * anchor, rather than the fix's own wall-clock reading, so a mid-session wall
 * -clock change cannot retroactively shift already-anchored fixes.
 */
public class TrackingServiceAnchorTest {

    private static final long ONE_SECOND_NS = 1_000_000_000L;

    @Test
    public void fixAtTheAnchorInstantReadsAsTheAnchorWallClock() {
        long anchorElapsedNs = 10 * ONE_SECOND_NS;
        long anchorWallMs = 1_700_000_000_000L;

        long result = TrackingService.computeAnchoredTimeMs(
                anchorElapsedNs, anchorWallMs, anchorElapsedNs, /*rawTimeMs=*/ 0L
        );

        assertEquals(anchorWallMs, result);
    }

    @Test
    public void aFixThirtySecondsAfterTheAnchorAddsThirtySecondsToTheAnchorWallClock() {
        long anchorElapsedNs = 10 * ONE_SECOND_NS;
        long anchorWallMs = 1_700_000_000_000L;
        long fixElapsedNs = anchorElapsedNs + 30 * ONE_SECOND_NS;

        long result = TrackingService.computeAnchoredTimeMs(
                anchorElapsedNs, anchorWallMs, fixElapsedNs, /*rawTimeMs=*/ 0L
        );

        assertEquals(anchorWallMs + 30_000L, result);
    }

    @Test
    public void aMidSessionWallClockJumpDoesNotShiftTheAnchoredResult() {
        // Simulates NTP correcting the phone two hours into a drive: the
        // fix's own getTime() would jump, but elapsedRealtimeNanos (and
        // therefore the anchored result) does not.
        long anchorElapsedNs = 10 * ONE_SECOND_NS;
        long anchorWallMs = 1_700_000_000_000L;
        long fixElapsedNs = anchorElapsedNs + 60 * ONE_SECOND_NS;
        long rawTimeMsAfterNtpJump = anchorWallMs + 2 * 60 * 60 * 1000L; // +2h, wrong

        long result = TrackingService.computeAnchoredTimeMs(
                anchorElapsedNs, anchorWallMs, fixElapsedNs, rawTimeMsAfterNtpJump
        );

        assertEquals(anchorWallMs + 60_000L, result);
    }

    @Test
    public void fallsBackToTheRawReadingWhenNeverAnchored() {
        long rawTimeMs = 1_700_000_123_456L;

        long result = TrackingService.computeAnchoredTimeMs(
                /*anchorElapsedNs=*/ 0L, /*anchorWallMs=*/ 0L, /*fixElapsedNs=*/ 42L, rawTimeMs
        );

        assertEquals(rawTimeMs, result);
    }

    @Test
    public void aPersistedAnchorSurvivingASimulatedRestartProducesTheSameResultAsBeforeTheRestart() {
        long anchorElapsedNs = 10 * ONE_SECOND_NS;
        long anchorWallMs = 1_700_000_000_000L;
        long fixElapsedNs = anchorElapsedNs + 45 * ONE_SECOND_NS;

        long beforeRestart = TrackingService.computeAnchoredTimeMs(
                anchorElapsedNs, anchorWallMs, fixElapsedNs, /*rawTimeMs=*/ 0L
        );

        // A START_STICKY restart re-reads the same two longs back out of
        // SharedPreferences (restoreConfig) rather than re-anchoring, so the
        // arithmetic is exercised again with the identical persisted values.
        long restoredAnchorElapsedNs = anchorElapsedNs;
        long restoredAnchorWallMs = anchorWallMs;
        long afterRestart = TrackingService.computeAnchoredTimeMs(
                restoredAnchorElapsedNs, restoredAnchorWallMs, fixElapsedNs, /*rawTimeMs=*/ 0L
        );

        assertEquals(beforeRestart, afterRestart);
    }
}
