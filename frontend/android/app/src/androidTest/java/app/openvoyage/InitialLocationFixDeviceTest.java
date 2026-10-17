package app.openvoyage;

import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertTrue;
import static org.junit.Assert.assertFalse;
import static org.junit.Assume.assumeFalse;
import static org.junit.Assume.assumeTrue;

import android.Manifest;
import android.content.Context;
import android.location.Location;
import android.os.Build;
import android.os.Bundle;
import android.os.SystemClock;

import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;

import org.junit.Test;
import org.junit.runner.RunWith;

import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;

/** Run on an emulator receiving GPS input (for example, adb emu geo fix). */
@RunWith(AndroidJUnit4.class)
public class InitialLocationFixDeviceTest {
    @Test
    public void platformLookupBypassesSparseCadenceAndCancelsOnStop() throws Exception {
        Context context = prepareEmulator();
        verifyLookup(new PlatformLocationEngine(context));
    }

    @Test
    public void fusedLookupBypassesPassiveCadenceAndCancelsOnStop() throws Exception {
        Context context = prepareEmulator();
        assumeTrue(FusedLocationEngine.isAvailable(context));
        verifyLookup(new FusedLocationEngine(context));
    }

    private Context prepareEmulator() {
        assumeTrue("Only run with emulator GPS input",
                Build.HARDWARE.contains("ranchu") || Build.HARDWARE.contains("goldfish"));
        Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        Bundle state = context.getContentResolver().call(TrackingIpcProvider.uri(context),
                TrackingIpcProvider.METHOD_STATE, null, null);
        assertNotNull(state);
        assumeFalse(state.getBoolean("trackingIntent", false));
        for (String permission : new String[] {
                Manifest.permission.ACCESS_COARSE_LOCATION,
                Manifest.permission.ACCESS_FINE_LOCATION }) {
            InstrumentationRegistry.getInstrumentation().getUiAutomation()
                    .grantRuntimePermission(context.getPackageName(), permission);
        }
        return context;
    }

    private void verifyLookup(LocationEngine engine) throws Exception {
        CountDownLatch found = new CountDownLatch(1);
        AtomicReference<Location> fix = new AtomicReference<>();
        AtomicReference<String> failure = new AtomicReference<>();
        long requestedAtNs = SystemClock.elapsedRealtimeNanos();
        LocationEngine.Callback ignore = new LocationEngine.Callback() {
            public void onLocation(Location location) {}
            public void onFailure(String message) { failure.set(message); }
        };
        try {
            InstrumentationRegistry.getInstrumentation().runOnMainSync(() -> {
                engine.start(new LocationEngine.Config(1_800_000L, 1_800_000L, 1_000f,
                        LocationEngine.Power.LOW, UUID.randomUUID().toString(), 1), ignore);
                engine.lookupCurrentLocation(new LocationEngine.Callback() {
                    public void onLocation(Location location) {
                        fix.set(location);
                        found.countDown();
                    }
                    public void onFailure(String message) {
                        failure.set(message);
                        found.countDown();
                    }
                }, 15_000L);
            });
            assertTrue("Lookup timed out: " + failure.get(), found.await(20, TimeUnit.SECONDS));
            assertNotNull("No fresh fix: " + failure.get(), fix.get());
            assertTrue("Lookup returned a cached fix",
                    fix.get().getElapsedRealtimeNanos() >= requestedAtNs);

            CountDownLatch cancelledCallback = new CountDownLatch(1);
            InstrumentationRegistry.getInstrumentation().runOnMainSync(() -> {
                engine.lookupCurrentLocation(new LocationEngine.Callback() {
                    public void onLocation(Location location) { cancelledCallback.countDown(); }
                    public void onFailure(String message) { cancelledCallback.countDown(); }
                }, 15_000L);
                engine.stop();
            });
            assertFalse("Stopped lookup delivered a callback",
                    cancelledCallback.await(2, TimeUnit.SECONDS));
        } finally {
            InstrumentationRegistry.getInstrumentation().runOnMainSync(engine::stop);
        }
    }
}
