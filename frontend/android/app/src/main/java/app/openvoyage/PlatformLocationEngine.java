package app.openvoyage;

import android.content.Context;
import android.location.Location;
import android.location.LocationListener;
import android.location.LocationManager;
import android.location.LocationRequest;
import android.os.Build;
import android.os.Looper;
import android.util.Log;

import androidx.annotation.NonNull;

import java.util.List;

/**
 * Framework {@link LocationManager}, for devices without Google Play Services.
 *
 * <p>AOSP ships its own fused provider ({@code com.android.location.fused}),
 * so this is not necessarily raw GPS: where a ROM provides a network-location
 * backend the platform fused provider will blend it in. On a bare AOSP build
 * with no network provider it does resolve to GPS alone, which is why the
 * balanced-power path below degrades to "same provider, longer interval"
 * rather than to a genuinely cheaper sensor.
 */
final class PlatformLocationEngine implements LocationEngine {

    private static final String TAG = "OVPlatformEngine";

    private final Context context;
    private final LocationManager locationManager;
    private LocationListener listener;

    PlatformLocationEngine(Context context) {
        this.context = context;
        this.locationManager = (LocationManager) context.getSystemService(Context.LOCATION_SERVICE);
    }

    static boolean isAvailable(Context context) {
        LocationManager manager = (LocationManager) context.getSystemService(Context.LOCATION_SERVICE);
        return manager != null && pickProvider(manager, Power.HIGH) != null;
    }

    /**
     * Whether this device has a location backend that keeps producing fixes
     * below the HIGH power tier (B7). On bare AOSP with no network provider,
     * anything below HIGH resolves to nothing at all — see pickProvider — so
     * the battery-aware degradation in adaptive.ts must not drop the tier
     * unless this is true.
     */
    static boolean hasCoarseLocationBackend(Context context) {
        LocationManager manager = (LocationManager) context.getSystemService(Context.LOCATION_SERVICE);
        if (manager == null) {
            return false;
        }
        return manager.getAllProviders().contains(LocationManager.NETWORK_PROVIDER)
                && manager.isProviderEnabled(LocationManager.NETWORK_PROVIDER);
    }

    /**
     * Prefers the platform fused provider (API 31+, and only when the device
     * actually has one) and falls back to GPS. For balanced power a network
     * provider is used when one exists, since it is the only cheaper option
     * the framework offers.
     *
     * <p>Below API 31 there is no way to state a quality alongside the
     * request, so a high-accuracy recording asks GPS directly rather than
     * going through fused and hoping it powers the receiver up.
     */
    private static String pickProvider(LocationManager manager, Power power) {
        List<String> providers = manager.getAllProviders();

        if (power != Power.HIGH
                && providers.contains(LocationManager.NETWORK_PROVIDER)
                && manager.isProviderEnabled(LocationManager.NETWORK_PROVIDER)) {
            return LocationManager.NETWORK_PROVIDER;
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S
                && providers.contains(LocationManager.FUSED_PROVIDER)
                && manager.isProviderEnabled(LocationManager.FUSED_PROVIDER)) {
            return LocationManager.FUSED_PROVIDER;
        }

        if (providers.contains(LocationManager.GPS_PROVIDER)
                && manager.isProviderEnabled(LocationManager.GPS_PROVIDER)) {
            return LocationManager.GPS_PROVIDER;
        }

        return null;
    }

    @Override
    public String getName() {
        return "platform";
    }

    private static int quality(Power power) {
        switch (power) {
            case LOW:
                return LocationRequest.QUALITY_LOW_POWER;
            case BALANCED:
                return LocationRequest.QUALITY_BALANCED_POWER_ACCURACY;
            case HIGH:
            default:
                return LocationRequest.QUALITY_HIGH_ACCURACY;
        }
    }

    @Override
    public void start(Config config, Callback callback) {
        stop();

        if (locationManager == null) {
            callback.onFailure("This device has no location service.");
            return;
        }

        String provider = pickProvider(locationManager, config.power);
        if (provider == null) {
            callback.onFailure("No location provider is available on this device.");
            return;
        }

        listener = new LocationListener() {
            @Override
            public void onLocationChanged(@NonNull Location location) {
                callback.onLocation(location);
            }

            @Override
            public void onProviderDisabled(@NonNull String disabled) {
                // Turning location off mid-recording is a hard failure: it
                // will not resume by itself, and staying quiet about it is the
                // silent-nothing outcome this engine exists to prevent.
                callback.onFailure("Location was turned off on this device.");
            }

            @Override
            public void onProviderEnabled(@NonNull String enabled) {}
        };

        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                // The legacy overload carries no quality, and the framework
                // defaults it to BALANCED. On a device whose fused provider
                // honours that (anything backed by Play Services) the GPS
                // receiver is then never powered up, and with no network
                // provider available the recording silently yields nothing.
                LocationRequest request = new LocationRequest.Builder(config.intervalMs)
                        .setMinUpdateIntervalMillis(
                                Math.min(config.minIntervalMs, config.intervalMs)
                        )
                        .setMinUpdateDistanceMeters(config.minDistanceMeters)
                        .setQuality(quality(config.power))
                        .build();
                locationManager.requestLocationUpdates(
                        provider,
                        request,
                        context.getMainExecutor(),
                        listener
                );
            } else {
                locationManager.requestLocationUpdates(
                        provider,
                        config.intervalMs,
                        config.minDistanceMeters,
                        listener,
                        Looper.getMainLooper()
                );
            }
            Log.i(
                    TAG,
                    "Requested platform location updates from " + provider
                            + " (power=" + config.power + ")"
            );
        } catch (SecurityException exception) {
            callback.onFailure("Location permission was denied or revoked.");
        } catch (IllegalArgumentException exception) {
            callback.onFailure("This device cannot provide location updates.");
        }
    }

    @Override
    public void stop() {
        if (listener != null && locationManager != null) {
            locationManager.removeUpdates(listener);
        }
        listener = null;
    }
}
