package app.openvoyage;

import android.content.*;
import android.net.*;
import android.os.*;
import android.os.SystemClock;

import androidx.work.*;
import androidx.work.multiprocess.*;

import org.json.*;

import java.io.*;
import java.net.*;
import java.time.*;
import java.time.format.DateTimeFormatter;
import java.util.concurrent.*;

/** All HTTP and queue access runs in :tracker, with one upload owner. */
final class TrackingSync {
    static final ExecutorService EXECUTOR = Executors.newSingleThreadExecutor();
    private static volatile HttpURLConnection connection;
    private static volatile Thread connectionOwner;
    private static volatile long identityGeneration;
    private static final Object UPLOAD_LOCK = new Object();
    private static volatile String runningSession;

    static boolean isSyncing(String id) {
        return id.equals(runningSession);
    }

    static void cancel() {
        identityGeneration++;
        HttpURLConnection c = connection;
        if (c != null) c.disconnect();
    }

    static void cancelRequest(Thread owner) {
        HttpURLConnection current = connection;
        if (owner != null && owner == connectionOwner && current != null) current.disconnect();
    }

    private static Data data(Context c, String id) {
        return new Data.Builder()
                .putString(RemoteListenableWorker.ARGUMENT_PACKAGE_NAME, c.getPackageName())
                .putString(
                        RemoteListenableWorker.ARGUMENT_CLASS_NAME,
                        RemoteWorkerService.class.getName())
                .putString("sessionId", id)
                .build();
    }

    static String periodic(String id) {
        return "tracking-periodic-" + id;
    }

    static String retry(String id) {
        return "tracking-retry-" + id;
    }

