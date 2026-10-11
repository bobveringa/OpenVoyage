package app.openvoyage;

import android.content.Context;
import android.app.PendingIntent;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.util.Log;

import com.google.android.gms.common.ConnectionResult;
import com.google.android.gms.common.GoogleApiAvailability;
import com.google.android.gms.location.FusedLocationProviderClient;
import com.google.android.gms.location.CurrentLocationRequest;
import com.google.android.gms.location.LocationRequest;
import com.google.android.gms.location.LocationServices;
import com.google.android.gms.location.Priority;
import com.google.android.gms.tasks.CancellationTokenSource;

/**
 * Google Play Services fused provider: blends GPS, wifi, cell and sensors, and
 * is the better engine wherever it exists.
 */
final class FusedLocationEngine implements LocationEngine {

    private static final String TAG = "OVFusedEngine";

    private final Context context;
    private final FusedLocationProviderClient client;
    private PendingIntent locationIntent;

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

        int priority = config.smartPrecision == 1 || config.smartPrecision == 2
                ? Priority.PRIORITY_PASSIVE
                : config.smartPrecision == 3
                        ? Priority.PRIORITY_BALANCED_POWER_ACCURACY
                        : config.power == Power.LOW
                                ? Priority.PRIORITY_LOW_POWER
                                : config.power == Power.BALANCED
                                        ? Priority.PRIORITY_BALANCED_POWER_ACCURACY
                                        : Priority.PRIORITY_HIGH_ACCURACY;
        SparseTrackingProfile sparse = config.smartPrecision > 0
                ? SparseTrackingProfile.forLevel(config.smartPrecision) : null;

        LocationRequest request = new LocationRequest.Builder(priority, config.intervalMs)
                // The OS may hand us a fix sooner than intervalMs when another
                // app has already woken the GPS; taking it is free accuracy.
                .setMinUpdateIntervalMillis(sparse == null
                        ? Math.min(config.minIntervalMs, config.intervalMs)
                        : sparse.minIntervalMs)
                .setMinUpdateDistanceMeters(sparse == null
                        ? config.minDistanceMeters : sparse.distanceMeters)
                // Deliver fixes in batches to a receiver. The request and its
                // pending intent survive WebView and ordinary process eviction.
                .setMaxUpdateDelayMillis(sparse == null ? config.intervalMs : sparse.maxDelayMs)
                .setWaitForAccurateLocation(sparse == null && config.power == Power.HIGH)
                .build();

        locationIntent = locationIntent(context, config.recordingToken);

        try {
            client
                    .requestLocationUpdates(request, locationIntent)
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
        if (locationIntent != null) {
            client.removeLocationUpdates(locationIntent);
            locationIntent.cancel();
            locationIntent = null;
        }
    }

    void lookupCurrentLocation(Callback callback) {
        CurrentLocationRequest request = new CurrentLocationRequest.Builder()
                .setPriority(Priority.PRIORITY_HIGH_ACCURACY)
                .setMaxUpdateAgeMillis(0L)
                .setDurationMillis(15_000L)
                .build();
        try {
            client.getCurrentLocation(request, new CancellationTokenSource().getToken())
                    .addOnSuccessListener(location -> {
                        if (location != null) {
                            callback.onLocation(location);
                        }
                    })
                    .addOnFailureListener(error -> {
                        Log.w(TAG, "Periodic location lookup failed", error);
                        callback.onFailure(error.getMessage() == null
                                ? "Location lookup failed" : error.getMessage());
                    });
        } catch (SecurityException exception) {
            Log.w(TAG, "Periodic location lookup denied", exception);
            callback.onFailure("Location permission was denied or revoked.");
        }
    }

    private static PendingIntent locationIntent(Context context, String recordingToken) {
        Intent intent = new Intent(context, TrackingLocationReceiver.class)
                .setAction(TrackingLocationReceiver.ACTION_LOCATION)
                .setData(Uri.parse("openvoyage://tracking/fix/" + recordingToken));
        // Play services fills the result extras, so Android 12+ needs a mutable
        // pending intent. Its explicit, non-exported receiver limits delivery.
        int flags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            flags |= PendingIntent.FLAG_MUTABLE;
        }
        return PendingIntent.getBroadcast(context, 0, intent, flags);
    }
}
