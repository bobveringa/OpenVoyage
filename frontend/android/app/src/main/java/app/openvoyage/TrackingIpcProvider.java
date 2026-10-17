package app.openvoyage;

import android.content.ContentProvider;
import android.content.ContentValues;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.database.Cursor;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.Process;
import android.os.RemoteException;

/**
 * Small IPC boundary owned by the tracker process. The UI process never opens the fix file or reads
 * a cached copy of the tracker's SharedPreferences.
 */
public final class TrackingIpcProvider extends ContentProvider {
    static final String METHOD_STATE = "state";
    static final String METHOD_DRAIN = "drain";
    static final String METHOD_ACK = "ack";
    static final String METHOD_ACCEPTED = "accepted";
    static final String METHOD_ATTACH = "attach";
    static final String METHOD_DETACH = "detach";
    static final String EXTRA_CLIENT_ID = "clientId";
    static final String EXTRA_CLIENT_BINDER = "clientBinder";
    static final String ACTION_EVENT = "app.openvoyage.tracking.EVENT";
    static final String EXTRA_EVENT = "event";
    static final String EVENT_FIX = "fixAvailable";
    static final String EVENT_STOP = "stopRequested";
    static final String EVENT_WARNING = "engineWarning";
    static final String EVENT_FAILED = "engineFailed";
    static final String EVENT_ADAPTIVE = "adaptiveStateChanged";

    private static final int DRAIN_BATCH_SIZE = 800;

    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private String clientId;
    private IBinder clientBinder;
    private IBinder.DeathRecipient clientDeath;

    private final TrackingService.Listener listener =
            new TrackingService.Listener() {
                @Override
                public void onFixBuffered() {
                    sendEvent(EVENT_FIX, null);
                }

                @Override
                public void onStopRequestedFromNotification() {
                    sendEvent(EVENT_STOP, null);
                }

                @Override
                public void onEngineWarning(String message) {
                    Intent intent = event(EVENT_WARNING);
                    intent.putExtra("message", message);
                    getContext().sendBroadcast(intent);
                }

                @Override
                public void onEngineFailed(String message) {
                    Intent intent = event(EVENT_FAILED);
                    intent.putExtra("message", message);
                    getContext().sendBroadcast(intent);
                }

                @Override
                public void onAdaptiveStateChanged(TrackingService.Snapshot snapshot) {
                    Intent intent = event(EVENT_ADAPTIVE);
                    intent.putExtra("mode", snapshot.trackingMode);
                    intent.putExtra("intervalSeconds", snapshot.intervalMs / 1000.0);
                    intent.putExtra("powerLevel", snapshot.powerLevel);
                    intent.putExtra("adaptiveReason", snapshot.adaptiveReason);
                    getContext().sendBroadcast(intent);
                }
            };

    static Uri uri(Context context) {
        return Uri.parse("content://" + context.getPackageName() + ".tracking.ipc");
    }

    @Override
    public boolean onCreate() {
        return true;
    }

    @Override
    public Bundle call(String method, String arg, Bundle extras) {
        if ("recording".equals(method)) return recording(extras);
        switch (method) {
            case METHOD_STATE:
                return state();
            case METHOD_DRAIN:
                return drain();
            case METHOD_ACK:
                return acknowledge(extras);
            case METHOD_ACCEPTED:
                TrackingService service = TrackingService.getInstance();
                if (service != null) {
                    mainHandler.post(service::noteSampleAccepted);
                }
                return new Bundle();
            case METHOD_ATTACH:
                attach(extras);
                return new Bundle();
            case METHOD_DETACH:
                detach(extras == null ? null : extras.getString(EXTRA_CLIENT_ID));
                return new Bundle();
            default:
                return super.call(method, arg, extras);
        }
    }

