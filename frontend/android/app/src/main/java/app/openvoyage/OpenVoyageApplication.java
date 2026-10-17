package app.openvoyage;

import android.app.Application;

import androidx.annotation.NonNull;
import androidx.work.Configuration;

/** Enables WorkManager's client in :tracker; scheduling stays in the default process. */
public final class OpenVoyageApplication extends Application implements Configuration.Provider {
    @NonNull
    @Override
    public Configuration getWorkManagerConfiguration() {
        return new Configuration.Builder().setDefaultProcessName(getPackageName()).build();
    }
}
