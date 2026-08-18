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

/**
 * Durable, bounded FIFO of position fixes that the webview has not consumed
 * yet.
 *
 * <p>The webview is not a reliable consumer: it is reloaded by pull-to-refresh,
 * restarted when the renderer is evicted, and destroyed entirely when the
 * process is killed while the foreground service keeps recording. Handing a fix
 * straight to JS and forgetting it therefore loses points. Every fix is instead
 * appended here first and only removed once JS has actually drained it, so a
 * reload costs nothing and a process kill costs at most the fixes that had
 * already been drained but not yet written to the JS-side SQLite queue.
 *
 * <p>Appends are a single line write; the whole file is only rewritten when the
 * buffer overflows or is drained, which keeps a 1 Hz fix stream cheap.
 */
final class TrackingFixBuffer {

    private static final String TAG = "OVTrackingBuffer";
    private static final String FILE_NAME = "tracking-fix-buffer.jsonl";

    /**
     * Roughly 1.5 days of 30 s fixes, or 80 minutes at the 1 Hz worst case.
     * Past this the oldest fixes are dropped: an unbounded buffer would be a
     * slow memory/disk leak for a user who records for days without ever
     * reopening the app.
     */
    private static final int MAX_FIXES = 5000;

    private final File file;
    private final ArrayDeque<String> lines = new ArrayDeque<>();
    private int droppedCount = 0;

    TrackingFixBuffer(Context context) {
        this.file = new File(context.getFilesDir(), FILE_NAME);
        load();
    }

    private void load() {
        if (!file.exists()) {
            return;
        }
        try (BufferedReader reader = new BufferedReader(new FileReader(file))) {
            String line;
            while ((line = reader.readLine()) != null) {
                if (!line.isEmpty()) {
                    lines.addLast(line);
                }
            }
        } catch (IOException exception) {
            Log.e(TAG, "Could not read buffered fixes", exception);
        }
        trim();
    }

    synchronized void append(JSONObject fix) {
        String line = fix.toString();
        lines.addLast(line);
        if (lines.size() > MAX_FIXES) {
            trim();
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

    /**
     * Hands every buffered fix to the caller and clears the buffer. Called when
     * JS has the fixes in hand; the JS side writes them to its own durable
     * queue before doing anything else with them.
     */
    synchronized JSONArray drain() {
        JSONArray result = new JSONArray();
        for (String line : lines) {
            try {
                result.put(new JSONObject(line));
            } catch (JSONException exception) {
                Log.e(TAG, "Discarding unparseable buffered fix", exception);
            }
        }
        lines.clear();
        droppedCount = 0;
        if (file.exists() && !file.delete()) {
            rewrite();
        }
        return result;
    }

    synchronized int size() {
        return lines.size();
    }

    /** Fixes lost to overflow since the last drain, for surfacing to the user. */
    synchronized int getDroppedCount() {
        return droppedCount;
    }

    private void trim() {
        while (lines.size() > MAX_FIXES) {
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
