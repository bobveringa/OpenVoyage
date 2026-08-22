package app.openvoyage;

/**
 * Small stateful movement detector used by the native tracking service.
 *
 * <p>It deliberately uses displacement rather than a location's reported
 * speed at rest: GNSS Doppler noise frequently reports a walking speed while
 * a phone is parked. A clearly high reported speed is still used to make
 * pulling away from a stop responsive.
 */
final class NativeMovementDetector {

    static final double CLEARLY_MOVING_MPS = 2.0;
    static final double MIN_MOVEMENT_METERS = 25.0;
    static final double ACCURACY_MOVEMENT_FACTOR = 1.5;
    static final long STATIONARY_DWELL_MS = 90_000L;

    enum State {
        UNKNOWN,
        STATIONARY,
        MOVING
    }

    private static final class Sample {
        final double latitude;
        final double longitude;
        final float accuracyMeters;
        final boolean hasAccuracy;
        final double speedMps;
        final boolean hasSpeed;
        final long atMs;

        Sample(
                double latitude,
                double longitude,
                float accuracyMeters,
                boolean hasAccuracy,
                double speedMps,
                boolean hasSpeed,
                long atMs
        ) {
            this.latitude = latitude;
            this.longitude = longitude;
            this.accuracyMeters = accuracyMeters;
            this.hasAccuracy = hasAccuracy;
            this.speedMps = speedMps;
            this.hasSpeed = hasSpeed;
            this.atMs = atMs;
        }
    }

    private Sample anchor;
    private Sample previous;
    private Long stationarySinceMs;
    private State state = State.UNKNOWN;
    private Double effectiveSpeedMps;

    State observe(
            double latitude,
            double longitude,
            float accuracyMeters,
            boolean hasAccuracy,
            double speedMps,
            boolean hasSpeed,
            long atMs
    ) {
        Sample sample = new Sample(
                latitude, longitude, accuracyMeters, hasAccuracy, speedMps, hasSpeed, atMs
        );

        // A late delivery must not move the anchor backwards or manufacture a
        // negative-speed sample. Keep the previous, newer sample intact.
        if (previous != null && atMs <= previous.atMs) {
            return state;
        }

        if (previous != null) {
            long elapsedMs = atMs - previous.atMs;
            if (elapsedMs > 0) {
                effectiveSpeedMps = distanceMeters(previous, sample) / (elapsedMs / 1000.0);
            }
        }
        previous = sample;

        if (anchor == null) {
            anchor = sample;
            stationarySinceMs = atMs;
            return state;
        }

        boolean clearlyMoving = sample.hasSpeed && sample.speedMps > CLEARLY_MOVING_MPS;
        if (clearlyMoving || distanceMeters(anchor, sample) > movementThreshold(anchor, sample)) {
            anchor = sample;
            stationarySinceMs = null;
            state = State.MOVING;
            return state;
        }

        if (stationarySinceMs == null) {
            stationarySinceMs = atMs;
        }
        if (atMs - stationarySinceMs >= STATIONARY_DWELL_MS) {
            state = State.STATIONARY;
        }
        return state;
    }

    State getState() {
        return state;
    }

    Double getEffectiveSpeedMps() {
        return effectiveSpeedMps;
    }

    private static double movementThreshold(Sample first, Sample second) {
        double firstAccuracy = first.hasAccuracy ? first.accuracyMeters : 0.0;
        double secondAccuracy = second.hasAccuracy ? second.accuracyMeters : 0.0;
        return Math.max(
                MIN_MOVEMENT_METERS,
                Math.max(firstAccuracy, secondAccuracy) * ACCURACY_MOVEMENT_FACTOR
        );
    }

    private static double distanceMeters(Sample first, Sample second) {
        double earthRadiusMeters = 6_371_000.0;
        double latitudeDelta = Math.toRadians(second.latitude - first.latitude);
        double longitudeDelta = Math.toRadians(second.longitude - first.longitude);
        double a = Math.sin(latitudeDelta / 2) * Math.sin(latitudeDelta / 2)
                + Math.cos(Math.toRadians(first.latitude))
                * Math.cos(Math.toRadians(second.latitude))
                * Math.sin(longitudeDelta / 2)
                * Math.sin(longitudeDelta / 2);
        return earthRadiusMeters * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    }
}
