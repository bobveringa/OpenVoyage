package app.openvoyage;

import static org.junit.Assert.*;

import android.content.Context;
import android.content.ContextWrapper;
import android.database.DatabaseErrorHandler;
import android.database.sqlite.SQLiteDatabase;
import android.location.Location;
import android.os.SystemClock;

import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;

import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.After;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;

import java.io.*;
import java.lang.reflect.Field;
import java.lang.reflect.Method;
import java.net.ServerSocket;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.*;
import java.util.concurrent.*;

/** Real Android SQLite, Keystore and HTTP; isolated from the recorder's database. */
@RunWith(AndroidJUnit4.class)
public class TrackingUploadDeviceTest {
    private Context context;
    private TrackingStore store;
    private TrackingStore previousStore;
    private File directory;
    private FakeServer server;
    private final String user = UUID.randomUUID().toString();
    private final String trip = UUID.randomUUID().toString();

    @Before
    public void prepare() throws Exception {
        Context target = InstrumentationRegistry.getInstrumentation().getTargetContext();
        directory = new File(target.getCacheDir(), "upload-test-" + UUID.randomUUID());
        assertTrue(directory.mkdirs());
        context =
                new ContextWrapper(target) {
                    @Override
                    public File getDatabasePath(String name) {
                        return new File(directory, name);
                    }

                    @Override
                    public SQLiteDatabase openOrCreateDatabase(
                            String name, int mode, SQLiteDatabase.CursorFactory factory) {
                        return SQLiteDatabase.openOrCreateDatabase(getDatabasePath(name), factory);
                    }

                    @Override
                    public SQLiteDatabase openOrCreateDatabase(
                            String name,
                            int mode,
                            SQLiteDatabase.CursorFactory factory,
                            DatabaseErrorHandler handler) {
                        return SQLiteDatabase.openOrCreateDatabase(
                                getDatabasePath(name).getPath(), factory, handler);
                    }
                };
        store = new TrackingStore(context);
        Field instance = TrackingStore.class.getDeclaredField("instance");
        instance.setAccessible(true);
        previousStore = (TrackingStore) instance.get(null);
        instance.set(null, store);
        store.setMeta("identity", user);
        server = new FakeServer();
    }

    @After
    public void clean() throws Exception {
        server.close();
        store.close();
        Field instance = TrackingStore.class.getDeclaredField("instance");
        instance.setAccessible(true);
        instance.set(null, previousStore);
        for (File file : Objects.requireNonNull(directory.listFiles())) assertTrue(file.delete());
        assertTrue(directory.delete());
    }

    private JSONObject begin() throws Exception {
        return store.begin(
                new JSONObject()
                        .put("sessionId", UUID.randomUUID().toString())
                        .put("userId", user)
                        .put("tripId", trip)
                        .put("tripTitle", "Device test")
                        .put("apiBaseUrl", "http://127.0.0.1:" + server.socket.getLocalPort()));
    }

    private JSONObject credential(JSONObject session, long remaining) throws Exception {
        JSONObject token =
                new JSONObject()
                        .put("upload_token", "isolated-test-token")
                        .put("session_id", session.getString("sessionId"))
                        .put("trip_id", trip)
                        .put("recorded_by_user_id", user)
                        .put("expires_at", Instant.now().plusSeconds(3600).toString())
                        .put("deadlineBoot", store.boot())
                        .put("deadline", SystemClock.elapsedRealtime() + remaining);
        store.credential(session.getString("sessionId"), token);
        return token;
    }

    private Location fix(double latitude, long elapsedMs) {
        Location fix = new Location("gps");
        fix.setElapsedRealtimeNanos(elapsedMs * 1_000_000L);
        fix.setTime(System.currentTimeMillis());
        fix.setLatitude(latitude);
        fix.setLongitude(5.5);
        fix.setAccuracy(8);
        fix.setSpeed(1);
        fix.setBearing(42);
        fix.setAltitude(15);
        return fix;
    }

