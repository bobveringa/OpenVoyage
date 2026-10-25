package app.openvoyage;

import android.content.Context;

import androidx.concurrent.futures.CallbackToFutureAdapter;
import androidx.work.WorkerParameters;
import androidx.work.multiprocess.RemoteListenableWorker;

import com.google.common.util.concurrent.ListenableFuture;

public final class TrackingUploadWorker extends RemoteListenableWorker {
    public TrackingUploadWorker(Context context, WorkerParameters params) {
        super(context, params);
    }

    @Override
    public ListenableFuture<Result> startRemoteWork() {
        return CallbackToFutureAdapter.getFuture(
                completer -> {
                    java.util.concurrent.atomic.AtomicReference<Thread> owner =
                            new java.util.concurrent.atomic.AtomicReference<>();
                    java.util.concurrent.Future<?> task =
                            TrackingSync.EXECUTOR.submit(
                                    () -> {
                                        owner.set(Thread.currentThread());
                                        try {
                                            String id = getInputData().getString("sessionId");
                                            boolean manual = getInputData().getBoolean("manual", false);
                                            boolean retry = TrackingSync.run(getApplicationContext(), id,
                                                    manual && getRunAttemptCount() == 0);
                                            if (manual) {
                                                // Any later attempt must use the normal Wi-Fi policy.
                                                org.json.JSONObject session = TrackingStore.get(getApplicationContext()).session(id);
                                                if (retry && session != null)
                                                    TrackingSync.schedule(getApplicationContext(), session, true);
                                                completer.set(Result.success());
                                            } else completer.set(retry ? Result.retry() : Result.success());
                                        } catch (Exception e) {
                                            completer.set(Result.retry());
                                        } finally {
                                            if (getInputData().getBoolean("manual", false))
                                                TrackingSync.finishManual(getInputData().getString("sessionId"));
                                            owner.set(null);
                                        }
                                    });
                    completer.addCancellationListener(
                            () -> {
                                task.cancel(true);
                                TrackingSync.cancelRequest(owner.get());
                            },
                            Runnable::run);
                    return "tracking-upload";
                });
    }
}
