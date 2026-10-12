package app.openvoyage;

/**
 * Sparse location profiles for background tracking.
 * The OS treats these as hints, so actual delivery and power use vary by device.
 */
final class SparseTrackingProfile {
    final long intervalMs;
    final long minIntervalMs;
    final long maxDelayMs;
    final long lookupIntervalMs;
    final float distanceMeters;
    final LocationEngine.Power power;

    private SparseTrackingProfile(long intervalMs, long minIntervalMs, long maxDelayMs,
                                  long lookupIntervalMs, float distanceMeters,
                                  LocationEngine.Power power) {
        this.intervalMs = intervalMs;
        this.minIntervalMs = minIntervalMs;
        this.maxDelayMs = maxDelayMs;
        this.lookupIntervalMs = lookupIntervalMs;
        this.distanceMeters = distanceMeters;
        this.power = power;
    }

    static SparseTrackingProfile forLevel(int level) {
        switch (level) {
            case 1:
                return new SparseTrackingProfile(60 * 60_000L, 30 * 60_000L,
                        120 * 60_000L, 8 * 60 * 60_000L, 500f,
                        LocationEngine.Power.LOW);
            case 2:
                return new SparseTrackingProfile(15 * 60_000L, 15 * 60_000L,
                        30 * 60_000L, 2 * 60 * 60_000L, 500f,
                        LocationEngine.Power.LOW);
            case 4:
                return new SparseTrackingProfile(6 * 60_000L, 6 * 60_000L,
                        15 * 60_000L, 20 * 60_000L, 150f,
                        LocationEngine.Power.HIGH);
            case 5:
                // OpenVoyage extension for users who prefer route detail.
                return new SparseTrackingProfile(10_000L, 10_000L,
                        20_000L, 20 * 60_000L, 0f,
                        LocationEngine.Power.HIGH);
            case 3:
            default:
                return new SparseTrackingProfile(10 * 60_000L, 10 * 60_000L,
                        30 * 60_000L, 20 * 60_000L, 150f,
                        LocationEngine.Power.BALANCED);
        }
    }
}
