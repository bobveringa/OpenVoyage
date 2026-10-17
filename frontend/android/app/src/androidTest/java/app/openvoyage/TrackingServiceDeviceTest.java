package app.openvoyage;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotEquals;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertTrue;
import static org.junit.Assume.assumeFalse;

import android.Manifest;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.os.Binder;
import android.os.Bundle;
import android.os.Process;

import androidx.core.content.ContextCompat;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;

import org.json.JSONObject;
import org.junit.Test;
import org.junit.runner.RunWith;

import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;

/** Exercises the real location engine selection and service lifetime on devices. */
@RunWith(AndroidJUnit4.class)
public class TrackingServiceDeviceTest {
    @Test
    public void smartRecordingStartsWithAvailableEngineAndStops() throws Exception {
        Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        // Never disturb a user recording left running on a test device.
        assumeFalse(state(context).getBoolean("trackingIntent", false));
        String sessionId = UUID.randomUUID().toString();
        String userId = UUID.randomUUID().toString();
        recording(context, new JSONObject().put("op", "identity").put("userId", userId));
        recording(
                context,
                new JSONObject()
                        .put("op", "begin")
                        .put("userId", userId)
                        .put("sessionId", sessionId)
                        .put("tripId", UUID.randomUUID().toString())
                        .put("apiBaseUrl", "http://127.0.0.1:1"));
        InstrumentationRegistry.getInstrumentation()
                .getUiAutomation()
                .grantRuntimePermission(
                        context.getPackageName(), Manifest.permission.ACCESS_COARSE_LOCATION);
        InstrumentationRegistry.getInstrumentation()
                .getUiAutomation()
                .grantRuntimePermission(
                        context.getPackageName(), Manifest.permission.ACCESS_FINE_LOCATION);
        InstrumentationRegistry.getInstrumentation()
                .getUiAutomation()
                .grantRuntimePermission(
                        context.getPackageName(), Manifest.permission.ACCESS_BACKGROUND_LOCATION);
        InstrumentationRegistry.getInstrumentation()
                .getUiAutomation()
                .grantRuntimePermission(
                        context.getPackageName(), Manifest.permission.POST_NOTIFICATIONS);

        Intent start =
                new Intent(context, TrackingService.class)
                        .setAction(TrackingService.ACTION_START)
                        .putExtra(TrackingService.EXTRA_INTERVAL_MS, 600_000L)
                        .putExtra(TrackingService.EXTRA_MIN_INTERVAL_MS, 600_000L)
                        .putExtra(TrackingService.EXTRA_DISTANCE_FILTER_M, 150f)
                        .putExtra(TrackingService.EXTRA_POWER_LEVEL, "balanced")
                        .putExtra(TrackingService.EXTRA_BASELINE_INTERVAL_MS, 600_000L)
                        .putExtra(TrackingService.EXTRA_BASELINE_POWER_LEVEL, "balanced")
                        .putExtra(TrackingService.EXTRA_TRACKING_MODE, "smart")
                        .putExtra(TrackingService.EXTRA_SMART_PRECISION, 3)
                        .putExtra(
                                TrackingService.EXTRA_LOCATION_SOURCE, TrackingService.SOURCE_AUTO);
        CountDownLatch stopEvent = new CountDownLatch(1);
        BroadcastReceiver receiver =
                new BroadcastReceiver() {
                    @Override
                    public void onReceive(Context ignored, Intent event) {
                        if (TrackingIpcProvider.EVENT_STOP.equals(
                                event.getStringExtra(TrackingIpcProvider.EXTRA_EVENT))) {
                            stopEvent.countDown();
                        }
                    }
                };
        ContextCompat.registerReceiver(
                context,
                receiver,
                new IntentFilter(TrackingIpcProvider.ACTION_EVENT),
                ContextCompat.RECEIVER_NOT_EXPORTED);
        Bundle client = new Bundle();
        client.putString(TrackingIpcProvider.EXTRA_CLIENT_ID, UUID.randomUUID().toString());
        client.putBinder(TrackingIpcProvider.EXTRA_CLIENT_BINDER, new Binder());
        context.getContentResolver()
                .call(
                        TrackingIpcProvider.uri(context),
                        TrackingIpcProvider.METHOD_ATTACH,
                        null,
                        client);
        try {
            ContextCompat.startForegroundService(context, start);
            Bundle running = null;
            for (int attempt = 0; attempt < 50; attempt++) {
                running = state(context);
                if (running.getBoolean("tracking") && !"none".equals(running.getString("engine"))) {
                    break;
                }
                Thread.sleep(100);
            }
            assertNotNull(running);
            assertTrue(running.getBoolean("tracking"));
            assertEquals(
                    FusedLocationEngine.isAvailable(context) ? "gms" : "platform",
                    running.getString("engine"));
            assertEquals(600.0, running.getDouble("intervalSeconds"), 0.0);
            assertNotEquals(Process.myPid(), running.getInt("processId"));
            context.startService(
                    new Intent(context, TrackingService.class)
                            .setAction(TrackingService.ACTION_STOP_FROM_NOTIFICATION));
            assertTrue(
                    "Stop event did not cross process boundary",
                    stopEvent.await(5, TimeUnit.SECONDS));
        } finally {
            if (state(context).getBoolean("trackingIntent", false)) {
                context.startService(
                        new Intent(context, TrackingService.class)
                                .setAction(TrackingService.ACTION_STOP));
            }
            context.getContentResolver()
                    .call(
                            TrackingIpcProvider.uri(context),
                            TrackingIpcProvider.METHOD_DETACH,
                            null,
                            client);
            context.unregisterReceiver(receiver);
        }
        for (int attempt = 0;
                attempt < 50 && state(context).getBoolean("trackingIntent", false);
                attempt++) {
            Thread.sleep(100);
        }
        assertFalse(state(context).getBoolean("trackingIntent", false));
        assertEquals("notification", state(context).getString("stopReason"));
        assertTrue(state(context).getLong("stopAtMs") > 0);
        Bundle stopped = recording(context, new JSONObject().put("op", "snapshot"));
        org.json.JSONArray sessions = new org.json.JSONArray(stopped.getString("sessions"));
        boolean found = false;
        for (int i = 0; i < sessions.length(); i++) {
            JSONObject session = sessions.getJSONObject(i);
            if (sessionId.equals(session.getString("sessionId"))) {
                assertFalse(
                        "Notification Stop must durably end the recording",
                        session.isNull("endedAt"));
                found = true;
            }
        }
        assertTrue(found);
        String nextId = UUID.randomUUID().toString();
        recording(
                context,
                new JSONObject()
                        .put("op", "begin")
                        .put("userId", userId)
                        .put("sessionId", nextId)
                        .put("tripId", UUID.randomUUID().toString())
                        .put("apiBaseUrl", "http://127.0.0.1:1"));
        ContextCompat.startForegroundService(context, start);
        for (int attempt = 0; attempt < 50 && !state(context).getBoolean("tracking"); attempt++)
            Thread.sleep(100);
        assertTrue(state(context).getBoolean("tracking"));
        recording(
                context,
                new JSONObject().put("op", "identity").put("userId", userId).put("signedIn", true));
        assertTrue(
                "Signing in as the recorder stopped capture",
                state(context).getBoolean("tracking"));
        recording(context, new JSONObject().put("op", "stop").put("sessionId", sessionId));
        assertTrue(
                "A delayed Stop for the old session stopped the new recording",
                state(context).getBoolean("tracking"));
        recording(context, new JSONObject().put("op", "stop").put("sessionId", nextId));
        assertFalse(
                "Stop was acknowledged before native capture ended",
                state(context).getBoolean("tracking"));
        recording(context, new JSONObject().put("op", "identity").put("userId", ""));
        // Remove only this test's stopped local recording. Capture is now off.
        try (android.database.sqlite.SQLiteDatabase db =
                android.database.sqlite.SQLiteDatabase.openDatabase(
                        context.getDatabasePath("tracking-native.db").getPath(), null, 0)) {
            db.delete("samples", "session=?", new String[] {sessionId});
            db.delete("sessions", "id=?", new String[] {sessionId});
            db.delete("samples", "session=?", new String[] {nextId});
            db.delete("sessions", "id=?", new String[] {nextId});
        }
    }

    private static Bundle recording(Context context, JSONObject command) {
        Bundle input = new Bundle();
        input.putString("payload", command.toString());
        return context.getContentResolver()
                .call(TrackingIpcProvider.uri(context), "recording", null, input);
    }

    private static Bundle state(Context context) {
        Bundle result =
                context.getContentResolver()
                        .call(
                                TrackingIpcProvider.uri(context),
                                TrackingIpcProvider.METHOD_STATE,
                                null,
                                null);
        assertNotNull(result);
        return result;
    }
}