    private void enqueue(JSONObject session, int count) throws Exception {
        String id = session.getString("sessionId");
        store.getWritableDatabase().beginTransaction();
        try {
            for (int i = 0; i < count; i++) {
                JSONObject sample =
                        new JSONObject()
                                .put("id", UUID.randomUUID().toString())
                                .put("recorded_at", session.getString("startedAt"))
                                .put("latitude", 51.5)
                                .put("longitude", 5.5)
                                .put("travel_mode", "WALK");
                store.getWritableDatabase()
                        .execSQL(
                                "INSERT INTO samples(id,session,data,age,enqueue_boot)"
                                        + " VALUES(?,?,?,?,?)",
                                new Object[] {
                                    sample.getString("id"),
                                    id,
                                    sample.toString(),
                                    store.ageNow(),
                                    store.boot()
                                });
            }
            store.getWritableDatabase().setTransactionSuccessful();
        } finally {
            store.getWritableDatabase().endTransaction();
        }
    }

    @Test
    public void firstAcceptedPointSchedulesOnceAndLaterPointsKeepTheBatchCadence() throws Exception {
        JSONObject session = begin();
        String id = session.getString("sessionId");
        class TestService extends TrackingService {
            void attach(Context base) { attachBaseContext(base); }
        }
        TestService service = new TestService();
        service.attach(context);
        Field tracking = TrackingService.class.getDeclaredField("tracking");
        tracking.setAccessible(true);
        tracking.set(service, true);
        Method onFix = TrackingService.class.getDeclaredMethod("onFix", Location.class);
        onFix.setAccessible(true);
        androidx.work.WorkManager work = androidx.work.WorkManager.getInstance(context);
        try {
            long start = session.getLong("startElapsed");
            Location rejected = fix(51.5, start + 1);
            rejected.setMock(true);
            onFix.invoke(service, rejected);
            assertEquals(0, store.count(id));
            assertTrue(work.getWorkInfosForUniqueWork(TrackingSync.retry(id)).get().isEmpty());

            onFix.invoke(service, fix(51.5, start + 1000));
            List<androidx.work.WorkInfo> first = null;
            for (int i = 0; i < 50; i++) {
                first = work.getWorkInfosForUniqueWork(TrackingSync.retry(id)).get();
                if (!first.isEmpty()) break;
                Thread.sleep(100);
            }
            assertEquals(1, first.size());
            assertEquals(1, store.count(id));
            assertTrue(store.session(id).has("firstFixAt"));
            assertEquals(1, work.getWorkInfosForUniqueWork(TrackingSync.periodic(id)).get().size());

            // Emptying the queue must not make the next point another "first" point.
            store.getWritableDatabase().delete("samples", "session=?", new String[] {id});
            onFix.invoke(service, fix(51.50001, start + 31000));
            assertEquals(1, store.count(id));
            List<androidx.work.WorkInfo> later = work.getWorkInfosForUniqueWork(TrackingSync.retry(id)).get();
            assertEquals(1, later.size());
            assertEquals(first.get(0).getId(), later.get(0).getId());
        } finally {
            TrackingSync.cancelWork(context, id);
        }
    }

