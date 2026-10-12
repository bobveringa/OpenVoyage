package app.openvoyage;

import android.content.Context;
import android.util.Log;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.File;
import java.io.FileOutputStream;
import java.io.FileReader;
import java.io.IOException;
import java.io.OutputStreamWriter;
import java.io.Writer;
import java.nio.charset.StandardCharsets;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

/**
 * Durable, bounded FIFO of position fixes that the webview has not consumed
 * yet.
 *
 * <p>The webview is not a reliable consumer: it is reloaded by pull-to-refresh,
 * restarted when the renderer is evicted, and destroyed entirely when the
 * process is killed while the foreground service keeps recording. Handing a fix
 * straight to JS and forgetting it therefore loses points. Every fix is instead
 * appended here first and only removed after JS acknowledges processing it.
 *
 * <p>Appends are a single line write; the whole file is only rewritten when the
 * buffer overflows or acknowledged fixes are removed.
 */
final class TrackingFixBuffer {

    private static final String TAG = "OVTrackingBuffer";
    private static final String FILE_NAME = "tracking-fix-buffer.jsonl";

    /** About 5.8 days at the optional 10 s detail setting. */
    private static final int MAX_FIXES = 50_000;
    // Trimming a batch avoids rewriting the whole file after every later fix.
    private static final int TRIM_TO_FIXES = 45_000;
    private static TrackingFixBuffer instance;

    private final File file;
    private final ArrayDeque<String> lines = new ArrayDeque<>();
    private int droppedCount = 0;

    static synchronized TrackingFixBuffer get(Context context) {
        if (instance == null) {
            instance = new TrackingFixBuffer(context.getApplicationContext());
        }
        return instance;
    }

    private TrackingFixBuffer(Context context) {
        this.file = new File(context.getFilesDir(), FILE_NAME);
        load();
    }

    private void load() {
        if (!file.exists()) {
            return;
        }
        boolean migrated = false;
        try (BufferedReader reader = new BufferedReader(new FileReader(file))) {
            String line;
            while ((line = reader.readLine()) != null) {
                if (!line.isEmpty()) {
                    try {
                        JSONObject fix = new JSONObject(line);
                        if (!fix.has("nativeId")) {
                            fix.put("nativeId", UUID.randomUUID().toString());
                            line = fix.toString();
                            migrated = true;
                        }
                        lines.addLast(line);
                    } catch (JSONException exception) {
                        Log.e(TAG, "Discarding unparseable buffered fix", exception);
                        migrated = true;
                    }
                }
            }
        } catch (IOException exception) {
            Log.e(TAG, "Could not read buffered fixes", exception);
        }
        if (lines.size() > MAX_FIXES) {
            trimTo(TRIM_TO_FIXES);
            migrated = true;
        }
        if (migrated) {
            rewrite();
        }
    }

    synchronized void append(JSONObject fix) {
        try {
            if (!fix.has("nativeId")) {
                fix.put("nativeId", UUID.randomUUID().toString());
            }
        } catch (JSONException exception) {
            Log.e(TAG, "Could not assign fix ID", exception);
            return;
        }
        String line = fix.toString();
        lines.addLast(line);
        if (lines.size() > MAX_FIXES) {
            trimTo(TRIM_TO_FIXES);
            rewrite();
            return;
        }
        try (Writer writer = new OutputStreamWriter(
                new FileOutputStream(file, true),
                StandardCharsets.UTF_8
        )) {
            writer.write(line);
            writer.write("\n");
        } catch (IOException exception) {
            Log.e(TAG, "Could not persist fix", exception);
        }
    }

    /** Keep each cross-process reply below Android's Binder transaction limit. */
    synchronized JSONArray peek(int maxFixes) {
        JSONArray result = new JSONArray();
        int count = Math.min(Math.max(maxFixes, 0), lines.size());
        int index = 0;
        for (String line : lines) {
            if (index++ >= count) {
                break;
            }
            try {
                result.put(new JSONObject(line));
            } catch (JSONException exception) {
                Log.e(TAG, "Could not parse buffered fix", exception);
                break;
            }
        }
        return result;
    }

    /** Removes the processed prefix, identified by its final stable ID. */
    synchronized boolean acknowledge(String lastNativeId) {
        if (lastNativeId == null || lastNativeId.isEmpty()) {
            return false;
        }
        int count = 0;
        boolean found = false;
        for (String line : lines) {
            count++;
            try {
                if (lastNativeId.equals(new JSONObject(line).optString("nativeId"))) {
                    found = true;
                    break;
                }
            } catch (JSONException exception) {
                return false;
            }
        }
        if (!found) {
            return false;
        }
        for (int index = 0; index < count; index++) {
            lines.removeFirst();
        }
        if (lines.isEmpty()) {
            if (file.exists() && !file.delete()) {
                rewrite();
            }
        } else {
            rewrite();
        }
        return true;
    }

    synchronized void acknowledgeDroppedCount(int handledCount) {
        droppedCount = Math.max(0, droppedCount - Math.max(0, handledCount));
    }

    synchronized int size() {
        return lines.size();
    }

    /** Fixes lost to overflow since the last acknowledgement. */
    synchronized int getDroppedCount() {
        return droppedCount;
    }

    private void trimTo(int size) {
        while (lines.size() > size) {
            lines.removeFirst();
            droppedCount += 1;
        }
    }

    private void rewrite() {
        List<String> snapshot = new ArrayList<>(lines);
        try (Writer writer = new OutputStreamWriter(
                new FileOutputStream(file, false),
                StandardCharsets.UTF_8
        )) {
            for (String line : snapshot) {
                writer.write(line);
                writer.write("\n");
            }
        } catch (IOException exception) {
            Log.e(TAG, "Could not rewrite fix buffer", exception);
        }
    }
}