    private Bundle recording(Bundle extras) {
        Context c = getContext();
        TrackingStore store = TrackingStore.get(c);
        org.json.JSONObject input = TrackingStore.json(extras.getString("payload", "{}"));
        String op = input.optString("op"), id = input.optString("sessionId");
        switch (op) {
            case "identity":
                {
                    String user = input.optString("userId");
                    if (!user.equals(store.meta("identity", ""))) {
                        TrackingSync.changeIdentity(c, user);
                        stopCapture(null);
                    } else if (input.optBoolean("signedIn")) {
                        TrackingSync.reauthorize(c, user);
                    }
                    break;
                }
            case "begin":
                {
                    org.json.JSONObject s = store.begin(input);
                    TrackingSync.schedule(c, s, false);
                    break;
                }
            case "stop":
                {
                    org.json.JSONObject s = store.stop(id, "Finishing sync");
                    stopCapture(id);
                    if (s != null) TrackingSync.schedule(c, s, true);
                    break;
                }
            case "credential":
                {
                    org.json.JSONObject token = input.optJSONObject("token");
                    TrackingStore.put(token, "deadlineBoot", store.boot());
                    TrackingStore.put(
                            token,
                            "deadline",
                            android.os.SystemClock.elapsedRealtime()
                                    + input.optLong("remainingMs"));
                    store.credential(id, token);
                    TrackingSync.schedule(c, store.session(id), true);
                    break;
                }
            case "settings":
                {
                    org.json.JSONArray rows = store.sessions();
                    for (int i = 0; i < rows.length(); i++) {
                        org.json.JSONObject s = rows.optJSONObject(i);
                        if (!s.optString("userId").equals(store.meta("identity", ""))) continue;
                        TrackingStore.put(s, "wifiOnlyUpload", input.optBoolean("wifiOnlyUpload"));
                        store.save(s);
                    }
                    break;
                }
            case "travelMode":
                {
                    org.json.JSONObject s = store.session(id);
                    if (s != null && s.optString("userId").equals(store.meta("identity", ""))) {
                        TrackingStore.put(
                                s, "travelMode", input.optString("travelMode", "UNKNOWN"));
                        store.save(s);
                    }
                    break;
                }
            case "provisionFailure":
                {
                    org.json.JSONObject s = store.session(id);
                    if (s != null && s.optString("userId").equals(store.meta("identity", ""))) {
                        if (input.optBoolean("terminal") || input.optBoolean("deleted")) {
                            store.stop(id, "This recording was deleted.");
                            s = store.session(id);
                            TrackingStore.put(s, "terminal", true);
                            TrackingStore.put(s, "deleted", input.optBoolean("deleted"));
                            mainHandler.post(
                                    () -> {
                                        TrackingService service = TrackingService.getInstance();
                                        if (service != null
                                                && id.equals(store.meta("captureId", "")))
                                            service.stopNativeCapture();
                                    });
                        }
                        TrackingStore.put(s, "reason", input.optString("reason"));
                        TrackingStore.put(s, "authPaused", true);
                        store.save(s);
                        TrackingSync.cancelWork(c, id);
                    }
                    break;
                }
            case "recover":
                {
                    org.json.JSONArray rows = store.sessions();
                    for (int i = 0; i < rows.length(); i++) {
                        org.json.JSONObject s = rows.optJSONObject(i);
                        if (s.optString("userId").equals(store.meta("identity", "")))
                            TrackingSync.schedule(c, s, !s.isNull("endedAt"));
                    }
                    break;
                }
            case "snapshot":
                break;
            default:
                throw new IllegalArgumentException("Unknown recording command");
        }
        Bundle reply = new Bundle();
        reply.putString("sessions", store.snapshot().toString());
        return reply;
    }

    /** A delayed Stop for an old recording must never stop a newer one. */
    private void stopCapture(String expectedId) {
        java.util.concurrent.FutureTask<Void> stop =
                new java.util.concurrent.FutureTask<>(
                        () -> {
                            TrackingService service = TrackingService.getInstance();
                            if (service != null
                                    && (expectedId == null
                                            || expectedId.equals(
                                                    TrackingStore.get(getContext())
                                                            .meta("captureId", ""))))
                                service.stopNativeCapture();
                            return null;
                        });
        if (Looper.myLooper() == Looper.getMainLooper()) stop.run();
        else mainHandler.post(stop);
        try {
            stop.get(30, java.util.concurrent.TimeUnit.SECONDS);
        } catch (Exception e) {
            throw new IllegalStateException("Could not stop the recording", e);
        }
    }