    @Test
    public void manualSyncUsesMobileDataOnceAndKeepsWifiOnlyForAutomaticRetries() throws Exception {
        org.junit.Assume.assumeTrue(android.os.Build.HARDWARE.contains("ranchu")
                || android.os.Build.HARDWARE.contains("goldfish"));
        boolean wasWifi = "1".equals(shell("settings get global wifi_on").trim());
        shell("svc wifi disable");
        try {
            for (int i = 0; i < 100 && (TrackingSync.wifi(context) || !TrackingSync.connected(context)); i++)
                Thread.sleep(100);
            assertFalse("Wi-Fi should be disabled", TrackingSync.wifi(context));
            assertTrue("Emulator mobile data should be connected", TrackingSync.connected(context));
            JSONObject session = begin();
            String id = session.getString("sessionId");
            TrackingStore.put(session, "wifiOnlyUpload", true);
            store.save(session);
            credential(session, 3600000);
            enqueue(session, 1);
            assertTrue(TrackingSync.run(context, id));
            assertTrue(server.requests.isEmpty());

            server.badCounts = true;
            assertTrue(TrackingSync.run(context, id, true));
            assertEquals(1, store.count(id));
            int attempted = server.requests.size();
            assertTrue(attempted > 0);
            server.badCounts = false;
            assertTrue(TrackingSync.run(context, id));
            assertEquals(attempted, server.requests.size());
            assertTrue(store.session(id).getBoolean("wifiOnlyUpload"));
            assertFalse(TrackingSync.run(context, id, true));
            assertEquals(0, store.count(id));

            enqueue(store.session(id), 1);
            attempted = server.requests.size();
            assertTrue(TrackingSync.run(context, id));
            assertEquals(attempted, server.requests.size());
            assertEquals(1, store.snapshot().getJSONObject(0).getInt("pending"));
            assertTrue(store.session(id).getBoolean("wifiOnlyUpload"));

            shell("svc data disable");
            try {
                for (int i = 0; i < 100 && TrackingSync.connected(context); i++) Thread.sleep(100);
                assertFalse("Emulator should be offline", TrackingSync.connected(context));
                TrackingSync.syncNow(context, store.session(id));
                assertTrue(store.session(id).getString("reason").startsWith("No connection."));
                assertTrue(androidx.work.WorkManager.getInstance(context)
                        .getWorkInfosForUniqueWork(TrackingSync.manual(id)).get().isEmpty());
                assertEquals(1, store.count(id));
                assertEquals(attempted, server.requests.size());
            } finally {
                shell("svc data enable");
            }
            for (int i = 0; i < 100 && !TrackingSync.connected(context); i++) Thread.sleep(100);
            // Reconnecting after an offline tap must not retain mobile-data permission.
            assertTrue(TrackingSync.run(context, id));
            assertEquals(attempted, server.requests.size());
        } finally {
            if (wasWifi) shell("svc wifi enable");
        }
    }

    @Test
    public void manualSyncCannotBypassServerDelayAuthorizationOrRecordingOwnership() throws Exception {
        JSONObject session = begin();
        String id = session.getString("sessionId");
        enqueue(session, 1);
        credential(session, 3600000);
        JSONObject current = store.session(id);
        TrackingStore.put(current, "notBefore", store.ageNow() + 60000);
        store.save(current);
        assertTrue(TrackingSync.run(context, id, true));
        assertTrue(server.requests.isEmpty());
        current = store.session(id);
        TrackingStore.put(current, "notBefore", 0);
        store.save(current);
        credential(current, -1);
        assertFalse(TrackingSync.run(context, id, true));
        assertTrue(server.requests.isEmpty());
        credential(store.session(id), 3600000);
        store.setMeta("identity", "another-user");
        assertFalse(TrackingSync.run(context, id, true));
        assertTrue(server.requests.isEmpty());
        assertEquals(1, store.count(id));
    }

    private String shell(String command) throws Exception {
        try (android.os.ParcelFileDescriptor result = InstrumentationRegistry.getInstrumentation()
                .getUiAutomation().executeShellCommand(command);
                InputStream input = new android.os.ParcelFileDescriptor.AutoCloseInputStream(result)) {
            return new String(input.readAllBytes(), StandardCharsets.UTF_8);
        }
    }

