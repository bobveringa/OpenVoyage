package app.openvoyage;

import android.Manifest;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.location.LocationManager;
import android.os.BatteryManager;
import android.os.Binder;
import android.os.Build;
import android.os.Bundle;
import android.os.IBinder;
import android.os.PowerManager;
import android.util.Log;

import androidx.core.content.ContextCompat;

import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import org.json.JSONArray;
import org.json.JSONException;

import java.util.UUID;

/**
 * JS bridge to {@link TrackingService}.
 *
 * <p>The contract is deliberately state-first rather than handle-first: JS asks
 * {@code getState()} what the native side is doing and adopts that answer,
 * instead of holding a watcher id that a webview reload would silently
 * invalidate. Fixes are pulled with {@code drain()} out of a durable buffer
 * rather than pushed and forgotten, so a reload mid-recording loses neither the
 * recording nor the points captured while JS was gone.
 */
@CapacitorPlugin(
    name = "Tracking",
    permissions = {
        @Permission(
            strings = { Manifest.permission.ACCESS_COARSE_LOCATION, Manifest.permission.ACCESS_FINE_LOCATION },
            alias = TrackingPlugin.LOCATION_ALIAS
        )
    }
)
public class TrackingPlugin extends Plugin {

    static final String LOCATION_ALIAS = "location";
    private static final String TAG = "OVTrackingPlugin";
    private final String clientId = UUID.randomUUID().toString();
    private final IBinder clientBinder = new Binder();
    private boolean eventReceiverRegistered = false;
    private boolean attached = false;

    private final BroadcastReceiver eventReceiver = new BroadcastReceiver() {
        @Override
        public void onReceive(Context context, Intent intent) {
            if (intent == null) {
                return;
            }
            String kind = intent.getStringExtra(TrackingIpcProvider.EXTRA_EVENT);
            if (kind == null) {
                return;
            }
            JSObject data = new JSObject();
            switch (kind) {
                case TrackingIpcProvider.EVENT_FIX:
                case TrackingIpcProvider.EVENT_STOP:
                    break;
                case TrackingIpcProvider.EVENT_WARNING:
                case TrackingIpcProvider.EVENT_FAILED:
                    data.put("message", intent.getStringExtra("message"));
                    break;
                case TrackingIpcProvider.EVENT_ADAPTIVE:
                    data.put("mode", intent.getStringExtra("mode"));
                    data.put("intervalSeconds", intent.getDoubleExtra("intervalSeconds", 0));
                    data.put("powerLevel", intent.getStringExtra("powerLevel"));
                    data.put("adaptiveReason", intent.getStringExtra("adaptiveReason"));
                    break;
                default:
                    return;
            }
            notifyListeners(kind, data);
        }
    };

    @Override
    public void load() {
        super.load();
        attachUi();
    }

    @Override
    protected void handleOnResume() {
        super.handleOnResume();
        attachUi();
    }

    @Override
    protected void handleOnPause() {
        detachUi();
        super.handleOnPause();
    }

    private void attachUi() {
        if (attached) {
            return;
        }
        ContextCompat.registerReceiver(getContext(), eventReceiver,
                new IntentFilter(TrackingIpcProvider.ACTION_EVENT),
                ContextCompat.RECEIVER_NOT_EXPORTED);
        eventReceiverRegistered = true;
        Bundle client = new Bundle();
        client.putString(TrackingIpcProvider.EXTRA_CLIENT_ID, clientId);
        client.putBinder(TrackingIpcProvider.EXTRA_CLIENT_BINDER, clientBinder);
        try {
            trackerCall(TrackingIpcProvider.METHOD_ATTACH, client);
            attached = true;
            Bundle state = trackerCall(TrackingIpcProvider.METHOD_STATE, null);
            if (!state.getBoolean("trackingIntent", false)) {
                String stopReason = state.getString("stopReason");
                if ("notification".equals(stopReason)) {
                    notifyListeners(TrackingIpcProvider.EVENT_STOP, new JSObject());
                } else if ("engine".equals(stopReason)) {
                    JSObject data = new JSObject();
                    data.put("message", state.getString("stopMessage"));
                    notifyListeners(TrackingIpcProvider.EVENT_FAILED, data);
                }
            }
            // The tracker may have buffered fixes while the UI was paused.
            notifyListeners(TrackingIpcProvider.EVENT_FIX, new JSObject());
        } catch (RuntimeException exception) {
            Log.e(TAG, "Could not attach to tracker process", exception);
            getContext().unregisterReceiver(eventReceiver);
            eventReceiverRegistered = false;
        }
    }

