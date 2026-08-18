package app.openvoyage;

import android.location.Location;

/**
 * The part of {@link TrackingService} that actually talks to a location API.
 *
 * <p>Two implementations exist because Google Play Services is not present on
 * every Android device — de-Googled ROMs (GrapheneOS without sandboxed Play,
 * /e/OS, LineageOS without gapps) have no {@code FusedLocationProviderClient}
 * at all. Without this split the app on such a device starts a recording,
 * shows its notification, ticks its timer and records nothing, because the
 * fused client's failed {@code Task} goes unobserved.
 *
 * <p>Everything above this interface — the durable fix buffer, the
 * notification, the adaptive cadence policy, the whole JS layer — is engine
 * agnostic.
 */
interface LocationEngine {

    /** How the engine identifies itself to the user and to diagnostics. */
    String getName();

    void start(Config config, Callback callback);

    void stop();

    /** Lowest to highest effort per fix. */
    enum Power {
        LOW,
        BALANCED,
        HIGH;

        static Power parse(String value) {
            if ("low".equals(value)) {
                return LOW;
            }
            if ("balanced".equals(value)) {
                return BALANCED;
            }
            return HIGH;
        }

        String wireName() {
            return name().toLowerCase(java.util.Locale.ROOT);
        }
    }

    final class Config {
        final long intervalMs;
        final long minIntervalMs;
        final float minDistanceMeters;
        final Power power;

        Config(long intervalMs, long minIntervalMs, float minDistanceMeters, Power power) {
            this.intervalMs = intervalMs;
            this.minIntervalMs = minIntervalMs;
            this.minDistanceMeters = minDistanceMeters;
            this.power = power;
        }
    }

    interface Callback {
        void onLocation(Location location);

        /**
         * The engine cannot deliver fixes and will not recover on its own:
         * the API is missing, the provider is gone, or the location
         * permission was revoked. Distinct from "no fix yet", which is a
         * normal condition indoors and is handled by the service's own
         * timeout rather than reported here.
         */
        void onFailure(String message);
    }
}
