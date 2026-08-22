package app.openvoyage;

import static org.junit.Assert.assertEquals;

import org.junit.Test;

/**
 * Covers B1 and B2 directly: computeWarningKind() is the pure function the
 * watchdog Runnable in TrackingService delegates to, extracted so these cases
 * don't need a real Service or a Looper.
 */
public class TrackingWatchdogTest {

    private static final long INTERVAL_MS = 30_000L;

    @Test
    public void noWarningShortlyAfterStart() {
        long now = 10_000L;
        long watchdogBaseMs = 0L;

        assertEquals(
                TrackingService.WarningKind.NONE,
                TrackingService.computeWarningKind(now, watchdogBaseMs, 0L, 0L, INTERVAL_MS, true)
        );
    }

    @Test
    public void waitingForFirstFixAfterNinetySecondsWithNoFix() {
        long now = 91_000L;
        long watchdogBaseMs = 0L;

        assertEquals(
                TrackingService.WarningKind.WAITING_FOR_FIRST_FIX,
                TrackingService.computeWarningKind(now, watchdogBaseMs, 0L, 0L, INTERVAL_MS, true)
        );
    }

    // B1 regression: a reconfigure (cadence change) used to leave lastFixAtMs
    // untouched but reset the time base to startedAtMs, which by 90s into any
    // trip was already exceeded — so the very first watchdog tick after a
    // reconfigure fired the cold-start warning even though fixes were flowing
    // fine. watchdogBaseMs resetting to "now" on every (re)start fixes this:
    // a fix received before the reconfigure still counts as "already had a
    // fix", so the reconfigure evaluates the *subsequent* gap threshold, not
    // the cold-start one.
    @Test
    public void reconfigureRightAfterAFixDoesNotLookLikeAColdStart() {
        long watchdogBaseMs = 5_000_000L; // reconfigure happened "now"
        long lastFixAtMs = 4_999_000L; // a fix arrived just before it
        long now = watchdogBaseMs + 1_000L; // watchdog ticks 1s later

        assertEquals(
                TrackingService.WarningKind.NONE,
                TrackingService.computeWarningKind(
                        now, watchdogBaseMs, lastFixAtMs, lastFixAtMs, INTERVAL_MS, true
                )
        );
    }

    // B2 regression: on a process-kill restart, restoreConfig() reads the
    // original startedAtMs (potentially hours ago) but lastFixAtMs is 0 in
    // the freshly recreated service object. Evaluating "no fix yet" against
    // watchdogBaseMs (reset to "now" by requestLocationUpdates) rather than
    // against the ancient startedAtMs means the restarted service gets the
    // normal cold-start grace period instead of an instant false warning.
    @Test
    public void processKillRestartGetsAFreshGracePeriodNotTheOldSessionStart() {
        long watchdogBaseMs = 10_000_000L; // service recreated, updates (re)started "now"
        long now = watchdogBaseMs + 10_000L; // 10s after restart

        assertEquals(
                TrackingService.WarningKind.NONE,
                TrackingService.computeWarningKind(now, watchdogBaseMs, 0L, 0L, INTERVAL_MS, true)
        );
    }

    @Test
    public void noSignalOnceFixesStopArrivingAfterHavingHadOne() {
        long lastFixAtMs = 0L;
        long watchdogBaseMs = 0L;
        // Threshold is max(60s, interval*2) = 60s once a first fix has been seen.
        long now = 61_000L;

        assertEquals(
                TrackingService.WarningKind.NO_SIGNAL,
                TrackingService.computeWarningKind(
                        now, watchdogBaseMs, 1L /* hadFirstFix */, 1L, INTERVAL_MS, true
                )
        );
    }

    @Test
    public void signalTooWeakWhenFixesArriveButNothingIsAccepted() {
        long watchdogBaseMs = 0L;
        long lastFixAtMs = 95_000L; // recent enough to not trip the no-signal check
        long lastAcceptedAtMs = 0L; // nothing accepted since watchdogBaseMs
        // Accept threshold is max(60s, interval*3) = 90s, measured from
        // watchdogBaseMs since lastAcceptedAtMs is 0 (unset).
        long now = 100_000L;

        assertEquals(
                TrackingService.WarningKind.SIGNAL_TOO_WEAK,
                TrackingService.computeWarningKind(
                        now, watchdogBaseMs, lastFixAtMs, lastAcceptedAtMs, INTERVAL_MS, true
                )
        );
    }

    @Test
    public void signalTooWeakIsSuppressedWithNoListenerAttached() {
        long watchdogBaseMs = 0L;
        long lastFixAtMs = 95_000L;
        long lastAcceptedAtMs = 0L;
        long now = 100_000L;

        assertEquals(
                TrackingService.WarningKind.NONE,
                TrackingService.computeWarningKind(
                        now, watchdogBaseMs, lastFixAtMs, lastAcceptedAtMs, INTERVAL_MS, false
                )
        );
    }
}