    @Override
    protected void handleOnDestroy() {
        // Only detach the callback path. The service keeps recording on
        // purpose: an activity teardown (rotation, task swipe, memory
        // pressure) is not the user asking to stop, and the fixes captured
        // meanwhile land in the durable buffer for the next attach.
        detachUi();
        super.handleOnDestroy();
    }

    private void detachUi() {
        if (attached) {
            Bundle client = new Bundle();
            client.putString(TrackingIpcProvider.EXTRA_CLIENT_ID, clientId);
            try {
                trackerCall(TrackingIpcProvider.METHOD_DETACH, client);
            } catch (RuntimeException exception) {
                Log.w(TAG, "Tracker process was unavailable during detach", exception);
            }
            attached = false;
        }
        if (eventReceiverRegistered) {
            getContext().unregisterReceiver(eventReceiver);
            eventReceiverRegistered = false;
        }
    }

    /**
     * Answers "could a recording start right now?" without starting one, so a
     * device that cannot track never persists a session, never creates a
     * zero-point recording on the server and never shows a foreground service.
     */
    @PluginMethod
    public void probe(PluginCall call) {
        // Asking for the permission is part of probing, not something to
        // report back as a failure: the probe replaced start() as the first
        // thing a recording does, so if it only reported "not granted" the
        // user would be told they lack a permission with nothing offering to
        // grant it.
        if (getPermissionState(LOCATION_ALIAS) != PermissionState.GRANTED) {
            requestPermissionForAlias(LOCATION_ALIAS, call, "probePermissionCallback");
            return;
        }
        resolveProbe(call);
    }

    @PermissionCallback
    private void probePermissionCallback(PluginCall call) {
        resolveProbe(call);
    }

    private void resolveProbe(PluginCall call) {
        String source = call.getString("locationSource", TrackingService.SOURCE_AUTO);
        JSObject result = new JSObject();
        String engine = TrackingService.resolveEngineName(getContext(), source);
        result.put("engine", engine);
        // B7: whether dropping the power tier can still produce fixes on this
        // device. The fused engine always can; the platform engine only when
        // a network provider backs it up.
        result.put(
            "coarseLocationAvailable",
            TrackingService.SOURCE_GMS.equals(engine)
                || PlatformLocationEngine.hasCoarseLocationBackend(getContext())
        );

        if (getPermissionState(LOCATION_ALIAS) != PermissionState.GRANTED) {
            result.put("ok", false);
            result.put("reason", "permission");
            result.put(
                "message",
                "OpenVoyage needs location permission to record a trip. Grant it in Android's app settings to start recording."
            );
            call.resolve(result);
            return;
        }
        if (!isLocationEnabled()) {
            result.put("ok", false);
            result.put("reason", "location-disabled");
            result.put("message", "Location services are turned off on this device.");
            call.resolve(result);
            return;
        }
        if (TrackingService.SOURCE_GMS.equals(engine) && !FusedLocationEngine.isAvailable(getContext())) {
            result.put("ok", false);
            result.put("reason", "engine-unavailable");
            result.put(
                "message",
                "Google Play Services is not available on this device. Change Location source in tracking settings to use the device's own GPS."
            );
            call.resolve(result);
            return;
        }
        if (TrackingService.SOURCE_PLATFORM.equals(engine) && !PlatformLocationEngine.isAvailable(getContext())) {
            result.put("ok", false);
            result.put("reason", "engine-unavailable");
            result.put("message", "No usable location provider is available on this device.");
            call.resolve(result);
            return;
        }

        result.put("ok", true);
        call.resolve(result);
    }

    @PluginMethod
    public void getState(PluginCall call) {
        try {
            call.resolve(describeState());
        } catch (RuntimeException exception) {
            call.reject("Tracker process is unavailable.", "TRACKER_UNAVAILABLE", exception);
        }
    }

    @PluginMethod
    public void start(PluginCall call) {
        if (!isLocationEnabled()) {
            call.reject("Location services are turned off on this device.", "LOCATION_DISABLED");
            return;
        }
        if (getPermissionState(LOCATION_ALIAS) != PermissionState.GRANTED) {
            requestPermissionForAlias(LOCATION_ALIAS, call, "locationPermissionCallback");
            return;
        }
        startService(call);
    }

