package app.openvoyage;

import android.content.*;
import android.database.Cursor;
import android.database.sqlite.*;
import android.location.Location;
import android.os.SystemClock;
import android.provider.Settings;
import android.security.keystore.*;
import android.util.Base64;

import org.json.*;

import java.security.KeyStore;
import java.time.Instant;
import java.util.UUID;

import javax.crypto.*;
import javax.crypto.spec.GCMParameterSpec;

/** Tracker-process-only durable recording state. No UI process opens this database. */
final class TrackingStore extends SQLiteOpenHelper {
    private static TrackingStore instance;
    final Context context;

    static synchronized TrackingStore get(Context c) {
        if (instance == null) instance = new TrackingStore(c.getApplicationContext());
        return instance;
    }

    TrackingStore(Context c) {
        super(c, "tracking-native.db", null, 2);
        context = c;
    }

    @Override
    public void onCreate(SQLiteDatabase db) {
        db.execSQL(
                "CREATE TABLE sessions(seq INTEGER PRIMARY KEY AUTOINCREMENT,id TEXT UNIQUE NOT"
                    + " NULL,user TEXT NOT NULL,trip TEXT NOT NULL,data TEXT NOT NULL,credential"
                    + " TEXT)");
        db.execSQL(
                "CREATE TABLE samples(seq INTEGER PRIMARY KEY AUTOINCREMENT,id TEXT UNIQUE NOT"
                        + " NULL,session TEXT NOT NULL,data TEXT NOT NULL,age INTEGER NOT"
                        + " NULL,enqueue_boot INTEGER NOT NULL)");
        db.execSQL("CREATE INDEX sample_session ON samples(session,seq)");
        db.execSQL("CREATE TABLE meta(key TEXT PRIMARY KEY,value TEXT NOT NULL)");
    }

    @Override
    public void onUpgrade(SQLiteDatabase db, int old, int version) {
        if (old < 2)
            db.execSQL("ALTER TABLE samples ADD COLUMN enqueue_boot INTEGER NOT NULL DEFAULT -1");
    }

    int boot() {
        return Settings.Global.getInt(context.getContentResolver(), Settings.Global.BOOT_COUNT, -1);
    }

    static JSONObject json(String s) {
        try {
            return new JSONObject(s);
        } catch (JSONException e) {
            throw new IllegalStateException(e);
        }
    }

    private static final class Recording extends JSONObject {
        JSONObject original;

        Recording(String value) throws JSONException {
            super(value);
            original = json(value);
        }
    }

    private static JSONObject recording(String value) {
        try {
            return new Recording(value);
        } catch (JSONException e) {
            throw new IllegalStateException(e);
        }
    }

    static JSONObject put(JSONObject o, String k, Object v) {
        try {
            o.put(k, v == null ? JSONObject.NULL : v);
            return o;
        } catch (JSONException e) {
            throw new IllegalStateException(e);
        }
    }

    synchronized String meta(String k, String fallback) {
        try (Cursor c =
                getReadableDatabase()
                        .rawQuery("SELECT value FROM meta WHERE key=?", new String[] {k})) {
            return c.moveToFirst() ? c.getString(0) : fallback;
        }
    }

    synchronized void setMeta(String k, Object v) {
        ContentValues cv = new ContentValues();
        cv.put("key", k);
        cv.put("value", String.valueOf(v));
        getWritableDatabase()
                .insertWithOnConflict("meta", null, cv, SQLiteDatabase.CONFLICT_REPLACE);
    }

    synchronized long ageNow() {
        SQLiteDatabase db = getWritableDatabase();
        db.beginTransaction();
        try {
            long elapsed = SystemClock.elapsedRealtime();
            long age = Long.parseLong(meta("age", "0"));
            int lastBoot = Integer.parseInt(meta("ageBoot", String.valueOf(boot())));
            long previous = Long.parseLong(meta("ageElapsed", String.valueOf(elapsed)));
            age += lastBoot == boot() ? Math.max(0, elapsed - previous) : elapsed;
            if (lastBoot != boot()) setMeta("ageUncertain", "true");
            setMeta("age", age);
            setMeta("ageBoot", boot());
            setMeta("ageElapsed", elapsed);
            db.setTransactionSuccessful();
            return age;
        } finally {
            db.endTransaction();
        }
    }

