package app.openvoyage;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.os.SystemClock;
import android.os.Handler;
import android.os.Looper;
import android.location.Location;
import android.util.Log;

import org.json.JSONObject;

import java.util.concurrent.atomic.AtomicBoolean;

/** Periodic single-fix lookup for sparse requests that may otherwise go quiet. */
public final class TrackingLookupReceiver extends BroadcastReceiver {
    private static final String ACTION_LOOKUP = "app.openvoyage.tracking.LOOKUP";
    private static final String TAG = "OVTrackingLookup";

    static void schedule(Context context, String token, long intervalMs) {
        if (token == null || token.isEmpty()) {
            return;
        }
        AlarmManager alarms = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        if (alarms != null) {
            alarms.setAndAllowWhileIdle(AlarmManager.ELAPSED_REALTIME_WAKEUP,
                    SystemClock.elapsedRealtime() + intervalMs, pendingIntent(context, token));
        }
    }

    static void cancel(Context context, String token) {
        if (token == null || token.isEmpty()) {
            return;
        }
        PendingIntent pending = pendingIntent(context, token);
        AlarmManager alarms = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        if (alarms != null) {
            alarms.cancel(pending);
        }
        pending.cancel();
    }

    private static PendingIntent pendingIntent(Context context, String token) {
        Intent intent = new Intent(context, TrackingLookupReceiver.class)
                .setAction(ACTION_LOOKUP)
                .setData(Uri.parse("openvoyage://tracking/lookup/" + token));
        return PendingIntent.getBroadcast(context, 0, intent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    @Override
    public void onReceive(Context context, Intent intent) {
        if (intent == null || !ACTION_LOOKUP.equals(intent.getAction())) {
            return;
        }
        Uri data = intent.getData();
        String token = data == null ? null : data.getLastPathSegment();
        SharedPreferences prefs = context.getSharedPreferences(
                TrackingService.PREFS_NAME, Context.MODE_PRIVATE);
        if (token == null || !prefs.getBoolean(TrackingService.PREF_TRACKING, false)
                || !token.equals(prefs.getString(TrackingService.EXTRA_RECORDING_TOKEN, null))
                || !"smart".equals(prefs.getString(TrackingService.EXTRA_TRACKING_MODE, null))
                || !TrackingService.SOURCE_GMS.equals(TrackingService.resolveEngineName(
                        context, prefs.getString(TrackingService.EXTRA_LOCATION_SOURCE,
                                TrackingService.SOURCE_AUTO)))) {
            return;
        }

        int level = prefs.getInt(TrackingService.EXTRA_SMART_PRECISION, 3);
        if (level >= 5) {
            return;
        }
        schedule(context, token, SparseTrackingProfile.forLevel(level).lookupIntervalMs);
        TrackingService service = TrackingService.getInstance();
        if (service != null && service.isTracking()) {
            service.onLookupAlarm(token);
            return;
        }

        // PendingIntent location updates can outlive the service process. The
        // lookup must work in the same state, or sparse recordings lose their
        // only active fallback for long quiet periods.
        PendingResult pending = goAsync();
        AtomicBoolean finished = new AtomicBoolean(false);
        Handler handler = new Handler(Looper.getMainLooper());
        Runnable finish = () -> {
            if (finished.compareAndSet(false, true)) {
                pending.finish();
            }
        };
        handler.postDelayed(finish, 9_000L);
        try {
            new FusedLocationEngine(context.getApplicationContext())
                    .lookupCurrentLocation(new LocationEngine.Callback() {
                        @Override
                        public void onLocation(Location location) {
                            if (!finished.get()) {
                                SharedPreferences latest = context.getSharedPreferences(
                                        TrackingService.PREFS_NAME, Context.MODE_PRIVATE);
                                if (latest.getBoolean(TrackingService.PREF_TRACKING, false)
                                        && token.equals(latest.getString(
                                                TrackingService.EXTRA_RECORDING_TOKEN, null))) {
                                    long anchorElapsedNs = latest.getLong(
                                            TrackingService.EXTRA_ANCHOR_ELAPSED_NS, 0L);
                                    if (anchorElapsedNs <= 0
                                            || location.getElapsedRealtimeNanos() >= anchorElapsedNs) {
                                        JSONObject fix = TrackingService.serializeFix(location,
                                                anchorElapsedNs, latest.getLong(
                                                        TrackingService.EXTRA_ANCHOR_WALL_MS, 0L));
                                        if (fix != null) {
                                            TrackingFixBuffer.get(context).append(fix);
                                        }
                                    }
                                }
                            }
                            handler.removeCallbacks(finish);
                            finish.run();
                        }

                        @Override
                        public void onFailure(String message) {
                            Log.w(TAG, "Detached lookup failed: " + message);
                            handler.removeCallbacks(finish);
                            finish.run();
                        }
                    }, 8_000L);
        } catch (RuntimeException exception) {
            Log.w(TAG, "Could not start detached lookup", exception);
            handler.removeCallbacks(finish);
            finish.run();
        }
    }
}
