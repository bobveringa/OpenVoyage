package app.openvoyage;

import android.Manifest;
import android.content.Context;
import android.content.Intent;
import android.location.LocationManager;
import android.os.BatteryManager;
import android.os.Build;
import android.os.PowerManager;

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
public class TrackingPlugin extends Plugin implements TrackingService.Listener {

    static final String LOCATION_ALIAS = "location";

    @Override
    public void load() {
        super.load();
        TrackingService.setListener(this);
    }

    @Override
    protected void handleOnDestroy() {
        // Only detach the callback path. The service keeps recording on
        // purpose: an activity teardown (rotation, task swipe, memory
        // pressure) is not the user asking to stop, and the fixes captured
        // meanwhile land in the durable buffer for the next attach.
        TrackingService.setListener(null);
        super.handleOnDestroy();
    }

    @Override
    public void onFixBuffered() {
        // Just a nudge. The payload is fetched with drain() so that a fix
        // arriving mid-reload is still handed over, rather than being emitted
        // into a webview that no longer exists.
        notifyListeners("fixAvailable", new JSObject());
    }

    @Override
    public void onStopRequestedFromNotification() {
        notifyListeners("stopRequested", new JSObject());
    }

    @PluginMethod
    public void getState(PluginCall call) {
        call.resolve(describeState());
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
        ContextCompat.startForegroundService(getContext(), intent);
        call.resolve(describeState());
    }

    @PluginMethod
    public void configure(PluginCall call) {
        if (TrackingService.getInstance() == null) {
            call.resolve(describeState());
            return;
        }
        getContext().startService(serviceIntent(TrackingService.ACTION_CONFIGURE, call));
        call.resolve(describeState());
    }

    @PluginMethod
    public void updateStatus(PluginCall call) {
        if (TrackingService.getInstance() == null) {
            call.resolve();
            return;
        }
        Intent intent = new Intent(getContext(), TrackingService.class)
            .setAction(TrackingService.ACTION_UPDATE_NOTIFICATION);
        if (call.getString("title") != null) {
            intent.putExtra(TrackingService.EXTRA_TITLE, call.getString("title"));
        }
        if (call.getString("text") != null) {
            intent.putExtra(TrackingService.EXTRA_TEXT, call.getString("text"));
        }
        getContext().startService(intent);
        call.resolve();
    }

    @PluginMethod
    public void stop(PluginCall call) {
        getContext()
            .startService(
                new Intent(getContext(), TrackingService.class).setAction(TrackingService.ACTION_STOP)
            );
        call.resolve();
    }

    @PluginMethod
    public void drain(PluginCall call) {
        TrackingService service = TrackingService.getInstance();
        JSObject result = new JSObject();
        if (service == null) {
            result.put("fixes", new JSONArray());
            result.put("droppedCount", 0);
            call.resolve(result);
            return;
        }
        TrackingFixBuffer buffer = service.getBuffer();
        if (buffer == null) {
            result.put("fixes", new JSONArray());
            result.put("droppedCount", 0);
            call.resolve(result);
            return;
        }
        int dropped = buffer.getDroppedCount();
        result.put("fixes", buffer.drain());
        result.put("droppedCount", dropped);
        call.resolve(result);
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
            TrackingService.EXTRA_HIGH_ACCURACY,
            Boolean.TRUE.equals(call.getBoolean("highAccuracy", true))
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
        TrackingService service = TrackingService.getInstance();
        JSObject result = new JSObject();
        boolean tracking = service != null && service.isTracking();
        result.put("tracking", tracking);
        // The service is gone but the flag survived: the process was killed
        // mid-recording and the system has not restarted the service yet. JS
        // needs to know so it can resume rather than treat the recording as
        // finished.
        result.put(
            "trackingIntent",
            tracking || TrackingService.isTrackingKnownFromPrefs(getContext())
        );
        result.put("startedAtMs", service == null ? 0 : service.getStartedAtMs());
        result.put("intervalSeconds", service == null ? 0 : service.getIntervalMs() / 1000.0);
        result.put("highAccuracy", service == null || service.isHighAccuracy());
        TrackingFixBuffer buffer = service == null ? null : service.getBuffer();
        result.put("bufferedFixes", buffer == null ? 0 : buffer.size());
        result.put("locationEnabled", isLocationEnabled());
        result.put(
            "permissionGranted",
            getPermissionState(LOCATION_ALIAS) == PermissionState.GRANTED
        );
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