    synchronized void trustedTime(long serverMs) {
        SQLiteDatabase db = getWritableDatabase();
        db.beginTransaction();
        try {
            long now = ageNow();
            long oldServer = Long.parseLong(meta("ageServer", "0"));
            long oldAge = Long.parseLong(meta("ageServerClock", "0"));
            if (oldServer > 0 && Boolean.parseBoolean(meta("ageUncertain", "false"))) {
                long gap = Math.max(0, serverMs - oldServer - (now - oldAge));
                // Samples from unmeasured boots may have been captured after the
                // unknown downtime. Keep their age conservative across multiple reboots.
                long sequence = Long.parseLong(meta("ageServerSequence", "0"));
                int trustedBoot = Integer.parseInt(meta("ageServerBoot", String.valueOf(boot())));
                getWritableDatabase()
                        .execSQL(
                                "UPDATE samples SET age=age+? WHERE seq>? AND enqueue_boot!=?",
                                new Object[] {gap, sequence, trustedBoot});
                now += gap;
                setMeta("age", now);
                setMeta("ageUncertain", "false");
            }
            setMeta("ageServer", serverMs);
            setMeta("ageServerClock", now);
            setMeta("ageServerBoot", boot());
            try (Cursor cursor = db.rawQuery("SELECT COALESCE(MAX(seq),0) FROM samples", null)) {
                cursor.moveToFirst();
                setMeta("ageServerSequence", cursor.getLong(0));
            }
            db.setTransactionSuccessful();
        } finally {
            db.endTransaction();
        }
    }

    synchronized JSONArray sessions() {
        JSONArray result = new JSONArray();
        try (Cursor c =
                getReadableDatabase().rawQuery("SELECT data FROM sessions ORDER BY seq", null)) {
            while (c.moveToNext()) result.put(recording(c.getString(0)));
        }
        return result;
    }

    synchronized JSONObject session(String id) {
        try (Cursor c =
                getReadableDatabase()
                        .rawQuery("SELECT data FROM sessions WHERE id=?", new String[] {id})) {
            return c.moveToFirst() ? recording(c.getString(0)) : null;
        }
    }

    synchronized void save(JSONObject s) {
        if (s instanceof Recording) {
            Recording record = (Recording) s;
            JSONObject latest = session(s.optString("sessionId"));
            if (latest == null) return;
            java.util.Iterator<String> keys = s.keys();
            while (keys.hasNext()) {
                String k = keys.next();
                if (!java.util.Objects.equals(
                        String.valueOf(s.opt(k)), String.valueOf(record.original.opt(k))))
                    put(latest, k, s.opt(k));
            }
            java.util.Iterator<String> fresh = latest.keys();
            while (fresh.hasNext()) {
                String k = fresh.next();
                put(s, k, latest.opt(k));
            }
            record.original = json(s.toString());
        }
        ContentValues cv = new ContentValues();
        cv.put("data", s.toString());
        getWritableDatabase()
                .update("sessions", cv, "id=?", new String[] {s.optString("sessionId")});
    }

    synchronized JSONObject active() {
        JSONArray rows = sessions();
        for (int i = 0; i < rows.length(); i++) {
            JSONObject s = rows.optJSONObject(i);
            if (s.isNull("endedAt") && !s.optBoolean("terminal")) return s;
        }
        return null;
    }

    synchronized JSONObject begin(JSONObject input) {
        if (active() != null)
            throw new IllegalStateException("A recording is already running on this device");
        if (!input.optString("userId").equals(meta("identity", "")))
            throw new IllegalStateException("Sign in before recording");
        long elapsed = SystemClock.elapsedRealtime(), wall = System.currentTimeMillis();
        JSONObject s = json(input.toString());
        put(s, "startElapsed", elapsed);
        put(s, "startWall", wall);
        put(s, "boot", boot());
        put(s, "startedAt", Instant.ofEpochMilli(wall).toString());
        put(s, "endedAt", null);
        put(s, "travelMode", "UNKNOWN");
        put(s, "reason", "Recording locally; open online to enable background upload.");
        ContentValues cv = new ContentValues();
        cv.put("id", s.optString("sessionId"));
        cv.put("user", s.optString("userId"));
        cv.put("trip", s.optString("tripId"));
        cv.put("data", s.toString());
        SQLiteDatabase db = getWritableDatabase();
        db.beginTransaction();
        try {
            db.insertOrThrow("sessions", null, cv);
            setMeta("captureId", s.optString("sessionId"));
            db.setTransactionSuccessful();
        } finally {
            db.endTransaction();
        }
        return s;
    }

