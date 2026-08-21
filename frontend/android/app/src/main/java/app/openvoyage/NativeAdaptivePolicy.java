package app.openvoyage;

/** Pure smart-tracking policy; Android services only supply its inputs. */
final class NativeAdaptivePolicy {

    static final long MIN_INTERVAL_MS = 5_000L;
    static final long MAX_INTERVAL_MS = 300_000L;
    private static final double REFERENCE_SPEED_MPS = 1.4;
    private static final double MIN_INTERVAL_FACTOR = 1.0 / 4.0;
    private static final double MAX_INTERVAL_FACTOR = 6.0;
    private static final double LOW_BATTERY_LEVEL = 0.15;
    private static final double CRITICAL_BATTERY_LEVEL = 0.05;

    enum Mode {
        SMART,
        MANUAL;

        static Mode parse(String value) {
            return "smart".equals(value) ? SMART : MANUAL;
        }

        String wireName() {
            return this == SMART ? "smart" : "manual";
        }
    }

    enum Reason {
        FIXED("fixed"),
        STATIONARY("stationary"),
        MOVING("moving"),
        BATTERY_LOW("battery-low"),
        BATTERY_CRITICAL("battery-critical"),
        POWER_SAVE_MODE("power-save-mode");

        private final String wireName;

        Reason(String wireName) {
            this.wireName = wireName;
        }

        String wireName() {
            return wireName;
        }
    }

    static final class Input {
        final Mode mode;
        final long baselineIntervalMs;
        final LocationEngine.Power baselinePower;
        final float manualDistanceFilterMeters;
        final NativeMovementDetector.State movement;
        final Double speedMps;
        final Double batteryLevel;
        final boolean charging;
        final boolean powerSaveMode;
        final boolean coarseLocationAvailable;

        Input(
                Mode mode,
                long baselineIntervalMs,
                LocationEngine.Power baselinePower,
                float manualDistanceFilterMeters,
                NativeMovementDetector.State movement,
                Double speedMps,
                Double batteryLevel,
                boolean charging,
                boolean powerSaveMode,
                boolean coarseLocationAvailable
        ) {
            this.mode = mode;
            this.baselineIntervalMs = baselineIntervalMs;
            this.baselinePower = baselinePower;
            this.manualDistanceFilterMeters = manualDistanceFilterMeters;
            this.movement = movement;
            this.speedMps = speedMps;
            this.batteryLevel = batteryLevel;
            this.charging = charging;
            this.powerSaveMode = powerSaveMode;
            this.coarseLocationAvailable = coarseLocationAvailable;
        }
    }

    static final class Decision {
        final long intervalMs;
        final LocationEngine.Power power;
        final float distanceFilterMeters;
        final Reason reason;

        Decision(
                long intervalMs,
                LocationEngine.Power power,
                float distanceFilterMeters,
                Reason reason
        ) {
            this.intervalMs = intervalMs;
            this.power = power;
            this.distanceFilterMeters = distanceFilterMeters;
            this.reason = reason;
        }
    }

    private NativeAdaptivePolicy() {}

    static Decision decide(Input input) {
        long baseline = Math.max(1L, input.baselineIntervalMs);
        long interval = baseline;
        LocationEngine.Power power = input.baselinePower;
        Reason reason = Reason.FIXED;
        float distanceFilter = input.mode == Mode.SMART ? 0f : input.manualDistanceFilterMeters;

        // Manual is intentionally fixed. Its purpose is an explicit user-set
        // cadence, unlike smart mode where battery/movement own the policy.
        if (input.mode == Mode.MANUAL) {
            return new Decision(interval, power, distanceFilter, reason);
        }

        if (input.movement == NativeMovementDetector.State.STATIONARY) {
            interval = Math.round(baseline * MAX_INTERVAL_FACTOR);
            reason = Reason.STATIONARY;
        } else if (input.movement == NativeMovementDetector.State.MOVING
                && input.speedMps != null && input.speedMps > 0.0) {
            interval = Math.round((baseline * REFERENCE_SPEED_MPS) / input.speedMps);
            reason = Reason.MOVING;
        }

        interval = clamp(
                interval,
                Math.round(baseline * MIN_INTERVAL_FACTOR),
                Math.round(baseline * MAX_INTERVAL_FACTOR)
        );

        if (!input.charging) {
            if (input.batteryLevel != null && input.batteryLevel <= CRITICAL_BATTERY_LEVEL) {
                interval *= 4;
                if (input.coarseLocationAvailable) {
                    power = LocationEngine.Power.LOW;
                }
                reason = Reason.BATTERY_CRITICAL;
            } else if (input.batteryLevel != null && input.batteryLevel <= LOW_BATTERY_LEVEL) {
                interval *= 2;
                if (input.coarseLocationAvailable) {
                    power = degrade(power);
                }
                reason = Reason.BATTERY_LOW;
            } else if (input.powerSaveMode) {
                interval *= 2;
                if (input.coarseLocationAvailable) {
                    power = degrade(power);
                }
                reason = Reason.POWER_SAVE_MODE;
            }
        }

        return new Decision(clamp(interval, MIN_INTERVAL_MS, MAX_INTERVAL_MS), power, distanceFilter, reason);
    }

    static boolean isMeaningfulChange(Decision current, Decision next) {
        if (current == null || current.power != next.power
                || Float.compare(current.distanceFilterMeters, next.distanceFilterMeters) != 0) {
            return true;
        }
        double ratio = (double) next.intervalMs / current.intervalMs;
        return ratio <= 0.75 || ratio >= 1.33;
    }

    private static LocationEngine.Power degrade(LocationEngine.Power power) {
        return power == LocationEngine.Power.HIGH
                ? LocationEngine.Power.BALANCED
                : LocationEngine.Power.LOW;
    }

    private static long clamp(long value, long min, long max) {
        return Math.min(Math.max(value, min), max);
    }
}