    @Test
    public void offlineAndExpiredRecordingMakeNoRequestsAndKeepStableSamples() throws Exception {
        JSONObject session = begin();
        String id = session.getString("sessionId");
        assertTrue(store.accept(fix(51.5, SystemClock.elapsedRealtime()), "high", 1000, 0, false));
        String sampleId = store.batch(id).getJSONObject(0).getString("id");
        assertFalse(TrackingSync.run(context, id));
        assertEquals(0, server.requests.size());
        assertEquals(1, store.count(id));
        credential(session, -1);
        assertFalse(TrackingSync.run(context, id));
        assertEquals(0, server.requests.size());
        store.close();
        store = new TrackingStore(context);
        Field instance = TrackingStore.class.getDeclaredField("instance");
        instance.setAccessible(true);
        instance.set(null, store);
        assertEquals(sampleId, store.batch(id).getJSONObject(0).getString("id"));
        assertTrue(store.snapshot().getJSONObject(0).getBoolean("authPaused"));
        credential(store.session(id), 3600000);
        assertFalse(TrackingSync.run(context, id));
        assertEquals(0, store.count(id));
        assertTrue(store.session(id).getBoolean("createAcked"));
        // Uploaded samples no longer anchor acceptance; the last accepted fix still does.
        assertFalse(
                store.accept(
                        fix(-51.5, SystemClock.elapsedRealtime() + 1000), "high", 1000, 0, false));
        try (android.database.Cursor c =
                store.getReadableDatabase()
                        .rawQuery(
                                "SELECT credential FROM sessions WHERE id=?", new String[] {id})) {
            assertTrue(c.moveToFirst());
            assertFalse(c.getString(0).contains("isolated-test-token"));
        }
    }

    @Test
    public void expiryBetweenBatchesAndLostRepliesRetainExactlyUnacknowledgedWork()
            throws Exception {
        JSONObject session = begin();
        String id = session.getString("sessionId");
        enqueue(session, 1001);
        store.stop(id, null);
        credential(session, 3600000);
        server.failBatchNumber = 2;
        assertFalse(TrackingSync.run(context, id));
        assertEquals(1, store.count(id));
        assertTrue(store.session(id).getBoolean("authPaused"));
        long offset = store.session(id).getLong("offset");
        credential(store.session(id), 3600000);
        server.failBatchNumber = -1;
        server.loseBatchReply = true;
        assertTrue(TrackingSync.run(context, id));
        assertEquals(1, store.count(id));
        assertEquals(offset, store.session(id).getLong("offset"));
        server.loseBatchReply = false;
        assertFalse(TrackingSync.run(context, id));
        assertNull(store.session(id));
        assertEquals(1001, server.accepted.size());
        assertFalse(store.meta("boundary:" + user + ":" + trip, "").isEmpty());
    }

    @Test
    public void consecutiveOfflineRecordingsShareClockMappingAndWaitForPredecessor()
            throws Exception {
        JSONObject a = begin();
        String aId = a.getString("sessionId");
        TrackingStore.put(a, "startWall", a.getLong("startWall") + 600000);
        TrackingStore.put(a, "startedAt", Instant.ofEpochMilli(a.getLong("startWall")).toString());
        store.save(a);
        enqueue(a, 1);
        store.stop(aId, null);
        JSONObject b = begin();
        String bId = b.getString("sessionId");
        TrackingStore.put(b, "startWall", b.getLong("startWall") - 600000);
        TrackingStore.put(b, "startedAt", Instant.ofEpochMilli(b.getLong("startWall")).toString());
        store.save(b);
        enqueue(b, 1);
        credential(a, 3600000);
        credential(b, 3600000);
        assertTrue(TrackingSync.run(context, bId));
        assertEquals(0, server.requests.size());
        assertFalse(TrackingSync.run(context, aId));
        assertNull(store.session(aId));
        assertEquals(1, store.count(bId)); // A's lifecycle cannot flush B.
        assertFalse(TrackingSync.run(context, bId));
        JSONObject remoteA = server.rows.get(aId), remoteB = server.rows.get(bId);
        assertFalse(
                Instant.parse(remoteB.getString("started_at"))
                        .isBefore(Instant.parse(remoteA.getString("ended_at"))));
        assertTrue(
                Math.abs(
                                Instant.parse(remoteB.getString("started_at")).toEpochMilli()
                                        - System.currentTimeMillis())
                        < 5000);
        int requests = server.requests.size();
        assertFalse(TrackingSync.run(context, bId));
        assertEquals(requests, server.requests.size()); // Empty active queue doesn't poll.
    }

