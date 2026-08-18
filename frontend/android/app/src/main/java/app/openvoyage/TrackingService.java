package app.openvoyage;

import android.Manifest;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.content.pm.ServiceInfo;
import android.location.Location;
import android.os.Build;
import android.os.IBinder;
import android.os.Looper;
import android.util.Log;

import androidx.core.app.NotificationCompat;
import androidx.core.app.ServiceCompat;
import androidx.core.content.ContextCompat;

import com.google.android.gms.location.FusedLocationProviderClient;
import com.google.android.gms.location.LocationAvailability;
import com.google.android.gms.location.LocationCallback;
import com.google.android.gms.location.LocationRequest;
import com.google.android.gms.location.LocationResult;
import com.google.android.gms.location.LocationServices;
import com.google.android.gms.location.Priority;

import org.json.JSONException;
import org.json.JSONObject;

/**
 * Foreground service that owns the device's location request for the lifetime
 * of a recording.
 *
 * <p>This replaces @capacitor-community/background-geolocation, whose watcher
 * identity lived only in webview JS memory. Any webview reload orphaned the
 * native watcher — location kept streaming, the foreground service kept
 * running, and no later Stop could ever reach it, so the OS went on reporting
 * "using your location" with no way to turn it off short of force-stopping the
 * app. Here the service itself is the single source of truth for "am I
 * tracking": JS re-attaches to it after a reload instead of starting a second
 * one, and stopping is an action on the service rather than on a JS-held
 * handle.
 *
 * <p>The service also holds the cadence. The old plugin hardcoded a 1 Hz
 * high-accuracy request and let JS discard the fixes it didn't want, which
 * spent full GPS power no matter what interval the user picked. The interval,
 * distance filter and accuracy priority are passed down to the OS here, so a
 * 5-minute interval actually costs a 5-minute interval — the prerequisite for
 * the battery-aware adaptive tracking in §8 Phase 3.
 */
public class TrackingService extends Service {

    private static final String TAG = "OVTrackingService";

    static final String ACTION_START = "app.openvoyage.tracking.START";
    static final String ACTION_STOP = "app.openvoyage.tracking.STOP";
    static final String ACTION_CONFIGURE = "app.openvoyage.tracking.CONFIGURE";
    static final String ACTION_UPDATE_NOTIFICATION = "app.openvoyage.tracking.UPDATE_NOTIFICATION";
    static final String ACTION_STOP_FROM_NOTIFICATION = "app.openvoyage.tracking.STOP_FROM_NOTIFICATION";
    static final String ACTION_NOTIFICATION_DISMISSED = "app.openvoyage.tracking.NOTIFICATION_DISMISSED";

    static final String EXTRA_INTERVAL_MS = "intervalMs";
    static final String EXTRA_MIN_INTERVAL_MS = "minIntervalMs";
    static final String EXTRA_DISTANCE_FILTER_M = "distanceFilterMeters";
    static final String EXTRA_HIGH_ACCURACY = "highAccuracy";
    static final String EXTRA_TITLE = "title";
    static final String EXTRA_TEXT = "text";
    static final String EXTRA_STARTED_AT = "startedAtMs";

    static final String CHANNEL_ID = "openvoyage.tracking";
    private static final int NOTIFICATION_ID = 4711;

    private static final String PREFS_NAME = "openvoyage.tracking.service";
    private static final String PREF_TRACKING = "tracking";

    /**
     * Set while a recording is live so the plugin can answer "are you already
     * tracking?" without binding, which is what lets a freshly reloaded webview
     * re-attach instead of starting a duplicate recording.
     */
    private static volatile TrackingService instance = null;

    /** Receives fixes and stop requests; null whenever no webview is attached. */
    interface Listener {
        void onFixBuffered();

        void onStopRequestedFromNotification();
    }

    private static volatile Listener listener = null;

    private FusedLocationProviderClient client;
    private LocationCallback locationCallback;
    private TrackingFixBuffer buffer;

    private boolean tracking = false;
    private long intervalMs = 30_000L;
    private long minIntervalMs = 10_000L;
    private float distanceFilterMeters = 0f;
    private boolean highAccuracy = true;
    private long startedAtMs = 0L;
    private String notificationTitle = "Recording trip";
    private String notificationText = "Starting…";