    @PermissionCallback
    private void locationPermissionCallback(PluginCall call) {
        if (getPermissionState(LOCATION_ALIAS) != PermissionState.GRANTED) {
            call.reject("Location permission denied.", "NOT_AUTHORIZED");
            return;
        }
        startService(call);
    }

    private void startService(PluginCall call) {
        Intent intent = serviceIntent(TrackingService.ACTION_START, call);
        intent.putExtra(TrackingService.EXTRA_STARTED_AT, System.currentTimeMillis());
        try {
            ContextCompat.startForegroundService(getContext(), intent);
            call.resolve(describeState());
        } catch (RuntimeException exception) {
            call.reject("Could not start the tracker process.", "TRACKER_UNAVAILABLE", exception);
        }
    }

    /** Restores the persisted native recording without clearing its fix buffer. */
    @PluginMethod
    public void resume(PluginCall call) {
        try {
            if (!trackerCall(TrackingIpcProvider.METHOD_STATE, null)
                    .getBoolean("trackingIntent", false)) {
                call.resolve(describeState());
                return;
            }
            if (getPermissionState(LOCATION_ALIAS) != PermissionState.GRANTED) {
                call.reject("Location permission was revoked.", "NOT_AUTHORIZED");
                return;
            }
            ContextCompat.startForegroundService(getContext(),
                    new Intent(getContext(), TrackingService.class)
                            .setAction(TrackingService.ACTION_START));
            call.resolve();
        } catch (RuntimeException exception) {
            call.reject("Could not resume the tracker process.", "TRACKER_UNAVAILABLE", exception);
        }
    }

    @PluginMethod
    public void configure(PluginCall call) {
        try {
            if (!trackerCall(TrackingIpcProvider.METHOD_STATE, null)
                    .getBoolean("tracking", false)) {
                call.resolve(describeState());
                return;
            }
            getContext().startService(serviceIntent(TrackingService.ACTION_CONFIGURE, call));
            call.resolve(describeState());
        } catch (RuntimeException exception) {
            call.reject("Could not configure the tracker process.", "TRACKER_UNAVAILABLE", exception);
        }
    }

    @PluginMethod
    public void updateStatus(PluginCall call) {
        try {
            if (trackerCall(TrackingIpcProvider.METHOD_STATE, null)
                    .getBoolean("tracking", false)) {
                Intent intent = new Intent(getContext(), TrackingService.class)
                    .setAction(TrackingService.ACTION_UPDATE_NOTIFICATION);
                if (call.getString("title") != null) {
                    intent.putExtra(TrackingService.EXTRA_TITLE, call.getString("title"));
                }
                if (call.getString("text") != null) {
                    intent.putExtra(TrackingService.EXTRA_TEXT, call.getString("text"));
                }
                getContext().startService(intent);
            }
            call.resolve();
        } catch (RuntimeException exception) {
            call.reject("Could not update tracker status.", "TRACKER_UNAVAILABLE", exception);
        }
    }

    @PluginMethod
    public void stop(PluginCall call) {
        try {
            getContext().startService(new Intent(getContext(), TrackingService.class)
                    .setAction(TrackingService.ACTION_STOP));
            call.resolve();
        } catch (RuntimeException exception) {
            call.reject("Could not stop the tracker process.", "TRACKER_UNAVAILABLE", exception);
        }
    }

    /**
     * JS accepted a fix into its durable queue. Feeds the watchdog that tells
     * "no signal" apart from "signal too poor to record".
     */
    @PluginMethod
    public void noteSampleAccepted(PluginCall call) {
        try {
            trackerCall(TrackingIpcProvider.METHOD_ACCEPTED, null);
            call.resolve();
        } catch (RuntimeException exception) {
            call.reject("Tracker process is unavailable.", "TRACKER_UNAVAILABLE", exception);
        }
    }

    @PluginMethod
    public void drain(PluginCall call) {
        try {
            Bundle reply = trackerCall(TrackingIpcProvider.METHOD_DRAIN, null);
            JSObject result = new JSObject();
            result.put("fixes", new JSONArray(reply.getString("fixes", "[]")));
            result.put("droppedCount", reply.getInt("droppedCount", 0));
            result.put("hasMore", reply.getBoolean("hasMore", false));
            call.resolve(result);
        } catch (RuntimeException | JSONException exception) {
            call.reject("Could not read buffered fixes.", "TRACKER_UNAVAILABLE", exception);
        }
    }