    @Test
    public void deletedSessionIsTerminalAndMalformedCountsNeverAcknowledgePoints()
            throws Exception {
        JSONObject session = begin();
        String id = session.getString("sessionId");
        enqueue(session, 1);
        credential(session, 3600000);
        server.badCounts = true;
        assertTrue(TrackingSync.run(context, id));
        assertEquals(1, store.count(id));
        server.deleted = true;
        assertFalse(TrackingSync.run(context, id));
        assertTrue(store.session(id).getBoolean("terminal"));
        assertTrue(store.session(id).getBoolean("deleted"));
        assertEquals(1, store.count(id));
        int requests = server.requests.size();
        assertFalse(TrackingSync.run(context, id));
        assertEquals(requests, server.requests.size());
        JSONObject next = begin();
        assertFalse(store.predecessorPending(next));
    }

    @Test
    public void rebootWithoutTrustedRecordingClockRetainsDataAndSurfacesRecovery()
            throws Exception {
        JSONObject session = begin();
        String id = session.getString("sessionId");
        enqueue(session, 1);
        credential(session, 3600000);
        TrackingStore.put(session, "boot", store.boot() - 1);
        store.save(session);
        assertFalse(TrackingSync.run(context, id));
        assertTrue(store.session(id).getBoolean("terminal"));
        assertEquals(1, store.count(id));
        assertTrue(store.session(id).getString("reason").contains("Clock recovery"));
        assertTrue(server.rows.isEmpty());
    }

    @Test
    public void staleUnauthorizedReplyCannotPauseAReplacementCredential() throws Exception {
        JSONObject session = begin();
        String id = session.getString("sessionId");
        enqueue(session, 1);
        credential(session, 3600000);
        server.rejectAll = true;
        server.beforeUnauthorized =
                () -> {
                    try {
                        credential(store.session(id), 3600000);
                    } catch (Exception e) {
                        throw new RuntimeException(e);
                    }
                };
        assertFalse(TrackingSync.run(context, id));
        assertFalse(store.session(id).optBoolean("authPaused"));
        assertEquals(1, store.count(id));
        assertEquals(2, store.session(id).getLong("generation"));
        server.rejectAll = false;
        server.beforeUnauthorized = null;
        assertFalse(TrackingSync.run(context, id));
        assertEquals(0, store.count(id));
    }

    @Test
    public void repeatedlyRejectedCredentialsPauseWithoutARenewalLoop() throws Exception {
        JSONObject session = begin();
        String id = session.getString("sessionId");
        enqueue(session, 1);
        credential(session, 3600000);
        server.rejectAll = true;
        assertFalse(TrackingSync.run(context, id));
        credential(store.session(id), 3600000);
        assertFalse(TrackingSync.run(context, id));
        assertTrue(store.session(id).getBoolean("blocked"));
        assertEquals(1, store.count(id));
        int requests = server.requests.size();
        assertFalse(TrackingSync.run(context, id));
        assertEquals(requests, server.requests.size());
    }

    @Test
    public void accountSwitchRemovesCredentialsStopsCaptureIntentAndKeepsOriginalQueue()
            throws Exception {
        JSONObject session = begin();
        String id = session.getString("sessionId");
        enqueue(session, 1);
        JSONObject token = credential(session, 3600000);
        String nextUser = UUID.randomUUID().toString();
        TrackingSync.changeIdentity(context, nextUser);
        assertNull(store.credential(id));
        assertFalse(store.session(id).isNull("endedAt"));
        assertEquals(1, store.count(id));
        assertEquals(user, store.session(id).getString("userId"));
        assertEquals(0, store.snapshot().length());
        assertThrows(IllegalStateException.class, () -> store.credential(id, token));
        assertFalse(TrackingSync.run(context, id));
        assertTrue(server.requests.isEmpty());
    }