    static long localNow(JSONObject s) {
        return s.optLong("startWall") + SystemClock.elapsedRealtime() - s.optLong("startElapsed");
    }

    synchronized JSONObject stop(String id, String reason) {
        JSONObject s = session(id);
        if (s == null) return null;
        if (s.isNull("endedAt")) {
            if (s.optInt("boot") != boot()) {
                put(s, "terminal", true);
                reason = "Clock recovery required after device reboot";
            } else put(s, "endedAt", Instant.ofEpochMilli(localNow(s)).toString());
        }
        put(s, "reason", reason);
        save(s);
        return s;
    }

    synchronized boolean accept(
            Location l, String power, long interval, float distance, boolean smart) {
        JSONObject s = active();
        if (s == null) return false;
        if (s.optInt("boot") != boot()) {
            put(s, "terminal", true);
            put(s, "reason", "Clock recovery required after device reboot");
            save(s);
            return false;
        }
        long at = l.getElapsedRealtimeNanos() / 1_000_000L;
        if (at < s.optLong("startElapsed")) return false;
        if (l.isFromMockProvider()) {
            put(s, "simulated", s.optInt("simulated") + 1);
            save(s);
            return false;
        }
        if (!Double.isFinite(l.getLatitude())
                || !Double.isFinite(l.getLongitude())
                || Math.abs(l.getLatitude()) > 90
                || Math.abs(l.getLongitude()) > 180
                || (l.getLatitude() == 0 && l.getLongitude() == 0)) return false;
        if ((l.hasAccuracy() && (!Float.isFinite(l.getAccuracy()) || l.getAccuracy() < 0))
                || (l.hasSpeed() && !Float.isFinite(l.getSpeed()))
                || (l.hasBearing() && !Float.isFinite(l.getBearing()))
                || (l.hasAltitude() && !Double.isFinite(l.getAltitude()))) return false;
        JSONObject last = s.optJSONObject("last");
        long since = at - (last == null ? s.optLong("startElapsed") : last.optLong("elapsed"));
        float[] meters = new float[1];
        if (last != null) {
            if (since <= 0) return false;
            Location.distanceBetween(
                    last.optDouble("latitude"),
                    last.optDouble("longitude"),
                    l.getLatitude(),
                    l.getLongitude(),
                    meters);
            if (since > 0 && meters[0] / (since / 1000.0) > 350) return false;
            if (!smart
                    && since < interval
                    && !(distance > 0 && since >= interval / 4 && meters[0] >= distance))
                return false;
        }
        double cutoff =
                "high".equals(power)
                        ? Double.POSITIVE_INFINITY
                        : ("balanced".equals(power) ? 300 : 1000);
        if (l.hasAccuracy() && l.getAccuracy() > cutoff && since <= interval * 3) return false;
        JSONObject p = new JSONObject();
        put(p, "id", UUID.randomUUID().toString());
        put(p, "elapsed", at);
        put(
                p,
                "recorded_at",
                Instant.ofEpochMilli(s.optLong("startWall") + at - s.optLong("startElapsed"))
                        .toString());
        put(p, "latitude", l.getLatitude());
        put(p, "longitude", l.getLongitude());
        put(p, "accuracy_meters", l.hasAccuracy() ? l.getAccuracy() : null);
        put(p, "speed_mps", l.hasSpeed() ? Math.max(0, l.getSpeed()) : null);
        put(p, "heading_degrees", l.hasBearing() ? l.getBearing() : null);
        put(p, "altitude_meters", l.hasAltitude() ? l.getAltitude() : null);
        put(p, "travel_mode", s.optString("travelMode", "UNKNOWN"));
        SQLiteDatabase db = getWritableDatabase();
        db.beginTransaction();
        try {
            long age = ageNow();
            ContentValues cv = new ContentValues();
            cv.put("id", p.optString("id"));
            cv.put("session", s.optString("sessionId"));
            cv.put("data", p.toString());
            cv.put("age", age);
            cv.put("enqueue_boot", boot());
            db.insertOrThrow("samples", null, cv);
            put(s, "last", p);
            if (!s.has("firstFixAt")) put(s, "firstFixAt", System.currentTimeMillis());
            save(s);
            evict(age);
            db.setTransactionSuccessful();
        } finally {
            db.endTransaction();
        }
        return true;
    }