    @PluginMethod
    public void getPowerState(PluginCall call) {
        JSObject result = new JSObject();
        BatteryManager batteryManager = (BatteryManager) getContext().getSystemService(Context.BATTERY_SERVICE);
        PowerManager powerManager = (PowerManager) getContext().getSystemService(Context.POWER_SERVICE);

        int level = batteryManager == null
            ? -1
            : batteryManager.getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY);
        result.put("batteryLevel", level < 0 || level > 100 ? null : level / 100.0);
        result.put(
            "charging",
            batteryManager != null && batteryManager.isCharging()
        );
        result.put("powerSaveMode", powerManager != null && powerManager.isPowerSaveMode());
        call.resolve(result);
    }

    private Intent serviceIntent(String action, PluginCall call) {
        Intent intent = new Intent(getContext(), TrackingService.class).setAction(action);
        intent.putExtra(
            TrackingService.EXTRA_INTERVAL_MS,
            (long) (call.getDouble("intervalSeconds", 30.0) * 1000)
        );
        intent.putExtra(
            TrackingService.EXTRA_MIN_INTERVAL_MS,
            (long) (call.getDouble("minIntervalSeconds", 5.0) * 1000)
        );
        intent.putExtra(
            TrackingService.EXTRA_DISTANCE_FILTER_M,
            call.getFloat("distanceFilterMeters", 0f)
        );
        intent.putExtra(
            TrackingService.EXTRA_POWER_LEVEL,
            call.getString("powerLevel", "high")
        );
        intent.putExtra(
            TrackingService.EXTRA_LOCATION_SOURCE,
            call.getString("locationSource", TrackingService.SOURCE_AUTO)
        );
        intent.putExtra(
            TrackingService.EXTRA_TRACKING_MODE,
            call.getString("mode", "manual")
        );
        intent.putExtra(
            TrackingService.EXTRA_BASELINE_INTERVAL_MS,
            (long) (call.getDouble("baselineIntervalSeconds", call.getDouble("intervalSeconds", 30.0)) * 1000)
        );
        intent.putExtra(
            TrackingService.EXTRA_BASELINE_POWER_LEVEL,
            call.getString("baselinePowerLevel", call.getString("powerLevel", "high"))
        );
        intent.putExtra(
            TrackingService.EXTRA_SMART_PRECISION,
            call.getInt("smartPrecision", 3)
        );
        if (call.getString("title") != null) {
            intent.putExtra(TrackingService.EXTRA_TITLE, call.getString("title"));
        }
        if (call.getString("text") != null) {
            intent.putExtra(TrackingService.EXTRA_TEXT, call.getString("text"));
        }
        return intent;
    }

    private JSObject describeState() {
        Bundle snapshot = trackerCall(TrackingIpcProvider.METHOD_STATE, null);
        JSObject result = new JSObject();
        result.put("tracking", snapshot.getBoolean("tracking", false));
        result.put("trackingIntent", snapshot.getBoolean("trackingIntent", false));
        result.put("stopReason", snapshot.getString("stopReason"));
        result.put("stopMessage", snapshot.getString("stopMessage"));
        result.put("stopAtMs", snapshot.getLong("stopAtMs", 0));
        result.put("startedAtMs", snapshot.getLong("startedAtMs", 0));
        result.put("intervalSeconds", snapshot.getDouble("intervalSeconds", 0));
        result.put("powerLevel", snapshot.getString("powerLevel"));
        result.put("mode", snapshot.getString("mode"));
        result.put("adaptiveReason", snapshot.getString("adaptiveReason"));
        result.put("bufferedFixes", snapshot.getInt("bufferedFixes", 0));
        result.put("engine", snapshot.getString("engine"));
        result.put("warning", snapshot.getString("warning"));
        result.put("locationEnabled", isLocationEnabled());
        result.put(
            "permissionGranted",
            getPermissionState(LOCATION_ALIAS) == PermissionState.GRANTED
        );
        return result;
    }

    private Bundle trackerCall(String method, Bundle extras) {
        Bundle result = getContext().getContentResolver().call(
                TrackingIpcProvider.uri(getContext()), method, null, extras);
        if (result == null) {
            throw new IllegalStateException("Tracker process did not respond to " + method);
        }
        return result;
    }

    private boolean isLocationEnabled() {
        LocationManager manager = (LocationManager) getContext().getSystemService(Context.LOCATION_SERVICE);
        if (manager == null) {
            return false;
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            return manager.isLocationEnabled();
        }
        return manager.isProviderEnabled(LocationManager.GPS_PROVIDER)
            || manager.isProviderEnabled(LocationManager.NETWORK_PROVIDER);
    }
}
