package app.openvoyage;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.location.Location;
import android.net.Uri;

import com.google.android.gms.location.LocationResult;

import org.json.JSONObject;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;

/** Receives batched fused fixes even after the WebView or app process is evicted. */
public final class TrackingLocationReceiver extends BroadcastReceiver {
    static final String ACTION_LOCATION = "app.openvoyage.tracking.LOCATION";

    @Override
    public void onReceive(Context context, Intent intent) {
        if (intent == null || !ACTION_LOCATION.equals(intent.getAction())
                || !LocationResult.hasResult(intent)) {
            return;
        }

        Uri data = intent.getData();
        String token = data == null ? null : data.getLastPathSegment();
        SharedPreferences prefs = context.getSharedPreferences(
                TrackingService.PREFS_NAME, Context.MODE_PRIVATE);
        if (token == null || !prefs.getBoolean(TrackingService.PREF_TRACKING, false)
                || !token.equals(prefs.getString(TrackingService.EXTRA_RECORDING_TOKEN, null))
                || TrackingService.SOURCE_PLATFORM.equals(prefs.getString(
                        TrackingService.EXTRA_LOCATION_SOURCE, TrackingService.SOURCE_AUTO))) {
            return;
        }

        LocationResult result = LocationResult.extractResult(intent);
        if (result == null) {
            return;
        }
        List<Location> locations = new ArrayList<>(result.getLocations());
        locations.sort(Comparator.comparingLong(Location::getElapsedRealtimeNanos));

        TrackingService service = TrackingService.getInstance();
        TrackingFixBuffer detachedBuffer = service == null || !service.isTracking()
                ? TrackingFixBuffer.get(context) : null;
        long anchorElapsedNs = prefs.getLong(TrackingService.EXTRA_ANCHOR_ELAPSED_NS, 0L);
        long anchorWallMs = prefs.getLong(TrackingService.EXTRA_ANCHOR_WALL_MS, 0L);
        for (Location location : locations) {
            if (anchorElapsedNs > 0 && location.getElapsedRealtimeNanos() < anchorElapsedNs) {
                continue;
            }
            if (detachedBuffer != null) {
                JSONObject fix = TrackingService.serializeFix(location,
                        anchorElapsedNs, anchorWallMs);
                if (fix != null) {
                    detachedBuffer.append(fix);
                }
            } else {
                service.onReceiverLocation(location, token);
            }
        }
    }
}
