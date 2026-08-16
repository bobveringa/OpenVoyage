package app.openvoyage;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(TrackingOnboardingPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