    synchronized void evict(long age) {
        SQLiteDatabase db = getWritableDatabase();
        // Known elapsed age is a safe lower bound even while reboot downtime is uncertain.
        int dropped =
                db.delete("samples", "age<?", new String[] {String.valueOf(age - 7L * 86400000)});
        long excess = Math.max(0, count(null) - 10000);
        if (excess > 0) {
            db.execSQL(
                    "DELETE FROM samples WHERE seq IN (SELECT seq FROM samples ORDER BY seq LIMIT"
                            + " ?)",
                    new Object[] {excess});
            dropped += excess;
        }
        if (dropped > 0) setMeta("dropped", Long.parseLong(meta("dropped", "0")) + dropped);
    }

    synchronized int count(String id) {
        try (Cursor c =
                getReadableDatabase()
                        .rawQuery(
                                "SELECT COUNT(*) FROM samples"
                                        + (id == null ? "" : " WHERE session=?"),
                                id == null ? null : new String[] {id})) {
            c.moveToFirst();
            return c.getInt(0);
        }
    }

    synchronized JSONArray batch(String id) {
        JSONArray a = new JSONArray();
        try (Cursor c =
                getReadableDatabase()
                        .rawQuery(
                                "SELECT data FROM samples WHERE session=? ORDER BY seq LIMIT 1000",
                                new String[] {id})) {
            while (c.moveToNext()) a.put(json(c.getString(0)));
        }
        return a;
    }

    synchronized void acknowledge(String id, JSONArray batch, JSONObject reply) {
        SQLiteDatabase db = getWritableDatabase();
        db.beginTransaction();
        try {
            for (int i = 0; i < batch.length(); i++)
                db.delete(
                        "samples",
                        "id=? AND session=?",
                        new String[] {batch.optJSONObject(i).optString("id"), id});
            JSONObject s = session(id);
            put(s, "filtered", s.optInt("filtered") + reply.optInt("filtered_samples"));
            put(s, "discarded", s.optInt("discarded") + reply.optInt("discarded_samples"));
            put(s, "lastSyncAt", Instant.now().toString());
            save(s);
            db.setTransactionSuccessful();
        } finally {
            db.endTransaction();
        }
    }

    synchronized boolean predecessorPending(JSONObject s) {
        JSONArray rows = sessions();
        for (int i = 0; i < rows.length(); i++) {
            JSONObject p = rows.optJSONObject(i);
            if (p.optString("sessionId").equals(s.optString("sessionId"))) return false;
            if (p.optString("userId").equals(s.optString("userId"))
                    && p.optString("tripId").equals(s.optString("tripId"))
                    && !p.optBoolean("deleted")) return true;
        }
        return false;
    }

    synchronized void complete(JSONObject s) {
        setMeta(
                "boundary:" + s.optString("userId") + ":" + s.optString("tripId"),
                s.optString("serverEnd", ""));
        getWritableDatabase().delete("sessions", "id=?", new String[] {s.optString("sessionId")});
    }

    synchronized void updateCredentialClock(String id, JSONObject token, long generation) {
        JSONObject s = session(id);
        if (s == null || s.optLong("generation") != generation) return;
        ContentValues values = new ContentValues();
        values.put("credential", encrypt(token.toString()));
        getWritableDatabase().update("sessions", values, "id=?", new String[] {id});
    }

    synchronized void credential(String id, JSONObject token) {
        JSONObject s = session(id);
        if (s == null
                || !s.optString("userId").equals(meta("identity", ""))
                || !s.optString("userId").equals(token.optString("recorded_by_user_id"))
                || !s.optString("tripId").equals(token.optString("trip_id"))
                || !id.equals(token.optString("session_id")))
            throw new IllegalStateException("Upload credential identity mismatch");
        ContentValues cv = new ContentValues();
        cv.put("credential", encrypt(token.toString()));
        SQLiteDatabase db = getWritableDatabase();
        db.beginTransaction();
        try {
            db.update("sessions", cv, "id=?", new String[] {id});
            put(s, "generation", s.optLong("generation") + 1);
            put(s, "authPaused", false);
            if (s.optBoolean("renewOnForeground")) put(s, "blocked", false);
            put(s, "renewOnForeground", false);
            put(s, "reason", null);
            save(s);
            db.setTransactionSuccessful();
        } finally {
            db.endTransaction();
        }
    }