    @Test
    public void retentionUsesCaptureOrderAndTrustedRebootGapDoesNotAgeNewSamples()
            throws Exception {
        JSONObject first = begin();
        String a = first.getString("sessionId");
        enqueue(first, 1);
        store.trustedTime(1_000_000_000L);
        store.stop(a, null);
        JSONObject second = begin();
        String b = second.getString("sessionId");
        enqueue(second, 10000);
        String oldestB = store.batch(b).getJSONObject(0).getString("id");
        store.evict(store.ageNow());
        assertEquals(0, store.count(a));
        assertEquals(10000, store.count(b));
        assertEquals(oldestB, store.batch(b).getJSONObject(0).getString("id"));
        // Simulate old points from a previous boot and fresh points from this boot.
        store.getWritableDatabase()
                .execSQL(
                        "UPDATE samples SET enqueue_boot=? WHERE id=?",
                        new Object[] {store.boot() - 1, oldestB});
        store.setMeta("ageUncertain", true);
        store.setMeta("ageServerBoot", store.boot() - 1);
        store.trustedTime(1_000_000_000L + 8L * 86400000);
        store.evict(store.ageNow());
        assertEquals(9999, store.count(b));
        assertEquals("false", store.meta("ageUncertain", ""));
        assertEquals("2", store.meta("dropped", ""));
    }

    @Test
    public void lostCreateReplyThenDeletionNeverRecreatesTheRecording() throws Exception {
        JSONObject session = begin();
        String id = session.getString("sessionId");
        enqueue(session, 1);
        credential(session, 3600000);
        server.loseCreateReply = true;
        assertTrue(TrackingSync.run(context, id));
        assertFalse(store.session(id).optBoolean("createAcked"));
        long offset = store.session(id).getLong("offset");
        server.deleted = true;
        server.loseCreateReply = false;
        assertFalse(TrackingSync.run(context, id));
        assertTrue(store.session(id).getBoolean("deleted"));
        assertEquals(1, store.count(id));
        assertEquals(offset, store.session(id).getLong("offset"));
        assertEquals(
                1,
                server.requests.stream()
                        .filter(
                                r ->
                                        r.equals(
                                                "POST /api/v1/trips/"
                                                        + trip
                                                        + "/tracking/sessions/"
                                                        + id))
                        .count());
    }

    @Test
    public void expiryAndLostReplyAtFinalEndPreserveTheEndAcknowledgement() throws Exception {
        JSONObject session = begin();
        String id = session.getString("sessionId");
        enqueue(session, 1);
        store.stop(id, null);
        credential(session, 3600000);
        server.rejectEnd = true;
        assertFalse(TrackingSync.run(context, id));
        assertEquals(0, store.count(id));
        assertTrue(store.session(id).getBoolean("authPaused"));
        long offset = store.session(id).getLong("offset");
        credential(store.session(id), 3600000);
        server.rejectEnd = false;
        server.loseEndReply = true;
        assertTrue(TrackingSync.run(context, id));
        assertNotNull(store.session(id));
        assertEquals(offset, store.session(id).getLong("offset"));
        server.loseEndReply = false;
        assertFalse(TrackingSync.run(context, id));
        assertNull(store.session(id));
        assertEquals(1, server.accepted.size());
    }

    @Test
    public void nativeAcceptancePreservesRescueMockRejectionAndTravelMode() throws Exception {
        JSONObject session = begin();
        String id = session.getString("sessionId");
        long elapsed = session.getLong("startElapsed");
        Location poor = fix(51.5, elapsed + 1);
        poor.setAccuracy(500);
        assertFalse(store.accept(poor, "balanced", 1000, 0, false));
        poor.setElapsedRealtimeNanos((elapsed + 4000) * 1_000_000L);
        assertTrue(store.accept(poor, "balanced", 1000, 0, false));
        JSONObject saved = store.batch(id).getJSONObject(0);
        assertEquals("UNKNOWN", saved.getString("travel_mode"));
        JSONObject updated = store.session(id);
        TrackingStore.put(updated, "travelMode", "WALK");
        store.save(updated);
        Location mock = fix(51.5, elapsed + 5000);
        mock.setMock(true);
        assertFalse(store.accept(mock, "high", 1000, 0, false));
        assertEquals(1, store.session(id).getInt("simulated"));
        assertFalse(store.accept(fix(51.5, elapsed + 3000), "high", 1000, 0, false));
        assertTrue(store.accept(fix(51.50001, elapsed + 6000), "high", 1000, 0, false));
        assertEquals("WALK", store.batch(id).getJSONObject(1).getString("travel_mode"));
        Location invalid = fix(51.5, elapsed + 7000);
        invalid.setAltitude(Double.NaN);
        assertFalse(store.accept(invalid, "high", 1000, 0, false));
        assertEquals(2, store.count(id));
    }

