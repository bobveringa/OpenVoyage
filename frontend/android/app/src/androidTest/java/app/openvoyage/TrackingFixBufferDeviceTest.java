package app.openvoyage;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNotEquals;
import static org.junit.Assert.assertTrue;

import android.content.Context;
import android.content.ContextWrapper;

import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;

import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;
import org.junit.runner.RunWith;

import java.io.File;
import java.io.FileOutputStream;
import java.lang.reflect.Constructor;
import java.nio.charset.StandardCharsets;
import java.util.UUID;

/** Verifies replay and prefix acknowledgement across a tracker-process restart. */
@RunWith(AndroidJUnit4.class)
public class TrackingFixBufferDeviceTest {
    @Test
    public void fixesSurvivePeekUntilAcknowledged() throws Exception {
        Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        File directory = new File(context.getCacheDir(), "tracking-buffer-test-" + UUID.randomUUID());
        assertTrue(directory.mkdirs());
        Context isolated = new ContextWrapper(context) {
            @Override public File getFilesDir() { return directory; }
        };
        Constructor<TrackingFixBuffer> constructor = TrackingFixBuffer.class
                .getDeclaredConstructor(Context.class);
        constructor.setAccessible(true);
        try {
            TrackingFixBuffer original = constructor.newInstance(isolated);
            original.append(new JSONObject().put("time", 1L));
            original.append(new JSONObject().put("time", 2L));
            JSONArray beforeRestart = original.peek(10);
            assertEquals(2, beforeRestart.length());
            String firstId = beforeRestart.getJSONObject(0).getString("nativeId");
            String secondId = beforeRestart.getJSONObject(1).getString("nativeId");
            assertNotEquals(firstId, secondId);

            // Reopening the file models a process death after JS received a
            // batch but before its SQLite write or acknowledgement completed.
            TrackingFixBuffer restarted = constructor.newInstance(isolated);
            assertEquals(firstId, restarted.peek(10).getJSONObject(0).getString("nativeId"));
            assertTrue(restarted.acknowledge(firstId));
            assertEquals(secondId, restarted.peek(10).getJSONObject(0).getString("nativeId"));
            assertEquals(1, restarted.size());
            assertTrue(restarted.acknowledge(secondId));
            assertEquals(0, restarted.size());

            // Buffers written by the previous app version have no ID. A
            // migration must give each old fix one stable ID on disk.
            File oldBuffer = new File(directory, "tracking-fix-buffer.jsonl");
            try (FileOutputStream output = new FileOutputStream(oldBuffer)) {
                output.write("{\"time\":3}\n".getBytes(StandardCharsets.UTF_8));
            }
            TrackingFixBuffer migrated = constructor.newInstance(isolated);
            String migratedId = migrated.peek(10).getJSONObject(0).getString("nativeId");
            assertEquals(migratedId, constructor.newInstance(isolated)
                    .peek(10).getJSONObject(0).getString("nativeId"));
        } finally {
            File bufferFile = new File(directory, "tracking-fix-buffer.jsonl");
            if (bufferFile.exists()) {
                assertTrue(bufferFile.delete());
            }
            assertTrue(directory.delete());
        }
    }
}
