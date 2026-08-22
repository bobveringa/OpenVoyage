package app.openvoyage;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public class NativeAdaptivePolicyTest {

    private NativeAdaptivePolicy.Input input(
            NativeAdaptivePolicy.Mode mode,
            NativeMovementDetector.State movement,
            Double speedMps,
            Double batteryLevel,
            boolean charging,
            boolean powerSaveMode,
            boolean coarseLocationAvailable
    ) {
        return new NativeAdaptivePolicy.Input(
                mode,
                60_000L,
                LocationEngine.Power.HIGH,
                40f,
                movement,
                speedMps,
                batteryLevel,
                charging,
                powerSaveMode,
                coarseLocationAvailable
        );
    }

    @Test
    public void manualModeKeepsItsExactBaseline() {
        NativeAdaptivePolicy.Decision decision = NativeAdaptivePolicy.decide(
                input(
                        NativeAdaptivePolicy.Mode.MANUAL,
                        NativeMovementDetector.State.STATIONARY,
                        null,
                        0.01,
                        false,
                        true,
                        true
                )
        );

        assertEquals(60_000L, decision.intervalMs);
        assertEquals(LocationEngine.Power.HIGH, decision.power);
        assertEquals(40f, decision.distanceFilterMeters, 0f);
    }

    @Test
    public void stationarySmartModeStretchesTheCadence() {
        NativeAdaptivePolicy.Decision decision = NativeAdaptivePolicy.decide(
                input(
                        NativeAdaptivePolicy.Mode.SMART,
                        NativeMovementDetector.State.STATIONARY,
                        null,
                        null,
                        false,
                        false,
                        true
                )
        );

        assertEquals(300_000L, decision.intervalMs);
        assertEquals(NativeAdaptivePolicy.Reason.STATIONARY, decision.reason);
        assertEquals(0f, decision.distanceFilterMeters, 0f);
    }

    @Test
    public void movingSmartModeDensifiesWithinTheFloor() {
        NativeAdaptivePolicy.Decision decision = NativeAdaptivePolicy.decide(
                input(
                        NativeAdaptivePolicy.Mode.SMART,
                        NativeMovementDetector.State.MOVING,
                        14.0,
                        null,
                        false,
                        false,
                        true
                )
        );

        assertEquals(15_000L, decision.intervalMs);
        assertEquals(NativeAdaptivePolicy.Reason.MOVING, decision.reason);
    }

    @Test
    public void criticalBatteryStretchesButDoesNotSilenceBareAosp() {
        NativeAdaptivePolicy.Decision decision = NativeAdaptivePolicy.decide(
                input(
                        NativeAdaptivePolicy.Mode.SMART,
                        NativeMovementDetector.State.UNKNOWN,
                        null,
                        0.05,
                        false,
                        false,
                        false
                )
        );

        assertEquals(240_000L, decision.intervalMs);
        assertEquals(LocationEngine.Power.HIGH, decision.power);
        assertEquals(NativeAdaptivePolicy.Reason.BATTERY_CRITICAL, decision.reason);
    }

    @Test
    public void meaningfulChangeFiltersSmallCadenceDrift() {
        NativeAdaptivePolicy.Decision first = new NativeAdaptivePolicy.Decision(
                60_000L, LocationEngine.Power.HIGH, 0f, NativeAdaptivePolicy.Reason.FIXED
        );
        NativeAdaptivePolicy.Decision small = new NativeAdaptivePolicy.Decision(
                70_000L, LocationEngine.Power.HIGH, 0f, NativeAdaptivePolicy.Reason.MOVING
        );
        NativeAdaptivePolicy.Decision large = new NativeAdaptivePolicy.Decision(
                80_000L, LocationEngine.Power.HIGH, 0f, NativeAdaptivePolicy.Reason.MOVING
        );

        assertFalse(NativeAdaptivePolicy.isMeaningfulChange(first, small));
        assertTrue(NativeAdaptivePolicy.isMeaningfulChange(first, large));
    }
}