    @Test
    public void missingOrExpiredAuthorizationSuspendsWorkBeforeOtherRetryConditions()
            throws Exception {
        JSONObject previous = begin();
        store.stop(previous.getString("sessionId"), null);
        JSONObject session = begin();
        String id = session.getString("sessionId");
        TrackingStore.put(session, "wifiOnlyUpload", true);
        store.save(session);
        assertFalse(TrackingSync.run(context, id));
        assertTrue(store.session(id).getBoolean("authPaused"));
        assertTrue(server.requests.isEmpty());
        JSONObject current = store.session(id);
        TrackingStore.put(current, "createAcked", true);
        store.save(current);
        credential(current, -1);
        assertFalse(TrackingSync.run(context, id));
        assertTrue(store.session(id).getBoolean("authPaused"));
        assertTrue(server.requests.isEmpty());
    }

    @Test
    public void reauthenticationRenewsAnActiveRecordingWithoutChangingItsIdentityOrClock()
            throws Exception {
        JSONObject session = begin();
        String id = session.getString("sessionId");
        enqueue(session, 1);
        credential(session, 3600000);
        assertFalse(TrackingSync.run(context, id));
        long offset = store.session(id).getLong("offset");
        enqueue(store.session(id), 1);
        TrackingSync.reauthorize(context, user);
        assertNull(store.credential(id));
        assertTrue(store.session(id).isNull("endedAt"));
        assertEquals(1, store.count(id));
        assertEquals(offset, store.session(id).getLong("offset"));
        credential(store.session(id), 3600000);
        assertFalse(TrackingSync.run(context, id));
        assertEquals(0, store.count(id));
        assertEquals(1, store.sessions().length());
        assertTrue(store.session(id).isNull("endedAt"));
    }

    @Test
    public void permissionPauseCanBeRevalidatedInForegroundWithoutStoppingCapture()
            throws Exception {
        JSONObject session = begin();
        String id = session.getString("sessionId");
        enqueue(session, 1);
        credential(session, 3600000);
        server.rejectAll = true;
        server.rejectCode = 403;
        assertFalse(TrackingSync.run(context, id));
        assertTrue(store.session(id).getBoolean("blocked"));
        assertTrue(store.session(id).getBoolean("renewOnForeground"));
        assertTrue(store.session(id).isNull("endedAt"));
        int requests = server.requests.size();
        assertFalse(TrackingSync.run(context, id));
        assertEquals(requests, server.requests.size());
        server.rejectAll = false;
        credential(store.session(id), 3600000);
        assertFalse(TrackingSync.run(context, id));
        assertEquals(0, store.count(id));
        assertFalse(store.session(id).getBoolean("blocked"));
        assertTrue(store.session(id).isNull("endedAt"));
    }

    private final class FakeServer implements AutoCloseable {
        final ServerSocket socket = new ServerSocket(0);
        final ExecutorService executor = Executors.newSingleThreadExecutor();
        final List<String> requests = Collections.synchronizedList(new ArrayList<>());
        final Map<String, JSONObject> rows = new ConcurrentHashMap<>();
        final Set<String> accepted = ConcurrentHashMap.newKeySet();
        volatile boolean deleted, badCounts, loseBatchReply;
        volatile boolean rejectAll;
        volatile int rejectCode = 401;
        volatile boolean loseCreateReply, loseEndReply, rejectEnd;
        volatile Runnable beforeUnauthorized;
        volatile int failBatchNumber = -1;
        int batches;

