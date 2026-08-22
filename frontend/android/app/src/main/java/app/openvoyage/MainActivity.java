package app.openvoyage;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(TrackingOnboardingPlugin.class);
        registerPlugin(TrackingPlugin.class);
        super.onCreate(savedInstanceState);
        getBridge().setWebViewClient(new SpaFallbackWebViewClient(getBridge()));
    }
}
