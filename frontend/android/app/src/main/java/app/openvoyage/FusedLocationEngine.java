package app.openvoyage;

import android.content.Context;
import android.location.Location;
import android.os.Looper;
import android.util.Log;

import com.google.android.gms.common.ConnectionResult;
import com.google.android.gms.common.GoogleApiAvailability;
import com.google.android.gms.location.FusedLocationProviderClient;
import com.google.android.gms.location.LocationCallback;
import com.google.android.gms.location.LocationRequest;
import com.google.android.gms.location.LocationResult;
import com.google.android.gms.location.LocationServices;
import com.google.android.gms.location.Priority;

/**
 * Google Play Services fused provider: blends GPS, wifi, cell and sensors, and
 * is the better engine wherever it exists.
 */
final class FusedLocationEngine implements LocationEngine {

    private static final String TAG = "OVFusedEngine";

    private final Context context;
    private final FusedLocationProviderClient client;
    private LocationCallback locationCallback;

    FusedLocationEngine(Context context) {
        this.context = context;
        this.client = LocationServices.getFusedLocationProviderClient(context);
    }

    /**
     * Whether Play Services is present and usable. Referencing these classes is
     * safe on a device without Play Services — they ship inside the APK; the
     * call simply reports it as unavailable.
     */
    static boolean isAvailable(Context context) {
        try {
            return GoogleApiAvailability.getInstance().isGooglePlayServicesAvailable(context)
                    == ConnectionResult.SUCCESS;
        } catch (Throwable throwable) {
            Log.w(TAG, "Play Services availability check failed", throwable);
            return false;
        }
    }

    @Override
    public String getName() {
        return "gms";
    }

    @Override
    public void start(Config config, Callback callback) {
        stop();

        LocationRequest request = new LocationRequest.Builder(
                config.highAccuracy
                        ? Priority.PRIORITY_HIGH_ACCURACY
                        : Priority.PRIORITY_BALANCED_POWER_ACCURACY,
                config.intervalMs
        )
                // The OS may hand us a fix sooner than intervalMs when another
                // app has already woken the GPS; taking it is free accuracy.
                .setMinUpdateIntervalMillis(Math.min(config.minIntervalMs, config.intervalMs))
                .setMinUpdateDistanceMeters(config.minDistanceMeters)
                // Batching lets the modem sleep between fixes, but delivery
                // delayed past one interval is no longer timely for upload.
                .setMaxUpdateDelayMillis(config.intervalMs)
                .setWaitForAccurateLocation(config.highAccuracy)
                .build();

        locationCallback = new LocationCallback() {
            @Override
            public void onLocationResult(LocationResult result) {
                for (Location location : result.getLocations()) {
                    callback.onLocation(location);
                }
            }
        };

        try {
            client
                    .requestLocationUpdates(request, locationCallback, Looper.getMainLooper())
                    // Previously unobserved, which is precisely how a device
                    // without Play Services ended up "recording" nothing while
                    // looking healthy.
                    .addOnFailureListener(error -> {
                        Log.e(TAG, "Fused location updates rejected", error);
                        callback.onFailure(
                                "Google Play Services could not provide location on this device."
                        );
                    });
        } catch (SecurityException exception) {
            callback.onFailure("Location permission was denied or revoked.");
        }
    }

    @Override
    public void stop() {
        if (locationCallback != null) {
            client.removeLocationUpdates(locationCallback);
            locationCallback = null;
        }
    }
}