    private Bundle state() {
        Context context = getContext();
        SharedPreferences prefs =
                context.getSharedPreferences(TrackingService.PREFS_NAME, Context.MODE_PRIVATE);
        TrackingService service = TrackingService.getInstance();
        TrackingService.Snapshot snapshot = service == null ? null : service.snapshot();
        Bundle result = new Bundle();
        boolean tracking = snapshot != null && snapshot.tracking;
        result.putBoolean("tracking", tracking);
        result.putBoolean(
                "trackingIntent",
                tracking || prefs.getBoolean(TrackingService.PREF_TRACKING, false));
        result.putString("stopReason", prefs.getString(TrackingService.PREF_STOP_REASON, null));
        result.putString("stopMessage", prefs.getString(TrackingService.PREF_STOP_MESSAGE, null));
        result.putLong("stopAtMs", prefs.getLong(TrackingService.PREF_STOP_AT_MS, 0));
        result.putLong("startedAtMs", snapshot == null ? 0 : snapshot.startedAtMs);
        result.putDouble("intervalSeconds", snapshot == null ? 0 : snapshot.intervalMs / 1000.0);
        result.putString("powerLevel", snapshot == null ? null : snapshot.powerLevel);
        result.putString("mode", snapshot == null ? null : snapshot.trackingMode);
        result.putString("adaptiveReason", snapshot == null ? null : snapshot.adaptiveReason);
        result.putInt(
                "bufferedFixes",
                snapshot == null ? TrackingStore.get(context).count(null) : snapshot.bufferedFixes);
        result.putString("engine", snapshot == null ? null : snapshot.engineName);
        result.putString("warning", snapshot == null ? null : snapshot.warningText);
        result.putInt("processId", Process.myPid());
        return result;
    }

    private Bundle drain() {
        TrackingFixBuffer buffer = TrackingFixBuffer.get(getContext());
        Bundle result = new Bundle();
        result.putInt("droppedCount", buffer.getDroppedCount());
        org.json.JSONArray fixes = buffer.peek(DRAIN_BATCH_SIZE);
        result.putString("fixes", fixes.toString());
        result.putBoolean("hasMore", buffer.size() > fixes.length());
        return result;
    }

    private Bundle acknowledge(Bundle extras) {
        TrackingFixBuffer buffer = TrackingFixBuffer.get(getContext());
        Bundle result = new Bundle();
        String nativeId = extras == null ? null : extras.getString("nativeId");
        int handledDroppedCount = extras == null ? 0 : extras.getInt("handledDroppedCount", 0);
        result.putBoolean(
                "acknowledged",
                nativeId == null ? handledDroppedCount > 0 : buffer.acknowledge(nativeId));
        if (handledDroppedCount > 0) {
            buffer.acknowledgeDroppedCount(handledDroppedCount);
        }
        return result;
    }

    private synchronized void attach(Bundle extras) {
        if (extras == null) {
            return;
        }
        String id = extras.getString(EXTRA_CLIENT_ID);
        IBinder binder = extras.getBinder(EXTRA_CLIENT_BINDER);
        if (id == null || binder == null) {
            return;
        }
        clearClient();
        clientId = id;
        clientBinder = binder;
        clientDeath = () -> detach(id);
        try {
            binder.linkToDeath(clientDeath, 0);
            TrackingService.setListener(listener);
        } catch (RemoteException exception) {
            clearClient();
            TrackingService.setListener(null);
        }
    }

    private synchronized void detach(String id) {
        if (id != null && id.equals(clientId)) {
            clearClient();
            TrackingService.setListener(null);
        }
    }

    private void clearClient() {
        if (clientBinder != null && clientDeath != null) {
            clientBinder.unlinkToDeath(clientDeath, 0);
        }
        clientId = null;
        clientBinder = null;
        clientDeath = null;
    }

    private Intent event(String kind) {
        return new Intent(ACTION_EVENT)
                .setPackage(getContext().getPackageName())
                .putExtra(EXTRA_EVENT, kind);
    }

    private void sendEvent(String kind, String message) {
        Intent intent = event(kind);
        if (message != null) {
            intent.putExtra("message", message);
        }
        getContext().sendBroadcast(intent);
    }

    @Override
    public Cursor query(
            Uri uri,
            String[] projection,
            String selection,
            String[] selectionArgs,
            String sortOrder) {
        return null;
    }

    @Override
    public String getType(Uri uri) {
        return null;
    }

    @Override
    public Uri insert(Uri uri, ContentValues values) {
        return null;
    }

    @Override
    public int delete(Uri uri, String selection, String[] selectionArgs) {
        return 0;
    }

    @Override
    public int update(Uri uri, ContentValues values, String selection, String[] selectionArgs) {
        return 0;
    }
}
