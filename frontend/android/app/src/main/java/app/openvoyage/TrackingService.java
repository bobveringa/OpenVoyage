package app.openvoyage;

import android.Manifest;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.IntentFilter;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.content.pm.ServiceInfo;
import android.location.Location;
import android.os.BatteryManager;
import android.os.Build;
import android.os.IBinder;
import android.os.Handler;
import android.os.Looper;
import android.os.PowerManager;
import android.os.SystemClock;
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
    static final String EXTRA_ANCHOR_ELAPSED_NS = "anchorElapsedNs";
    static final String EXTRA_ANCHOR_WALL_MS = "anchorWallMs";
    static final String EXTRA_TRACKING_MODE = "trackingMode";
    static final String EXTRA_BASELINE_INTERVAL_MS = "baselineIntervalMs";
    static final String EXTRA_BASELINE_POWER_LEVEL = "baselinePowerLevel";

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
    private static final long POWER_CHECK_INTERVAL_MS = 60_000L;
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

        /** Effective smart-tracking cadence changed in the native service. */
        void onAdaptiveStateChanged(Snapshot snapshot);
    }

    private static volatile Listener listener = null;

    // buffer is assigned once in onCreate, before `instance` is published (a
    // volatile write), so its reference is safely published to other threads
    // without needing to be volatile itself (B9).
    private TrackingFixBuffer buffer;
    private Handler handler;

    // Written from the main looper (engine callbacks, the watchdog Handler,
    // onStartCommand) and read from the Capacitor plugin thread
    // (describeState(), isTracking(), getWarningText(), noteSampleAccepted()).
    // volatile makes each individual read/write correct; snapshot() below
    // additionally synchronizes the handful of writer transitions that touch
    // several of these together, so a describeState() read can't observe a
    // torn mix of old and new values (B9).
    private volatile LocationEngine engine;
    private volatile boolean tracking = false;
    private volatile long intervalMs = 30_000L;
    private volatile long minIntervalMs = 10_000L;
    private volatile float distanceFilterMeters = 0f;
    private volatile LocationEngine.Power power = LocationEngine.Power.HIGH;
    private volatile long startedAtMs = 0L;
    private volatile String notificationTitle = "Recording trip";
    private volatile String notificationText = "Starting…";
    private volatile String locationSource = SOURCE_AUTO;
    // Baseline settings are persisted separately from the effective request.
    // A sticky restart must restore the policy, not freeze at the last
    // stationary/battery-adjusted cadence.
    private volatile NativeAdaptivePolicy.Mode trackingMode = NativeAdaptivePolicy.Mode.MANUAL;
    private volatile long baselineIntervalMs = 30_000L;
    private volatile LocationEngine.Power baselinePower = LocationEngine.Power.HIGH;
    private NativeAdaptivePolicy.Decision adaptiveDecision = null;
    private NativeMovementDetector movementDetector = new NativeMovementDetector();

    /** Non-null while the engine is failing or has gone quiet. */
    private volatile String warningText = null;
    private volatile long lastFixAtMs = 0L;
    // Distinct from lastFixAtMs on purpose. A fix arriving is not the same as a
    // point being recorded: the JS side still applies an accuracy cutoff, and
    // when that rejects everything the recording silently stops producing
    // anything while raw fixes keep resetting the watchdog. Tracking both lets
    // the two failures be told apart and reported differently.
    private volatile long lastAcceptedAtMs = 0L;
    // Baseline the no-fix/no-accept watchdog measures against (B1/B2).
    // Distinct from startedAtMs, which must stay the session's real start
    // (the notification chronometer depends on it and a restore must not
    // move it). This instead resets to "now" every time location updates are
    // (re)started — a genuine start *and* a reconfigure — so a cadence change
    // or a process-kill restart doesn't inherit a stale baseline and
    // immediately read as a cold-start timeout.
    private volatile long watchdogBaseMs = 0L;
    private volatile boolean listenerAttached = false;
    private Runnable noFixCheck = null;
    private Runnable powerCheck = null;

    // C7 (clock-skew fix): anchors every fix in this session to the
    // monotonic elapsed-realtime clock instead of trusting the device wall
    // clock at fix time, so a mid-session wall-clock change (NTP correcting
    // the phone, a manual date change) cannot retroactively shift already
    // -anchored fixes. Set once on a genuine start and persisted so a
    // START_STICKY restart restores the *original* anchor rather than
    // establishing a new one — see handleStart/persistConfig/restoreConfig.
    // 0 means "not yet anchored", in which case onFix falls back to the raw
    // wall-clock reading (e.g. a config left over from before this field
    // existed).
    private volatile long anchorElapsedNs = 0L;
    private volatile long anchorWallMs = 0L;

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

    /** Immutable bundle of everything describeState() needs (B9). */
    static final class Snapshot {
        final boolean tracking;
        final long startedAtMs;
        final long intervalMs;
        final String powerLevel;
        final String trackingMode;
        final String adaptiveReason;
        final String engineName;
        final String warningText;
        final int bufferedFixes;

        private Snapshot(
                boolean tracking,
                long startedAtMs,
                long intervalMs,
                String powerLevel,
                String trackingMode,
                String adaptiveReason,
                String engineName,
                String warningText,
                int bufferedFixes
        ) {
            this.tracking = tracking;
            this.startedAtMs = startedAtMs;
            this.intervalMs = intervalMs;
            this.powerLevel = powerLevel;
            this.trackingMode = trackingMode;
            this.adaptiveReason = adaptiveReason;
            this.engineName = engineName;
            this.warningText = warningText;
            this.bufferedFixes = bufferedFixes;
        }
    }

    /**
     * A single consistent read of every field the plugin's describeState()
     * needs, taken under the same lock the writer transitions below use, so
     * the fields describing one state transition can never be observed half
     * from before it and half from after (B9).
     */
    Snapshot snapshot() {
        synchronized (this) {
            return new Snapshot(
                    tracking,
                    startedAtMs,
                    intervalMs,
                    power.wireName(),
                    trackingMode.wireName(),
                    adaptiveDecision == null
                            ? NativeAdaptivePolicy.Reason.FIXED.wireName()
                            : adaptiveDecision.reason.wireName(),
                    engine == null ? "none" : engine.getName(),
                    warningText,
                    buffer == null ? 0 : buffer.size()
            );
        }
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
        boolean freshStart = intent != null && intent.hasExtra(EXTRA_INTERVAL_MS);

        synchronized (this) {
            if (freshStart) {
                readConfig(intent);
                startedAtMs = intent.getLongExtra(EXTRA_STARTED_AT, System.currentTimeMillis());
                movementDetector = new NativeMovementDetector();
                adaptiveDecision = null;
                // C7: the anchor pair is captured once, at the same genuine
                // start that sets startedAtMs — never on a reconfigure or a
                // process-kill restart, which restore it instead (below).
                anchorElapsedNs = SystemClock.elapsedRealtimeNanos();
                anchorWallMs = System.currentTimeMillis();
            } else {
                restoreConfig(prefs);
            }
            tracking = true;
            lastAcceptedAtMs = 0L;
            // Reset only on a genuine start, not on a reconfigure (B1): a
            // reconfigure keeps whatever fix history it already had, so a
            // cadence change mid-recording doesn't read as "no fix yet".
            lastFixAtMs = 0L;
        }

        if (freshStart) {
            // A fresh start, so anything still buffered belongs to a recording
            // that has already finished. Draining it into the new session
            // would file those points under the wrong session and stamp them
            // with times before its started_at — which the server discards
            // silently, taking the real points of the batch with them.
            buffer.drain();
        }

        prefs.edit().putBoolean(PREF_TRACKING, true).apply();

        postNotificationAsForeground();
        applyAdaptivePolicy(true);
        schedulePowerCheck();
    }

    private void handleConfigure(Intent intent) {
        if (!tracking || intent == null) {
            return;
        }
        synchronized (this) {
            readConfig(intent);
        }
        applyAdaptivePolicy(true);
        schedulePowerCheck();
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
        long legacyIntervalMs = intent.getLongExtra(EXTRA_INTERVAL_MS, intervalMs);
        intervalMs = legacyIntervalMs;
        minIntervalMs = intent.getLongExtra(EXTRA_MIN_INTERVAL_MS, Math.min(minIntervalMs, intervalMs));
        distanceFilterMeters = intent.getFloatExtra(EXTRA_DISTANCE_FILTER_M, distanceFilterMeters);
        if (intent.hasExtra(EXTRA_POWER_LEVEL)) {
            power = LocationEngine.Power.parse(intent.getStringExtra(EXTRA_POWER_LEVEL));
        }
        baselineIntervalMs = intent.getLongExtra(EXTRA_BASELINE_INTERVAL_MS, legacyIntervalMs);
        baselinePower = intent.hasExtra(EXTRA_BASELINE_POWER_LEVEL)
                ? LocationEngine.Power.parse(intent.getStringExtra(EXTRA_BASELINE_POWER_LEVEL))
                : power;
        if (intent.hasExtra(EXTRA_TRACKING_MODE)) {
            trackingMode = NativeAdaptivePolicy.Mode.parse(
                    intent.getStringExtra(EXTRA_TRACKING_MODE)
            );
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
                .putString(EXTRA_TRACKING_MODE, trackingMode.wireName())
                .putLong(EXTRA_BASELINE_INTERVAL_MS, baselineIntervalMs)
                .putString(EXTRA_BASELINE_POWER_LEVEL, baselinePower.wireName())
                .putString(EXTRA_LOCATION_SOURCE, locationSource)
                .putLong(EXTRA_STARTED_AT, startedAtMs)
                .putString(EXTRA_TITLE, notificationTitle)
                .putString(EXTRA_TEXT, notificationText)
                .putLong(EXTRA_ANCHOR_ELAPSED_NS, anchorElapsedNs)
                .putLong(EXTRA_ANCHOR_WALL_MS, anchorWallMs)
                .apply();
    }

    private void restoreConfig(SharedPreferences prefs) {
        intervalMs = prefs.getLong(EXTRA_INTERVAL_MS, intervalMs);
        minIntervalMs = prefs.getLong(EXTRA_MIN_INTERVAL_MS, minIntervalMs);
        distanceFilterMeters = prefs.getFloat(EXTRA_DISTANCE_FILTER_M, distanceFilterMeters);
        power = LocationEngine.Power.parse(
                prefs.getString(EXTRA_POWER_LEVEL, power.wireName())
        );
        trackingMode = NativeAdaptivePolicy.Mode.parse(
                prefs.getString(EXTRA_TRACKING_MODE, trackingMode.wireName())
        );
        baselineIntervalMs = prefs.getLong(EXTRA_BASELINE_INTERVAL_MS, intervalMs);
        baselinePower = LocationEngine.Power.parse(
                prefs.getString(EXTRA_BASELINE_POWER_LEVEL, power.wireName())
        );
        locationSource = prefs.getString(EXTRA_LOCATION_SOURCE, locationSource);
        startedAtMs = prefs.getLong(EXTRA_STARTED_AT, System.currentTimeMillis());
        notificationTitle = prefs.getString(EXTRA_TITLE, notificationTitle);
        notificationText = prefs.getString(EXTRA_TEXT, notificationText);
        // C7: restores the *original* session-start anchor rather than
        // establishing a new one, so a process-kill restart doesn't lose
        // the point of anchoring in the first place.
        anchorElapsedNs = prefs.getLong(EXTRA_ANCHOR_ELAPSED_NS, anchorElapsedNs);
        anchorWallMs = prefs.getLong(EXTRA_ANCHOR_WALL_MS, anchorWallMs);
    }

    /** Re-evaluates smart policy on the service's main looper. */
    private void applyAdaptivePolicy(boolean force) {
        if (!tracking) {
            return;
        }

        NativeAdaptivePolicy.Decision next = NativeAdaptivePolicy.decide(
                new NativeAdaptivePolicy.Input(
                        trackingMode,
                        baselineIntervalMs,
                        baselinePower,
                        distanceFilterMeters,
                        movementDetector.getState(),
                        movementDetector.getEffectiveSpeedMps(),
                        batteryLevel(),
                        isCharging(),
                        isPowerSaveMode(),
                        hasCoarseLocationBackend()
                )
        );

        if (!force && !NativeAdaptivePolicy.isMeaningfulChange(adaptiveDecision, next)) {
            return;
        }

        synchronized (this) {
            adaptiveDecision = next;
            intervalMs = next.intervalMs;
            power = next.power;
            distanceFilterMeters = next.distanceFilterMeters;
            // Smart mode controls its own spacing; requesting a faster
            // delivery here would wake GPS only for JavaScript to drop it.
            if (trackingMode == NativeAdaptivePolicy.Mode.SMART) {
                minIntervalMs = next.intervalMs;
            }
        }
        persistConfig(getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE));
        requestLocationUpdates();
        Log.i(
                TAG,
                "Adaptive policy: mode=" + trackingMode.wireName()
                        + " interval=" + intervalMs + "ms"
                        + " power=" + power.wireName()
                        + " reason=" + next.reason.wireName()
        );

        Listener current = listener;
        if (current != null && tracking) {
            current.onAdaptiveStateChanged(snapshot());
        }
    }

    private boolean hasCoarseLocationBackend() {
        String resolved = resolveEngineName(this, locationSource);
        return SOURCE_GMS.equals(resolved)
                || PlatformLocationEngine.hasCoarseLocationBackend(this);
    }

    private Double batteryLevel() {
        Intent battery = registerReceiver(null, new IntentFilter(Intent.ACTION_BATTERY_CHANGED));
        if (battery == null) {
            return null;
        }
        int level = battery.getIntExtra(BatteryManager.EXTRA_LEVEL, -1);
        int scale = battery.getIntExtra(BatteryManager.EXTRA_SCALE, -1);
        return level >= 0 && scale > 0 ? (double) level / scale : null;
    }

    private boolean isCharging() {
        Intent battery = registerReceiver(null, new IntentFilter(Intent.ACTION_BATTERY_CHANGED));
        if (battery == null) {
            return false;
        }
        int status = battery.getIntExtra(BatteryManager.EXTRA_STATUS, -1);
        return status == BatteryManager.BATTERY_STATUS_CHARGING
                || status == BatteryManager.BATTERY_STATUS_FULL;
    }

    private boolean isPowerSaveMode() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.LOLLIPOP) {
            return false;
        }
        PowerManager manager = (PowerManager) getSystemService(Context.POWER_SERVICE);
        return manager != null && manager.isPowerSaveMode();
    }

    private void schedulePowerCheck() {
        cancelPowerCheck();
        if (!tracking) {
            return;
        }
        powerCheck = new Runnable() {
            @Override
            public void run() {
                if (!tracking) {
                    return;
                }
                applyAdaptivePolicy(false);
                handler.postDelayed(this, POWER_CHECK_INTERVAL_MS);
            }
        };
        handler.postDelayed(powerCheck, POWER_CHECK_INTERVAL_MS);
    }

    private void cancelPowerCheck() {
        if (powerCheck != null) {
            handler.removeCallbacks(powerCheck);
            powerCheck = null;
        }
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

        LocationEngine newEngine = SOURCE_GMS.equals(resolved)
                ? new FusedLocationEngine(this)
                : new PlatformLocationEngine(this);

        synchronized (this) {
            engine = newEngine;
            // Location updates are (re)starting now, so the watchdog measures
            // "no fix yet" / "nothing accepted yet" from this moment, not
            // from startedAtMs (B1/B2) — a reconfigure or a process-kill
            // restart must not immediately read as a cold-start timeout.
            watchdogBaseMs = System.currentTimeMillis();
        }
        clearWarning();

        engine.start(
                new LocationEngine.Config(
                        intervalMs,
                        trackingMode == NativeAdaptivePolicy.Mode.SMART
                                ? intervalMs
                                : Math.min(minIntervalMs, intervalMs),
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

                WarningKind kind = computeWarningKind(
                        System.currentTimeMillis(),
                        watchdogBaseMs,
                        lastFixAtMs,
                        lastAcceptedAtMs,
                        intervalMs,
                        listenerAttached
                );

                switch (kind) {
                    case WAITING_FOR_FIRST_FIX:
                        setWarning(
                                "Waiting for a GPS fix. This can take a minute outdoors, longer indoors."
                                        + (SOURCE_GMS.equals(getEngineName())
                                                ? ""
                                                : " If it never arrives, try another Location source in tracking settings.")
                        );
                        break;
                    case NO_SIGNAL:
                        setWarning("No GPS signal right now - still recording.");
                        break;
                    case SIGNAL_TOO_WEAK:
                        setWarning("GPS signal is too weak to record accurately - some points are being skipped.");
                        break;
                    case NONE:
                    default:
                        clearWarning();
                        break;
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

    /** What the no-fix watchdog should report, before it is turned into text. */
    enum WarningKind {
        NONE,
        WAITING_FOR_FIRST_FIX,
        NO_SIGNAL,
        SIGNAL_TOO_WEAK,
    }

    /**
     * Pure threshold selection extracted out of the watchdog Runnable so it
     * can be unit-tested without a Service (T2). Covers both B1 (a
     * reconfigure must not look like a cold start) and B2 (a process-kill
     * restart must not either) via watchdogBaseMs, which the caller resets
     * whenever location updates are (re)started — see requestLocationUpdates.
     */
    static WarningKind computeWarningKind(
            long now,
            long watchdogBaseMs,
            long lastFixAtMs,
            long lastAcceptedAtMs,
            long intervalMs,
            boolean listenerAttached
    ) {
        boolean hadFirstFix = lastFixAtMs > 0;
        long sinceFix = now - (hadFirstFix ? lastFixAtMs : watchdogBaseMs);
        long fixThreshold = hadFirstFix
                ? Math.max(MIN_NO_FIX_WARNING_MS, intervalMs * 2)
                : FIRST_FIX_WARNING_MS;

        if (sinceFix > fixThreshold) {
            return hadFirstFix ? WarningKind.NO_SIGNAL : WarningKind.WAITING_FOR_FIRST_FIX;
        }

        // Fixes are arriving but nothing is being recorded. Only meaningful
        // while a webview is attached to do the accepting; with none
        // attached, fixes are simply buffered for later.
        long sinceAccepted = now - (lastAcceptedAtMs > 0 ? lastAcceptedAtMs : watchdogBaseMs);
        long acceptThreshold = Math.max(MIN_NO_FIX_WARNING_MS, intervalMs * 3);
        if (listenerAttached && hadFirstFix && sinceAccepted > acceptThreshold) {
            return WarningKind.SIGNAL_TOO_WEAK;
        }
        return WarningKind.NONE;
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
        cancelPowerCheck();
        synchronized (this) {
            if (engine != null) {
                engine.stop();
                engine = null;
            }
            tracking = false;
            // The failure is the notification's whole content below, so
            // leaving it in warningText too would render it twice ("... · ...").
            warningText = null;
        }
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

    /**
     * The C7 anchor arithmetic, extracted so it can be unit-tested without a
     * Service (same rationale as computeWarningKind above). anchorWallMs <= 0
     * means "never anchored" (e.g. a config persisted before this field
     * existed) — falls back to the fix's own raw wall-clock reading rather
     * than computing a bogus near-epoch timestamp from a zero anchor.
     */
    static long computeAnchoredTimeMs(
            long anchorElapsedNs,
            long anchorWallMs,
            long fixElapsedNs,
            long rawTimeMs
    ) {
        if (anchorWallMs <= 0) {
            return rawTimeMs;
        }
        return anchorWallMs + (fixElapsedNs - anchorElapsedNs) / 1_000_000L;
    }

    private void onFix(Location location) {
        long anchoredTimeMs = computeAnchoredTimeMs(
                anchorElapsedNs,
                anchorWallMs,
                location.getElapsedRealtimeNanos(),
                location.getTime()
        );

        JSONObject fix = new JSONObject();
        try {
            fix.put("latitude", location.getLatitude());
            fix.put("longitude", location.getLongitude());
            fix.put("accuracy", location.hasAccuracy() ? location.getAccuracy() : JSONObject.NULL);
            fix.put("altitude", location.hasAltitude() ? location.getAltitude() : JSONObject.NULL);
            fix.put("speed", location.hasSpeed() ? location.getSpeed() : JSONObject.NULL);
            fix.put("bearing", location.hasBearing() ? location.getBearing() : JSONObject.NULL);
            fix.put("time", anchoredTimeMs);
            // Diagnostic only (C7): lets a divergence between the anchored
            // and raw wall-clock reading be spotted in development. Not read
            // by the JS side.
            fix.put("rawTime", location.getTime());
            fix.put("simulated", location.isFromMockProvider());
        } catch (JSONException exception) {
            Log.e(TAG, "Could not serialize fix", exception);
            return;
        }

        lastFixAtMs = System.currentTimeMillis();
        buffer.append(fix);

        // Policy uses the service-owned raw stream so it continues while the
        // WebView is detached. Mock fixes must never influence cadence.
        if (tracking && trackingMode == NativeAdaptivePolicy.Mode.SMART
                && !location.isFromMockProvider()) {
            long fixElapsedMs = location.getElapsedRealtimeNanos() / 1_000_000L;
            movementDetector.observe(
                    location.getLatitude(),
                    location.getLongitude(),
                    location.getAccuracy(),
                    location.hasAccuracy(),
                    location.getSpeed(),
                    location.hasSpeed(),
                    fixElapsedMs
            );
            applyAdaptivePolicy(false);
        }

        Listener current = listener;
        if (current != null) {
            current.onFixBuffered();
        }
    }

    private void stopTracking() {
        synchronized (this) {
            tracking = false;
            warningText = null;
        }
        removeLocationUpdates();
        cancelPowerCheck();
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
        cancelPowerCheck();
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
