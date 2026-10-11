package app.openvoyage;

import android.Manifest;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Build;
import android.util.Log;

import androidx.core.content.ContextCompat;

/** Restores only a recording that was already active before a device reboot. */
public final class TrackingBootReceiver extends BroadcastReceiver {
    private static final String TAG = "OVTrackingBoot";

    @Override
    public void onReceive(Context context, Intent intent) {
        if (intent == null || !Intent.ACTION_BOOT_COMPLETED.equals(intent.getAction())
                || !TrackingService.isTrackingKnownFromPrefs(context)) {
            return;
        }
        // A location foreground service started at boot needs background
        // location access on modern Android. If it is missing, the recording
        // can resume when the user next opens the app.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q
                && ContextCompat.checkSelfPermission(context,
                        Manifest.permission.ACCESS_BACKGROUND_LOCATION)
                != PackageManager.PERMISSION_GRANTED) {
            Log.w(TAG, "Cannot restore tracking at boot without background location permission");
            return;
        }
        try {
            ContextCompat.startForegroundService(context,
                    new Intent(context, TrackingService.class)
                            .setAction(TrackingService.ACTION_START));
        } catch (RuntimeException exception) {
            Log.w(TAG, "Could not restore tracking at boot", exception);
        }
    }
}