        FakeServer() throws IOException {
            executor.submit(
                    () -> {
                        while (!socket.isClosed())
                            try (Socket client = socket.accept()) {
                                serve(client);
                            } catch (Exception e) {
                                if (!socket.isClosed()) throw new RuntimeException(e);
                            }
                    });
        }

        void serve(Socket client) throws Exception {
            BufferedReader reader =
                    new BufferedReader(
                            new InputStreamReader(client.getInputStream(), StandardCharsets.UTF_8));
            String[] first = reader.readLine().split(" ");
            String method = first[0], path = first[1];
            int length = 0;
            String line;
            while (!(line = reader.readLine()).isEmpty())
                if (line.toLowerCase(Locale.ROOT).startsWith("content-length:"))
                    length = Integer.parseInt(line.substring(15).trim());
            char[] chars = new char[length];
            int offset = 0;
            while (offset < length) offset += reader.read(chars, offset, length - offset);
            JSONObject body = length == 0 ? new JSONObject() : new JSONObject(new String(chars));
            String id = path.split("/")[7];
            requests.add(method + " " + path);
            JSONObject row = rows.get(id), reply = new JSONObject();
            int status = 200;
            if (rejectAll) {
                if (beforeUnauthorized != null) beforeUnauthorized.run();
                status = rejectCode;
                reply.put("detail", "Could not validate credentials");
            } else if (path.endsWith("upload-state")) {
                reply.put("exists", row != null && !deleted)
                        .put("deleted", deleted)
                        .put("server_time", Instant.now().toString())
                        .put("recorded_by_user_id", row == null ? JSONObject.NULL : user)
                        .put("started_at", row == null ? JSONObject.NULL : row.get("started_at"))
                        .put("ended_at", row == null ? JSONObject.NULL : row.get("ended_at"));
            } else if (path.endsWith("samples/batch")) {
                batches++;
                if (batches == failBatchNumber) {
                    status = 401;
                    reply.put("detail", "Could not validate credentials");
                } else {
                    JSONArray samples = body.getJSONArray("samples");
                    int saved = 0, duplicates = 0;
                    for (int i = 0; i < samples.length(); i++)
                        if (accepted.add(samples.getJSONObject(i).getString("id"))) saved++;
                        else duplicates++;
                    reply.put("accepted_samples", badCounts ? 0 : saved)
                            .put("duplicate_samples", duplicates)
                            .put("filtered_samples", 0)
                            .put("discarded_samples", 0)
                            .put("session_ended_at", row.get("ended_at"));
                    if (loseBatchReply) reply = new JSONObject();
                }
            } else if (method.equals("POST")) {
                status = row == null ? 201 : 200;
                if (row == null) {
                    row =
                            new JSONObject()
                                    .put("id", id)
                                    .put("recorded_by_user_id", user)
                                    .put("started_at", body.get("started_at"))
                                    .put("ended_at", body.opt("ended_at"));
                    rows.put(id, row);
                }
                reply = loseCreateReply ? new JSONObject() : row;
            } else if (method.equals("PATCH")) {
                if (rejectEnd) {
                    status = 401;
                    reply.put("detail", "Could not validate credentials");
                } else {
                    row.put("ended_at", body.get("ended_at"));
                    reply = loseEndReply ? new JSONObject() : row;
                }
            }
            byte[] bytes = reply.toString().getBytes(StandardCharsets.UTF_8);
            OutputStream output = client.getOutputStream();
            output.write(
                    ("HTTP/1.1 "
                                    + status
                                    + " Test\r\nContent-Type: application/json\r\nContent-Length: "
                                    + bytes.length
                                    + "\r\nConnection: close\r\n\r\n")
                            .getBytes(StandardCharsets.UTF_8));
            output.write(bytes);
            output.flush();
        }

        public void close() throws Exception {
            socket.close();
            executor.shutdownNow();
            executor.awaitTermination(5, TimeUnit.SECONDS);
        }
    }
}