    synchronized JSONObject credential(String id) {
        try (Cursor c =
                getReadableDatabase()
                        .rawQuery(
                                "SELECT credential FROM sessions WHERE id=?", new String[] {id})) {
            return c.moveToFirst() && !c.isNull(0) ? json(decrypt(c.getString(0))) : null;
        }
    }

    synchronized void clearCredentials() {
        getWritableDatabase().execSQL("UPDATE sessions SET credential=NULL");
    }

    private javax.crypto.SecretKey key() throws Exception {
        KeyStore ks = KeyStore.getInstance("AndroidKeyStore");
        ks.load(null);
        if (!ks.containsAlias("tracking-upload")) {
            KeyGenerator g =
                    KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
            g.init(
                    new KeyGenParameterSpec.Builder(
                                    "tracking-upload",
                                    KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                            .build());
            g.generateKey();
        }
        return (javax.crypto.SecretKey) ks.getKey("tracking-upload", null);
    }

    private String encrypt(String value) {
        try {
            Cipher c = Cipher.getInstance("AES/GCM/NoPadding");
            c.init(Cipher.ENCRYPT_MODE, key());
            return Base64.encodeToString(c.getIV(), Base64.NO_WRAP)
                    + ":"
                    + Base64.encodeToString(
                            c.doFinal(value.getBytes(java.nio.charset.StandardCharsets.UTF_8)),
                            Base64.NO_WRAP);
        } catch (Exception e) {
            throw new IllegalStateException("Could not protect upload credential", e);
        }
    }

    private String decrypt(String value) {
        try {
            String[] parts = value.split(":");
            Cipher c = Cipher.getInstance("AES/GCM/NoPadding");
            c.init(
                    Cipher.DECRYPT_MODE,
                    key(),
                    new GCMParameterSpec(128, Base64.decode(parts[0], Base64.NO_WRAP)));
            return new String(
                    c.doFinal(Base64.decode(parts[1], Base64.NO_WRAP)),
                    java.nio.charset.StandardCharsets.UTF_8);
        } catch (Exception e) {
            throw new IllegalStateException(
                    "Upload credential unavailable; open online to renew", e);
        }
    }

    synchronized JSONArray snapshot() {
        evict(ageNow());
        JSONArray all = sessions(), rows = new JSONArray();
        for (int i = 0; i < all.length(); i++) {
            JSONObject row = all.optJSONObject(i);
            if (row.optString("userId").equals(meta("identity", ""))) rows.put(row);
        }
        for (int i = 0; i < rows.length(); i++) {
            JSONObject s = rows.optJSONObject(i);
            put(s, "syncing", TrackingSync.isSyncing(s.optString("sessionId")));
            put(s, "pending", count(s.optString("sessionId")));
            put(s, "dropped", Long.parseLong(meta("dropped", "0")));
            put(s, "totalPending", count(null));
            put(s, "ageUncertain", Boolean.parseBoolean(meta("ageUncertain", "false")));
            JSONObject token = null;
            try {
                token = credential(s.optString("sessionId"));
            } catch (IllegalStateException e) {
                put(s, "reason", e.getMessage());
                put(s, "authPaused", true);
            }
            put(s, "expiresAt", token == null ? null : token.optString("expires_at"));
            long remaining =
                    token == null
                            ? 0
                            : token.optInt("deadlineBoot", -1) == boot()
                                    ? Math.max(
                                            0,
                                            token.optLong("deadline")
                                                    - SystemClock.elapsedRealtime())
                                    : 0;
            put(s, "renewInMs", remaining);
            if (!s.optBoolean("terminal")
                    && !s.optBoolean("blocked")
                    && (token == null || remaining == 0)) {
                put(s, "authPaused", true);
                put(
                        s,
                        "reason",
                        token == null
                                ? "Recording locally; open online to enable background upload."
                                : "Upload authorization expired; open online to resume syncing.");
            }
            s.remove("last");
        }
        return rows;
    }
}