    static TrackingService getInstance() {
        return instance;
    }

    static void setListener(Listener value) {
        listener = value;
    }

    static boolean isTrackingKnownFromPrefs(Context context) {
        return context
                .getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
                .getBoolean(PREF_TRACKING, false);
    }

    boolean isTracking() {
        return tracking;
    }

    long getStartedAtMs() {
        return startedAtMs;
    }

    long getIntervalMs() {
        return intervalMs;
    }

    boolean isHighAccuracy() {
        return highAccuracy;
    }

    TrackingFixBuffer getBuffer() {
        return buffer;
    }

    @Override
    public void onCreate() {
        super.onCreate();
        client = LocationServices.getFusedLocationProviderClient(this);
        buffer = new TrackingFixBuffer(this);
        createNotificationChannel();
        // Published last, and only once this instance is fully built: the
        // plugin reads `instance` from the Capacitor plugin thread, so a
        // reference handed out mid-construction hands out half an object.
        instance = this;
    }

    @Override
    public IBinder onBind(Intent intent) {
        // Deliberately not bindable: the previous implementation tore all
        // watchers down in onUnbind, which meant an activity teardown could
        // silently end a recording that was supposed to survive it.
        return null;
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        // A null intent means the system restarted us after a process kill
        // (START_STICKY). The recording was live when we died, so resume it
        // from the persisted config rather than sitting there doing nothing.
        String action = intent == null ? ACTION_START : intent.getAction();
        if (action == null) {
            action = ACTION_START;
        }

        switch (action) {
            case ACTION_START:
                handleStart(intent);
                break;
            case ACTION_CONFIGURE:
                handleConfigure(intent);
                break;
            case ACTION_UPDATE_NOTIFICATION:
                handleUpdateNotification(intent);
                break;
            case ACTION_NOTIFICATION_DISMISSED:
                // Android 14+ lets the user swipe away an ongoing
                // foreground-service notification. Location would then keep
                // running with nothing on screen saying so, which is exactly
                // the state this whole change exists to prevent, so put it
                // back while the recording is live.
                if (tracking) {
                    postNotification();
                }
                break;
            case ACTION_STOP_FROM_NOTIFICATION:
                handleStopFromNotification();
                break;
            case ACTION_STOP:
            default:
                stopTracking();
                break;
        }

        return START_STICKY;
    }

    private void handleStart(Intent intent) {
        SharedPreferences prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);

        if (intent != null && intent.hasExtra(EXTRA_INTERVAL_MS)) {
            readConfig(intent);
            startedAtMs = intent.getLongExtra(EXTRA_STARTED_AT, System.currentTimeMillis());
            persistConfig(prefs);
            // A fresh start, so anything still buffered belongs to a recording
            // that has already finished. Draining it into the new session
            // would file those points under the wrong session and stamp them
            // with times before its started_at — which the server discards
            // silently, taking the real points of the batch with them.
            buffer.drain();
        } else {
            restoreConfig(prefs);
        }

        tracking = true;
        prefs.edit().putBoolean(PREF_TRACKING, true).apply();

