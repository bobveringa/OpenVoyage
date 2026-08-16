package app.openvoyage;

import android.Manifest;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.PowerManager;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;

/**
 * Prompts the background-geolocation plugin doesn't cover itself: exempting
 * the app from battery optimization, (Android 13+) granting
 * POST_NOTIFICATIONS so the foreground-service notification is visible, and
 * (Android 10+) granting ACCESS_BACKGROUND_LOCATION as a belt-and-suspenders
 * measure on top of the foreground-service exemption. All three are
 * surfaced during tracking onboarding (design doc §11).
 */
@CapacitorPlugin(
    name = "TrackingOnboarding",
    permissions = {
        @Permission(strings = { Manifest.permission.POST_NOTIFICATIONS }, alias = "notifications"),
        @Permission(strings = { Manifest.permission.ACCESS_BACKGROUND_LOCATION }, alias = "backgroundLocation"),
    }
)
public class TrackingOnboardingPlugin extends Plugin {

    @PluginMethod
    public void isIgnoringBatteryOptimizations(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("ignoring", isIgnoringBatteryOptimizations());
        call.resolve(ret);
    }

    @PluginMethod
    public void requestIgnoreBatteryOptimizations(PluginCall call) {
        if (isIgnoringBatteryOptimizations()) {
            JSObject ret = new JSObject();
            ret.put("ignoring", true);
            call.resolve(ret);
            return;
        }

        Intent intent = new Intent(android.provider.Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS);
        intent.setData(Uri.parse("package:" + getContext().getPackageName()));
        startActivityForResult(call, intent, "batteryOptimizationResult");
    }

    @ActivityCallback
    private void batteryOptimizationResult(PluginCall call, androidx.activity.result.ActivityResult result) {
        if (call == null) {
            return;
        }
        JSObject ret = new JSObject();
        ret.put("ignoring", isIgnoringBatteryOptimizations());
        call.resolve(ret);
    }

    private boolean isIgnoringBatteryOptimizations() {
        PowerManager powerManager = (PowerManager) getContext().getSystemService(Context.POWER_SERVICE);
        return powerManager != null && powerManager.isIgnoringBatteryOptimizations(getContext().getPackageName());
    }

    @PluginMethod
    public void isNotificationPermissionGranted(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("granted", isNotificationPermissionGranted());
        call.resolve(ret);
    }

    @PluginMethod
    public void requestNotificationPermission(PluginCall call) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) {
            JSObject ret = new JSObject();
            ret.put("granted", true);
            call.resolve(ret);
            return;
        }
        if (getPermissionState("notifications") == PermissionState.GRANTED) {
            JSObject ret = new JSObject();
            ret.put("granted", true);
            call.resolve(ret);
            return;
        }
        requestPermissionForAlias("notifications", call, "notificationPermissionResult");
    }

    @com.getcapacitor.annotation.PermissionCallback
    private void notificationPermissionResult(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("granted", isNotificationPermissionGranted());
        call.resolve(ret);
    }

    private boolean isNotificationPermissionGranted() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) {
            return true;
        }
        return getPermissionState("notifications") == PermissionState.GRANTED;
    }

    @PluginMethod
    public void isBackgroundLocationGranted(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("granted", isBackgroundLocationGranted());
        call.resolve(ret);
    }

    @PluginMethod
    public void requestBackgroundLocation(PluginCall call) {
        // Below Q, foreground location already implies background delivery;
        // there is no separate permission to request.
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
            JSObject ret = new JSObject();
            ret.put("granted", true);
            call.resolve(ret);
            return;
        }
        if (isBackgroundLocationGranted()) {
            JSObject ret = new JSObject();
            ret.put("granted", true);
            call.resolve(ret);
            return;
        }
        // The OS rejects a background-location request bundled with
        // foreground location, and silently no-ops one made before
        // foreground is granted, so this is only meaningful once the
        // caller has already started the position watcher successfully.
        if (!isForegroundLocationGranted()) {
            JSObject ret = new JSObject();
            ret.put("granted", false);
            call.resolve(ret);
            return;
        }
        requestPermissionForAlias("backgroundLocation", call, "backgroundLocationResult");
    }

    @com.getcapacitor.annotation.PermissionCallback
    private void backgroundLocationResult(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("granted", isBackgroundLocationGranted());
        call.resolve(ret);
    }

    private boolean isBackgroundLocationGranted() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
            return isForegroundLocationGranted();
        }
        return getPermissionState("backgroundLocation") == PermissionState.GRANTED;
    }

    private boolean isForegroundLocationGranted() {
        return (
            androidx.core.content.ContextCompat.checkSelfPermission(
                getContext(),
                Manifest.permission.ACCESS_FINE_LOCATION
            ) == android.content.pm.PackageManager.PERMISSION_GRANTED
            || androidx.core.content.ContextCompat.checkSelfPermission(
                getContext(),
                Manifest.permission.ACCESS_COARSE_LOCATION
            ) == android.content.pm.PackageManager.PERMISSION_GRANTED
        );
    }
}
