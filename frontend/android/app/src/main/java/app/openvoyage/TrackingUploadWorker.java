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
                                            completer.set(
                                                    TrackingSync.run(
                                                                    getApplicationContext(),
                                                                    getInputData()
                                                                            .getString("sessionId"))
                                                            ? Result.retry()
                                                            : Result.success());
                                        } catch (Exception e) {
                                            completer.set(Result.retry());
                                        } finally {
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