        postNotificationAsForeground();
        requestLocationUpdates();
    }

    private void handleConfigure(Intent intent) {
        if (!tracking || intent == null) {
            return;
        }
        readConfig(intent);
        persistConfig(getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE));
        requestLocationUpdates();
    }

    private void handleUpdateNotification(Intent intent) {
        if (intent == null) {
            return;
        }
        if (intent.hasExtra(EXTRA_TITLE)) {
            notificationTitle = intent.getStringExtra(EXTRA_TITLE);
        }
        if (intent.hasExtra(EXTRA_TEXT)) {
            notificationText = intent.getStringExtra(EXTRA_TEXT);
        }
        persistConfig(getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE));
        if (tracking) {
            postNotification();
        }
    }

    private void handleStopFromNotification() {
        stopTracking();
        Listener current = listener;
        if (current != null) {
            current.onStopRequestedFromNotification();
        }
    }

    private void readConfig(Intent intent) {
        intervalMs = intent.getLongExtra(EXTRA_INTERVAL_MS, intervalMs);
        minIntervalMs = intent.getLongExtra(EXTRA_MIN_INTERVAL_MS, Math.min(minIntervalMs, intervalMs));
        distanceFilterMeters = intent.getFloatExtra(EXTRA_DISTANCE_FILTER_M, distanceFilterMeters);
        highAccuracy = intent.getBooleanExtra(EXTRA_HIGH_ACCURACY, highAccuracy);
        if (intent.hasExtra(EXTRA_TITLE)) {
            notificationTitle = intent.getStringExtra(EXTRA_TITLE);
        }
        if (intent.hasExtra(EXTRA_TEXT)) {
            notificationText = intent.getStringExtra(EXTRA_TEXT);
        }
    }

    private void persistConfig(SharedPreferences prefs) {
        prefs
                .edit()
                .putLong(EXTRA_INTERVAL_MS, intervalMs)
                .putLong(EXTRA_MIN_INTERVAL_MS, minIntervalMs)
                .putFloat(EXTRA_DISTANCE_FILTER_M, distanceFilterMeters)
                .putBoolean(EXTRA_HIGH_ACCURACY, highAccuracy)
                .putLong(EXTRA_STARTED_AT, startedAtMs)
                .putString(EXTRA_TITLE, notificationTitle)
                .putString(EXTRA_TEXT, notificationText)
                .apply();
    }

    private void restoreConfig(SharedPreferences prefs) {
        intervalMs = prefs.getLong(EXTRA_INTERVAL_MS, intervalMs);
        minIntervalMs = prefs.getLong(EXTRA_MIN_INTERVAL_MS, minIntervalMs);
        distanceFilterMeters = prefs.getFloat(EXTRA_DISTANCE_FILTER_M, distanceFilterMeters);
        highAccuracy = prefs.getBoolean(EXTRA_HIGH_ACCURACY, highAccuracy);
        startedAtMs = prefs.getLong(EXTRA_STARTED_AT, System.currentTimeMillis());
        notificationTitle = prefs.getString(EXTRA_TITLE, notificationTitle);
        notificationText = prefs.getString(EXTRA_TEXT, notificationText);
    }

    private void requestLocationUpdates() {
        if (!hasLocationPermission()) {
            Log.w(TAG, "Location permission missing; not requesting updates");
            return;
        }

        removeLocationUpdates();

        int priority = highAccuracy
                ? Priority.PRIORITY_HIGH_ACCURACY
                : Priority.PRIORITY_BALANCED_POWER_ACCURACY;

        LocationRequest request = new LocationRequest.Builder(priority, intervalMs)
                // The OS may hand us a fix sooner than intervalMs if another
                // app is already asking for one; taking it is free accuracy.
                .setMinUpdateIntervalMillis(Math.min(minIntervalMs, intervalMs))
                .setMinUpdateDistanceMeters(distanceFilterMeters)
                // Batching windows let the modem sleep between fixes, but they
                // also delay delivery past the point where an upload would
                // still be timely, so cap the slack at one interval.
                .setMaxUpdateDelayMillis(intervalMs)
                .setWaitForAccurateLocation(highAccuracy)
                .build();

        locationCallback = new LocationCallback() {
            @Override
            public void onLocationResult(LocationResult result) {
                for (Location location : result.getLocations()) {
                    onFix(location);
                }
            }

            @Override
            public void onLocationAvailability(LocationAvailability availability) {
                if (!availability.isLocationAvailable()) {
                    Log.d(TAG, "Location temporarily unavailable");
                }
            }
        };

        try {
            client.requestLocationUpdates(request, locationCallback, Looper.getMainLooper());
        } catch (SecurityException exception) {
            Log.e(TAG, "Location permission revoked mid-recording", exception);
        }
    }

    private void removeLocationUpdates() {
        if (locationCallback != null) {
            client.removeLocationUpdates(locationCallback);
            locationCallback = null;
        }
    }

    private void onFix(Location location) {
        JSONObject fix = new JSONObject();
        try {
            fix.put("latitude", location.getLatitude());
            fix.put("longitude", location.getLongitude());
            fix.put("accuracy", location.hasAccuracy() ? location.getAccuracy() : JSONObject.NULL);
            fix.put("altitude", location.hasAltitude() ? location.getAltitude() : JSONObject.NULL);
            fix.put("speed", location.hasSpeed() ? location.getSpeed() : JSONObject.NULL);
            fix.put("bearing", location.hasBearing() ? location.getBearing() : JSONObject.NULL);
            fix.put("time", location.getTime());
            fix.put("simulated", location.isFromMockProvider());
        } catch (JSONException exception) {
            Log.e(TAG, "Could not serialize fix", exception);
            return;
        }

        buffer.append(fix);

        Listener current = listener;
        if (current != null) {
            current.onFixBuffered();
        }
    }

    private void stopTracking() {
        tracking = false;
        removeLocationUpdates();
        getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
                .edit()
                .putBoolean(PREF_TRACKING, false)
                .apply();
        ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE);
        stopSelf();
    }

    @Override
    public void onDestroy() {
        // Belt and braces: whatever route brought us here — stopSelf, a system
        // kill, the user swiping the task away — the location request must not
        // outlive the service. Leaking it is the exact failure this class was
        // written to eliminate.
        removeLocationUpdates();
        if (instance == this) {
            instance = null;
        }
        super.onDestroy();
    }

    private boolean hasLocationPermission() {
        return ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION)
                == PackageManager.PERMISSION_GRANTED
                || ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_COARSE_LOCATION)
                == PackageManager.PERMISSION_GRANTED;
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            return;
        }
        NotificationManager manager = getSystemService(NotificationManager.class);
        if (manager == null) {
            return;
        }
        NotificationChannel channel = new NotificationChannel(
                CHANNEL_ID,
                getString(R.string.tracking_notification_channel_name),
                NotificationManager.IMPORTANCE_LOW
        );
        channel.setDescription(getString(R.string.tracking_notification_channel_description));
        channel.enableLights(false);
        channel.enableVibration(false);
        channel.setSound(null, null);
        channel.setShowBadge(false);
        manager.createNotificationChannel(channel);
    }

    private Notification buildNotification() {
        Intent launchIntent = getPackageManager().getLaunchIntentForPackage(getPackageName());
        PendingIntent contentIntent = null;
        if (launchIntent != null) {
            launchIntent.addFlags(Intent.FLAG_ACTIVITY_REORDER_TO_FRONT);
            contentIntent = PendingIntent.getActivity(
                    this,
                    0,
                    launchIntent,
                    PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
            );
        }

        PendingIntent stopIntent = PendingIntent.getService(
                this,
                1,
                new Intent(this, TrackingService.class).setAction(ACTION_STOP_FROM_NOTIFICATION),
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        PendingIntent dismissIntent = PendingIntent.getService(
                this,
                2,
                new Intent(this, TrackingService.class).setAction(ACTION_NOTIFICATION_DISMISSED),
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        NotificationCompat.Builder builder = new NotificationCompat.Builder(this, CHANNEL_ID)
                .setContentTitle(notificationTitle)
                .setContentText(notificationText)
                .setStyle(new NotificationCompat.BigTextStyle().bigText(notificationText))
                .setSmallIcon(R.drawable.ic_stat_tracking)
                .setOngoing(true)
                .setSilent(true)
                .setOnlyAlertOnce(true)
                .setShowWhen(true)
                .setWhen(startedAtMs > 0 ? startedAtMs : System.currentTimeMillis())
                // The elapsed time ticks on its own, so the notification still
                // looks alive between the status updates JS pushes.
                .setUsesChronometer(true)
                .setCategory(NotificationCompat.CATEGORY_SERVICE)
                .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
                .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
                .setDeleteIntent(dismissIntent)
                .addAction(0, getString(R.string.tracking_notification_stop), stopIntent);

        if (contentIntent != null) {
            builder.setContentIntent(contentIntent);
        }

        return builder.build();
    }

    private void postNotificationAsForeground() {
        try {
            ServiceCompat.startForeground(
                    this,
                    NOTIFICATION_ID,
                    buildNotification(),
                    Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q
                            ? ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION
                            : 0
            );
        } catch (Exception exception) {
            Log.e(TAG, "Could not promote tracking service to foreground", exception);
        }
    }

    private void postNotification() {
        NotificationManager manager = getSystemService(NotificationManager.class);
        if (manager == null) {
            return;
        }
        try {
            manager.notify(NOTIFICATION_ID, buildNotification());
        } catch (Exception exception) {
            Log.e(TAG, "Could not update tracking notification", exception);
        }
    }
}