    static void schedule(Context c, JSONObject s, boolean immediate) {
        if (s.optBoolean("terminal") || s.optBoolean("authPaused") || s.optBoolean("blocked"))
            return;
        String id = s.optString("sessionId");
        Constraints constraints =
                new Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build();
        RemoteWorkManager wm = RemoteWorkManager.getInstance(c);
        if (s.isNull("endedAt")) {
            PeriodicWorkRequest work =
                    new PeriodicWorkRequest.Builder(
                                    TrackingUploadWorker.class, 15, TimeUnit.MINUTES)
                            .setInitialDelay(15, TimeUnit.MINUTES)
                            .setInputData(data(c, id))
                            .setConstraints(constraints)
                            .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS)
                            .build();
            wm.enqueueUniquePeriodicWork(periodic(id), ExistingPeriodicWorkPolicy.KEEP, work);
        }
        if (immediate || !s.isNull("endedAt")) {
            OneTimeWorkRequest work =
                    new OneTimeWorkRequest.Builder(TrackingUploadWorker.class)
                            .setInputData(data(c, id))
                            .setConstraints(constraints)
                            .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS)
                            .build();
            // Keep periodic work until this enqueue has durably completed.
            // Renewal and Stop must also wake an attempt currently in backoff.
            // The serial executor and stable sample IDs make cancellation safe.
            com.google.common.util.concurrent.ListenableFuture<Void> f =
                    wm.enqueueUniqueWork(
                            retry(id),
                            immediate ? ExistingWorkPolicy.REPLACE : ExistingWorkPolicy.KEEP,
                            work);
            if (!s.isNull("endedAt"))
                f.addListener(() -> wm.cancelUniqueWork(periodic(id)), EXECUTOR);
        }
    }

    static void cancelWork(Context c, String id) {
        RemoteWorkManager wm = RemoteWorkManager.getInstance(c);
        wm.cancelUniqueWork(periodic(id));
        wm.cancelUniqueWork(retry(id));
    }

    static boolean wifi(Context c) {
        ConnectivityManager cm =
                (ConnectivityManager) c.getSystemService(Context.CONNECTIVITY_SERVICE);
        NetworkCapabilities caps = cm.getNetworkCapabilities(cm.getActiveNetwork());
        return caps != null && caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI);
    }

    /** Cancel HTTP first, then wait until the uploader has left its guarded cycle. */
    static void changeIdentity(Context c, String user) {
        cancel();
        synchronized (UPLOAD_LOCK) {
            TrackingStore db = TrackingStore.get(c);
            db.setMeta("identity", user);
            JSONObject active = db.active();
            if (active != null)
                db.stop(
                        active.optString("sessionId"),
                        "Sign in as the recording owner to finish syncing");
            JSONArray rows = db.sessions();
            for (int i = 0; i < rows.length(); i++) {
                JSONObject row = rows.optJSONObject(i);
                cancelWork(c, row.optString("sessionId"));
                if (!user.isEmpty() && user.equals(row.optString("userId"))) {
                    TrackingStore.put(row, "blocked", false);
                    TrackingStore.put(row, "rejectedCredentials", 0);
                    db.save(row);
                }
            }
            db.clearCredentials();
        }
    }

    /** A successful foreground sign-in can renew the same recording without ending capture. */
    static void reauthorize(Context c, String user) {
        cancel();
        synchronized (UPLOAD_LOCK) {
            TrackingStore db = TrackingStore.get(c);
            if (!user.equals(db.meta("identity", "")))
                throw new IllegalStateException("Recording owner changed");
            JSONArray rows = db.sessions();
            for (int i = 0; i < rows.length(); i++) {
                JSONObject row = rows.optJSONObject(i);
                if (!user.equals(row.optString("userId"))) continue;
                cancelWork(c, row.optString("sessionId"));
                if (!row.optBoolean("terminal")) {
                    TrackingStore.put(row, "blocked", false);
                    TrackingStore.put(row, "authPaused", false);
                    TrackingStore.put(row, "rejectedCredentials", 0);
                    TrackingStore.put(
                            row,
                            "reason",
                            "Recording locally; open online to enable background upload.");
                    db.save(row);
                }
            }
            db.clearCredentials();
        }
    }

    static boolean run(Context c, String targetId) {
        if (targetId == null) return false;
        synchronized (UPLOAD_LOCK) {
            TrackingStore db = TrackingStore.get(c);
            boolean retry = false;
            long generation = identityGeneration;
            JSONArray all = db.sessions();
            for (int i = 0; i < all.length() && generation == identityGeneration; i++) {
                JSONObject s = db.session(all.optJSONObject(i).optString("sessionId"));
                // A lifecycle sync must not flush another active recording before its batch is due.
                if (s == null
                        || !targetId.equals(s.optString("sessionId"))
                        || s.optBoolean("terminal")
                        || s.optBoolean("authPaused")
                        || s.optBoolean("blocked")) continue;
                String id = s.optString("sessionId");
                long credentialGeneration = s.optLong("generation");
                if (!s.optString("userId").equals(db.meta("identity", ""))) continue;
                try {
                    JSONObject token;
                    try {
                        token = db.credential(id);
                    } catch (IllegalStateException e) {
                        pause(c, db, s, "Upload authorization unavailable; open online to renew.");
                        continue;
                    }
                    if (token == null) {
                        pause(
                                c,
                                db,
                                s,
                                "Recording locally; open online to enable background upload.");
                        continue;
                    }
                    if (token.optInt("deadlineBoot", -1) == db.boot()
                            && SystemClock.elapsedRealtime() >= token.optLong("deadline"))
                        throw new AuthExpired(false);
                    if (db.count(id) == 0 && s.optBoolean("createAcked") && s.isNull("endedAt"))
                        continue;
                    if (db.predecessorPending(s)) {
                        reason(db, id, "Waiting for the previous recording to finish syncing.");
                        retry = true;
                        continue;
                    }
                    if (s.optBoolean("wifiOnlyUpload") && !wifi(c)) {
                        reason(db, id, "Waiting for Wi-Fi");
                        retry = true;
                        continue;
                    }
                    long now = db.ageNow();
                    if (now < s.optLong("notBefore")) {
                        retry = true;
                        continue;
                    }
                    runningSession = id;
                    long t0 = SystemClock.elapsedRealtime();
                    JSONObject state =
                            request(db, s, token, "GET", "/upload-state", null, generation);
                    long t1 = SystemClock.elapsedRealtime();
                    long server = Instant.parse(state.getString("server_time")).toEpochMilli();
                    db.trustedTime(server);
                    // A new boot needs a fresh credential-expiry measurement, independently of
                    // capture time.
                    if (token.optInt("deadlineBoot", -1) != db.boot()) {
                        TrackingStore.put(token, "deadlineBoot", db.boot());
                        TrackingStore.put(
                                token,
                                "deadline",
                                t1
                                        + Instant.parse(token.getString("expires_at"))
                                                .toEpochMilli()
                                        - server
                                        - (t1 - t0));
                        db.updateCredentialClock(id, token, credentialGeneration);
                    }
                    if (state.getBoolean("deleted")) {
                        terminal(c, db, s, "This recording was deleted.", true);
                        continue;
                    }
                    String mapKey = "clock:" + s.optInt("boot") + ":" + s.optString("apiBaseUrl");
                    if (!s.has("offset")) {
                        if (s.optInt("boot") != db.boot()) {
                            terminal(
                                    c, db, s, "Clock recovery required after device reboot", false);
                            continue;
                        }
                        String mapping = db.meta(mapKey, "");
                        long elapsedServer;
                        if (mapping.isEmpty()) {
                            elapsedServer = server - (t0 + t1) / 2;
                            db.setMeta(mapKey, elapsedServer);
                        } else elapsedServer = Long.parseLong(mapping);
                        TrackingStore.put(
                                s,
                                "offset",
                                elapsedServer + s.optLong("startElapsed") - s.optLong("startWall"));
                        db.save(s);
                    }
                    if (state.getBoolean("exists")) {
                        if (!s.optString("userId").equals(state.getString("recorded_by_user_id"))
                                || !Instant.parse(state.getString("started_at"))
                                        .equals(
                                                Instant.parse(
                                                        corrected(s, s.getString("startedAt"))))) {
                            terminal(
                                    c,
                                    db,
                                    s,
                                    "Recording conflicts with the server; review it in the app",
                                    false);
                            continue;
                        }
                        TrackingStore.put(s, "createAcked", true);
                        db.save(s);
                        cutoff(c, db, s, state);
                    } else {
                        String boundary =
                                db.meta(
                                        "boundary:"
                                                + s.optString("userId")
                                                + ":"
                                                + s.optString("tripId"),
                                        "");
                        if (!boundary.isEmpty()
                                && Instant.parse(corrected(s, s.getString("startedAt")))
                                        .isBefore(Instant.parse(boundary))) {
                            terminal(
                                    c, db, s, "Clock recovery required: recordings overlap", false);
                            continue;
                        }
                        JSONObject body = new JSONObject();
                        body.put("started_at", corrected(s, s.getString("startedAt")));
                        body.put(
                                "ended_at",
                                s.isNull("endedAt")
                                        ? JSONObject.NULL
                                        : corrected(s, s.getString("endedAt")));
                        JSONObject created = request(db, s, token, "POST", "", body, generation);
                        if (!id.equals(created.getString("id"))
                                || !s.optString("userId")
                                        .equals(created.getString("recorded_by_user_id"))
                                || !Instant.parse(body.getString("started_at"))
                                        .equals(Instant.parse(created.getString("started_at"))))
                            throw new IOException("Invalid session acknowledgement");
                        TrackingStore.put(s, "createAcked", true);
                        db.save(s);
                        cutoff(c, db, s, created);
                    }
                    long budget = SystemClock.elapsedRealtime() + 120000;
                    while (db.count(id) > 0 && SystemClock.elapsedRealtime() < budget) {
                        s = db.session(id);
                        JSONArray batch = db.batch(id), wire = new JSONArray();
                        if (batch.length() == 0) break;
                        for (int j = 0; j < batch.length(); j++) {
                            JSONObject p = TrackingStore.json(batch.getJSONObject(j).toString());
                            p.remove("elapsed");
                            p.put("recorded_at", corrected(s, p.getString("recorded_at")));
                            wire.put(p);
                        }
                        JSONObject reply =
                                request(
                                        db,
                                        s,
                                        token,
                                        "POST",
                                        "/samples/batch",
                                        new JSONObject().put("samples", wire),
                                        generation);
                        long total = 0;
                        for (String k :
                                new String[] {
                                    "accepted_samples",
                                    "filtered_samples",
                                    "duplicate_samples",
                                    "discarded_samples"
                                }) {
                            Object v = reply.get(k);
                            if (!(v instanceof Integer) || (Integer) v < 0)
                                throw new IOException("Invalid batch acknowledgement");
                            total += (Integer) v;
                        }
                        if (total != batch.length() || !reply.has("session_ended_at"))
                            throw new IOException("Incomplete batch acknowledgement");
                        // Parse cutoff before retiring points: malformed replies acknowledge
                        // nothing.
                        if (!reply.isNull("session_ended_at"))
                            Instant.parse(reply.getString("session_ended_at"));
                        db.acknowledge(id, batch, reply);
                        s = db.session(id);
                        cutoff(
                                c,
                                db,
                                s,
                                new JSONObject().put("ended_at", reply.get("session_ended_at")));
                    }
                    s = db.session(id);
                    if (db.count(id) > 0) {
                        retry = true;
                        continue;
                    }
                    if (!s.isNull("endedAt")) {
                        JSONObject ended =
                                request(
                                        db,
                                        s,
                                        token,
                                        "PATCH",
                                        "",
                                        new JSONObject()
                                                .put(
                                                        "ended_at",
                                                        corrected(s, s.getString("endedAt"))),
                                        generation);
                        if (!id.equals(ended.getString("id")) || ended.isNull("ended_at"))
                            throw new IOException("Invalid end acknowledgement");
                        Instant.parse(ended.getString("ended_at"));
                        TrackingStore.put(s, "serverEnd", ended.getString("ended_at"));
                        db.complete(s);
                        cancelWork(c, id);
                    } else reason(db, id, null);
                } catch (AuthExpired e) {
                    JSONObject latest = db.session(id);
                    if (latest != null && latest.optLong("generation") == credentialGeneration) {
                        if (e.rejected)
                            TrackingStore.put(
                                    latest,
                                    "rejectedCredentials",
                                    latest.optInt("rejectedCredentials") + 1);
                        if (latest.optInt("rejectedCredentials") >= 2)
                            block(
                                    c,
                                    db,
                                    latest,
                                    "Upload authorization was rejected again; sign in again or"
                                            + " check your trip permissions.");
                        else
                            pause(
                                    c,
                                    db,
                                    latest,
                                    "Upload authorization expired; open online to resume syncing.");
                    }
                } catch (HttpFailure e) {
                    s = db.session(id);
                    if (s == null) continue;
                    if (e.code == 409 && "session_deleted".equals(e.reasonCode))
                        terminal(c, db, s, "This recording was deleted.", true);
                    else if (e.code == 404)
                        terminal(c, db, s, "Trip or recording no longer available", false);
                    else if (e.code == 409)
                        terminal(
                                c,
                                db,
                                s,
                                "Recording conflicts with the server; review it in the app",
                                false);
                    else if (e.code == 403) {
                        block(c, db, s, "Upload paused: " + e.getMessage(), true);
                    } else if (e.code == 422) {
                        block(c, db, s, "Upload paused: " + e.getMessage());
                    } else {
                        retry = true;
                        reason(db, id, "Upload failed; waiting to retry");
                        if (e.retryAfter > 0) {
                            s = db.session(id);
                            TrackingStore.put(s, "notBefore", db.ageNow() + e.retryAfter);
                            db.save(s);
                        }
                    }
                } catch (Exception e) {
                    if (generation == identityGeneration) {
                        reason(db, id, "Upload failed; waiting to retry");
                        retry = true;
                    }
                } finally {
                    runningSession = null;
                }
            }
            return retry;
        }
    }

    private static String corrected(JSONObject s, String value) {
        return Instant.ofEpochMilli(Instant.parse(value).toEpochMilli() + s.optLong("offset"))
                .toString();
    }

    static void reason(TrackingStore db, String id, String text) {
        JSONObject s = db.session(id);
        if (s != null) {
            TrackingStore.put(s, "reason", text);
            db.save(s);
        }
    }

    private static void pause(Context c, TrackingStore db, JSONObject s, String why) {
        TrackingStore.put(s, "authPaused", true);
        TrackingStore.put(s, "reason", why);
        db.save(s);
        cancelWork(c, s.optString("sessionId"));
    }

    private static void block(Context c, TrackingStore db, JSONObject s, String why) {
        block(c, db, s, why, false);
    }

    private static void block(
            Context c, TrackingStore db, JSONObject s, String why, boolean renewOnForeground) {
        TrackingStore.put(s, "blocked", true);
        TrackingStore.put(s, "renewOnForeground", renewOnForeground);
        TrackingStore.put(s, "reason", why);
        db.save(s);
        cancelWork(c, s.optString("sessionId"));
    }

    private static void terminal(
            Context c, TrackingStore db, JSONObject s, String why, boolean deleted) {
        db.stop(s.optString("sessionId"), why);
        s = db.session(s.optString("sessionId"));
        TrackingStore.put(s, "terminal", true);
        TrackingStore.put(s, "deleted", deleted);
        db.save(s);
        cancelWork(c, s.optString("sessionId"));
        stopCapture(c, s.optString("sessionId"));
    }

    private static void cutoff(Context c, TrackingStore db, JSONObject s, JSONObject state)
            throws JSONException {
        if (state.isNull("ended_at")) return;
        long cutoff =
                Instant.parse(state.getString("ended_at")).toEpochMilli() - s.optLong("offset");
        boolean remote = s.isNull("endedAt");
        TrackingStore.put(s, "endedAt", Instant.ofEpochMilli(cutoff).toString());
        TrackingStore.put(s, "serverEnd", state.getString("ended_at"));
        if (remote) TrackingStore.put(s, "reason", "Recording stopped remotely; finishing sync.");
        db.save(s);
        if (remote) {
            stopCapture(c, s.optString("sessionId"));
            schedule(c, s, true);
        }
    }

    private static void stopCapture(Context c, String id) {
        new Handler(Looper.getMainLooper())
                .post(
                        () -> {
                            TrackingService service = TrackingService.getInstance();
                            if (service != null
                                    && id.equals(TrackingStore.get(c).meta("captureId", "")))
                                service.stopNativeCapture();
                        });
    }

    private static JSONObject request(
            TrackingStore db,
            JSONObject s,
            JSONObject token,
            String method,
            String suffix,
            JSONObject body,
            long identity)
            throws Exception {
        if (identity != identityGeneration
                || Thread.currentThread().isInterrupted()
                || !s.optString("userId").equals(db.meta("identity", "")))
            throw new IOException("Upload cancelled");
        JSONObject latest = db.session(s.optString("sessionId"));
        if (latest == null
                || latest.optBoolean("terminal")
                || latest.optBoolean("blocked")
                || latest.optBoolean("authPaused")) throw new IOException("Upload paused");
        if (latest.optBoolean("wifiOnlyUpload") && !wifi(db.context))
            throw new IOException("Waiting for Wi-Fi");
        if (token.optInt("deadlineBoot", -1) == db.boot()
                && SystemClock.elapsedRealtime() >= token.optLong("deadline"))
            throw new AuthExpired(false);
        URL url =
                new URL(
                        s.getString("apiBaseUrl")
                                + "/api/v1/trips/"
                                + s.getString("tripId")
                                + "/tracking/sessions/"
                                + s.getString("sessionId")
                                + suffix);
        HttpURLConnection c = (HttpURLConnection) url.openConnection();
        connectionOwner = Thread.currentThread();
        connection = c;
        try {
            c.setConnectTimeout(15000);
            c.setReadTimeout(20000);
            c.setInstanceFollowRedirects(false);
            c.setRequestMethod(method);
            c.setRequestProperty("Authorization", "Bearer " + token.getString("upload_token"));
            c.setRequestProperty("Accept", "application/json");
            if (body != null) {
                c.setDoOutput(true);
                c.setRequestProperty("Content-Type", "application/json");
                byte[] bytes = body.toString().getBytes(java.nio.charset.StandardCharsets.UTF_8);
                c.setFixedLengthStreamingMode(bytes.length);
                try (OutputStream out = c.getOutputStream()) {
                    out.write(bytes);
                }
            }
            int code = c.getResponseCode();
            if (code == 401) throw new AuthExpired(true);
            InputStream in = code < 400 ? c.getInputStream() : c.getErrorStream();
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            if (in != null)
                try (InputStream stream = in) {
                    byte[] b = new byte[4096];
                    int n;
                    while ((n = stream.read(b)) != -1) {
                        if (out.size() + n > 2_000_000)
                            throw new IOException("Oversized server response");
                        out.write(b, 0, n);
                    }
                }
            JSONObject reply;
            try {
                reply = new JSONObject(out.toString("UTF-8"));
            } catch (JSONException e) {
                reply = new JSONObject();
                if (code < 400) throw e;
            }
            if (code >= 300) {
                long delay = 0;
                String after = c.getHeaderField("Retry-After");
                if (after != null)
                    try {
                        delay = Long.parseLong(after) * 1000;
                    } catch (NumberFormatException e) {
                        try {
                            delay =
                                    ZonedDateTime.parse(after, DateTimeFormatter.RFC_1123_DATE_TIME)
                                                    .toInstant()
                                                    .toEpochMilli()
                                            - c.getHeaderFieldDate("Date", 0);
                        } catch (Exception ignored) {
                        }
                    }
                JSONObject detail = reply.optJSONObject("detail");
                throw new HttpFailure(
                        code,
                        reply.optString("detail", "Server returned " + code),
                        detail == null ? "" : detail.optString("code"),
                        Math.max(0, delay));
            }
            latest = db.session(s.optString("sessionId"));
            if (latest != null && latest.optLong("generation") == s.optLong("generation")) {
                TrackingStore.put(latest, "rejectedCredentials", 0);
                db.save(latest);
            }
            return reply;
        } finally {
            c.disconnect();
            if (connection == c) connection = null;
        }
    }

    static final class AuthExpired extends IOException {
        final boolean rejected;

        AuthExpired(boolean rejected) {
            this.rejected = rejected;
        }
    }

    static final class HttpFailure extends IOException {
        final int code;
        final String reasonCode;
        final long retryAfter;

        HttpFailure(int code, String message, String reason, long retryAfter) {
            super(message);
            this.code = code;
            reasonCode = reason;
            this.retryAfter = retryAfter;
        }
    }
}
