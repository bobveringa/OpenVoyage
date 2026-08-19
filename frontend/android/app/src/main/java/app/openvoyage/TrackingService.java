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
import android.os.Handler;
import android.os.Looper;
import android.util.Log;

import androidx.core.app.NotificationCompat;
import androidx.core.app.ServiceCompat;
import androidx.core.content.ContextCompat;


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
    static final String EXTRA_POWER_LEVEL = "powerLevel";
    static final String EXTRA_TITLE = "title";
    static final String EXTRA_TEXT = "text";
    static final String EXTRA_STARTED_AT = "startedAtMs";
    static final String EXTRA_LOCATION_SOURCE = "locationSource";

    static final String SOURCE_AUTO = "auto";
    static final String SOURCE_GMS = "gms";
    static final String SOURCE_PLATFORM = "platform";

    /**
     * A cold GPS fix legitimately takes 30-60s outdoors and longer indoors,
     * so the no-fix warning has to be generous or it cries wolf in every
     * building. It warns; it never stops the recording.
     */
    private static final long MIN_NO_FIX_WARNING_MS = 60_000L;
    private static final long NO_FIX_CHECK_INTERVAL_MS = 15_000L;
    // The wait for the *first* fix deliberately does not scale with the
    // interval: a cold GPS fix takes the same 30-90s outdoors whether the user
    // asked for a point every 10s or every 5 minutes. Scaling it meant a
    // "Max battery" recording (300s interval) that could produce no fix at all
    // -- a low-power request on a device with no coarse-location backend -- hid
    // that for ten minutes before warning. A subsequent gap, by contrast, is
    // only meaningful relative to the interval, so that one still scales.
    private static final long FIRST_FIX_WARNING_MS = 90_000L;

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

        /** Soft: the engine has gone quiet. null clears the warning. */
        void onEngineWarning(String message);

        /** Hard: the engine cannot deliver fixes at all. */
        void onEngineFailed(String message);
    }

    private static volatile Listener listener = null;

    private LocationEngine engine;
    private TrackingFixBuffer buffer;
    private Handler handler;

    private boolean tracking = false;
    private long intervalMs = 30_000L;
    private long minIntervalMs = 10_000L;
    private float distanceFilterMeters = 0f;
    private LocationEngine.Power power = LocationEngine.Power.HIGH;
    private long startedAtMs = 0L;
    private String notificationTitle = "Recording trip";
    private String notificationText = "Starting…";
    private String locationSource = SOURCE_AUTO;

    /** Non-null while the engine is failing or has gone quiet. */
    private String warningText = null;
    private long lastFixAtMs = 0L;
    // Distinct from lastFixAtMs on purpose. A fix arriving is not the same as a
    // point being recorded: the JS side still applies an accuracy cutoff, and
    // when that rejects everything the recording silently stops producing
    // anything while raw fixes keep resetting the watchdog. Tracking both lets
    // the two failures be told apart and reported differently.
    private long lastAcceptedAtMs = 0L;
    private boolean listenerAttached = false;
    private Runnable noFixCheck = null;

    static TrackingService getInstance() {
        return instance;
    }

    static void setListener(Listener value) {
        listener = value;
        TrackingService current = instance;
        if (current != null) {
            current.listenerAttached = value != null;
            if (value != null) {
                // A freshly attached webview has not had a chance to accept
                // anything yet; don't hold its predecessor's silence against it.
                current.lastAcceptedAtMs = System.currentTimeMillis();
            }
        }
    }

    void noteSampleAccepted() {
        lastAcceptedAtMs = System.currentTimeMillis();
        clearWarning();
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

    String getPowerLevel() {
        return power.wireName();
    }

    String getEngineName() {
        return engine == null ? "none" : engine.getName();
    }

    String getWarningText() {
        return warningText;
    }

    /** Resolves the configured preference to the engine that will be used. */
    static String resolveEngineName(Context context, String source) {
        if (SOURCE_PLATFORM.equals(source)) {
            return SOURCE_PLATFORM;
        }
        if (SOURCE_GMS.equals(source)) {
            return SOURCE_GMS;
        }
        return FusedLocationEngine.isAvailable(context) ? SOURCE_GMS : SOURCE_PLATFORM;
    }

    TrackingFixBuffer getBuffer() {
        return buffer;
    }

    @Override
    public void onCreate() {
        super.onCreate();
        handler = new Handler(Looper.getMainLooper());
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
        lastAcceptedAtMs = 0L;
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
        if (intent.hasExtra(EXTRA_POWER_LEVEL)) {
            power = LocationEngine.Power.parse(intent.getStringExtra(EXTRA_POWER_LEVEL));
        }
        if (intent.hasExtra(EXTRA_LOCATION_SOURCE)) {
            locationSource = intent.getStringExtra(EXTRA_LOCATION_SOURCE);
        }
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
                .putString(EXTRA_POWER_LEVEL, power.wireName())
                .putString(EXTRA_LOCATION_SOURCE, locationSource)
                .putLong(EXTRA_STARTED_AT, startedAtMs)
                .putString(EXTRA_TITLE, notificationTitle)
                .putString(EXTRA_TEXT, notificationText)
                .apply();
    }

    private void restoreConfig(SharedPreferences prefs) {
        intervalMs = prefs.getLong(EXTRA_INTERVAL_MS, intervalMs);
        minIntervalMs = prefs.getLong(EXTRA_MIN_INTERVAL_MS, minIntervalMs);
        distanceFilterMeters = prefs.getFloat(EXTRA_DISTANCE_FILTER_M, distanceFilterMeters);
        power = LocationEngine.Power.parse(
                prefs.getString(EXTRA_POWER_LEVEL, power.wireName())
        );
        locationSource = prefs.getString(EXTRA_LOCATION_SOURCE, locationSource);
        startedAtMs = prefs.getLong(EXTRA_STARTED_AT, System.currentTimeMillis());
        notificationTitle = prefs.getString(EXTRA_TITLE, notificationTitle);
        notificationText = prefs.getString(EXTRA_TEXT, notificationText);
    }

    private void requestLocationUpdates() {
        if (!hasLocationPermission()) {
            onEngineFailure("Location permission has not been granted.");
            return;
        }

        removeLocationUpdates();

        String resolved = resolveEngineName(this, locationSource);
        if (SOURCE_GMS.equals(resolved) && !FusedLocationEngine.isAvailable(this)) {
            // Only reachable when the user pinned "Google Play Services" on a
            // device that does not have it. Saying so beats failing quietly.
            onEngineFailure("Google Play Services is not available on this device.");
            return;
        }

        engine = SOURCE_GMS.equals(resolved)
                ? new FusedLocationEngine(this)
                : new PlatformLocationEngine(this);

        clearWarning();
        lastFixAtMs = 0L;

        engine.start(
                new LocationEngine.Config(
                        intervalMs,
                        Math.min(minIntervalMs, intervalMs),
                        distanceFilterMeters,
                        power
                ),
                new LocationEngine.Callback() {
                    @Override
                    public void onLocation(Location location) {
                        onFix(location);
                    }

                    @Override
                    public void onFailure(String message) {
                        onEngineFailure(message);
                    }
                }
        );

        scheduleNoFixCheck();
    }

    private void removeLocationUpdates() {
        cancelNoFixCheck();
        if (engine != null) {
            engine.stop();
            engine = null;
        }
    }

    /**
     * The engine has gone quiet without failing. Ambiguous — a cold fix, a
     * tunnel, a basement — so this warns and leaves the recording running.
     * Ending it here would close a session that cannot be reopened, turning a
     * gap in a track into two separate tracks.
     */
    private void scheduleNoFixCheck() {
        cancelNoFixCheck();
        noFixCheck = new Runnable() {
            @Override
            public void run() {
                if (!tracking) {
                    return;
                }
                long now = System.currentTimeMillis();
                boolean hadFirstFix = lastFixAtMs > 0;
                long sinceFix = now - (hadFirstFix ? lastFixAtMs : startedAtMs);
                long fixThreshold = hadFirstFix
                        ? Math.max(MIN_NO_FIX_WARNING_MS, intervalMs * 2)
                        : FIRST_FIX_WARNING_MS;

                if (sinceFix > fixThreshold) {
                    setWarning(
                            hadFirstFix
                                    ? "No GPS signal right now - still recording."
                                    : "Waiting for a GPS fix. This can take a minute outdoors, longer indoors."
                                            + (SOURCE_GMS.equals(getEngineName())
                                                    ? ""
                                                    : " If it never arrives, try another Location source in tracking settings.")
                    );
                    handler.postDelayed(this, NO_FIX_CHECK_INTERVAL_MS);
                    return;
                }

                // Fixes are arriving but nothing is being recorded. Only
                // meaningful while a webview is attached to do the accepting;
                // with none attached, fixes are simply buffered for later.
                long sinceAccepted = now - (lastAcceptedAtMs > 0 ? lastAcceptedAtMs : startedAtMs);
                long acceptThreshold = Math.max(MIN_NO_FIX_WARNING_MS, intervalMs * 3);
                if (listenerAttached && hadFirstFix && sinceAccepted > acceptThreshold) {
                    setWarning("GPS signal is too weak to record accurately - some points are being skipped.");
                } else {
                    clearWarning();
                }
                handler.postDelayed(this, NO_FIX_CHECK_INTERVAL_MS);
            }
        };
        handler.postDelayed(noFixCheck, NO_FIX_CHECK_INTERVAL_MS);
    }

    private void cancelNoFixCheck() {
        if (noFixCheck != null) {
            handler.removeCallbacks(noFixCheck);
            noFixCheck = null;
        }
    }

    private void setWarning(String message) {
        if (message.equals(warningText)) {
            return;
        }
        warningText = message;
        if (tracking) {
            postNotification();
        }
        Listener current = listener;
        if (current != null) {
            current.onEngineWarning(message);
        }
    }

    private void clearWarning() {
        if (warningText == null) {
            return;
        }
        warningText = null;
        if (tracking) {
            postNotification();
        }
        Listener current = listener;
        if (current != null) {
            current.onEngineWarning(null);
        }
    }

    /**
     * A hard failure: no fix will ever arrive from this engine. Location
     * updates stop, the flag is cleared so a relaunch does not think a
     * recording is still live, and the notification is detached rather than
     * removed so the reason survives the service — otherwise the recording
     * would simply vanish with no explanation on a device where JS is not
     * running to receive the event.
     */
    private void onEngineFailure(String message) {
        Log.e(TAG, "Location engine failed: " + message);
        cancelNoFixCheck();
        if (engine != null) {
            engine.stop();
            engine = null;
        }
        tracking = false;
        // The failure is the notification's whole content below, so leaving
        // it in warningText too would render it twice ("... · ...").
        warningText = null;
        getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
                .edit()
                .putBoolean(PREF_TRACKING, false)
                .apply();

        notificationTitle = "Tracking stopped";
        notificationText = message;
        postNotification();
        ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_DETACH);

        Listener current = listener;
        if (current != null) {
            current.onEngineFailed(message);
        }
        stopSelf();
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

        lastFixAtMs = System.currentTimeMillis();
        buffer.append(fix);

        Listener current = listener;
        if (current != null) {
            current.onFixBuffered();
        }
    }

    private void stopTracking() {
        tracking = false;
        warningText = null;
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

        String text = warningText == null
                ? notificationText
                : warningText + " · " + notificationText;

        NotificationCompat.Builder builder = new NotificationCompat.Builder(this, CHANNEL_ID)
                .setContentTitle(notificationTitle)
                .setContentText(text)
                .setStyle(new NotificationCompat.BigTextStyle().bigText(text))
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
