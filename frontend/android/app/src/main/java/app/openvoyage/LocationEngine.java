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

    final class Config {
        final long intervalMs;
        final long minIntervalMs;
        final float minDistanceMeters;
        final boolean highAccuracy;

        Config(long intervalMs, long minIntervalMs, float minDistanceMeters, boolean highAccuracy) {
            this.intervalMs = intervalMs;
            this.minIntervalMs = minIntervalMs;
            this.minDistanceMeters = minDistanceMeters;
            this.highAccuracy = highAccuracy;
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
