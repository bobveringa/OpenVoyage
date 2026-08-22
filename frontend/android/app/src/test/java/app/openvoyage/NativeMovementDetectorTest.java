package app.openvoyage;

import static org.junit.Assert.assertEquals;

import org.junit.Test;

public class NativeMovementDetectorTest {

    @Test
    public void becomesStationaryAfterDwell() {
        NativeMovementDetector detector = new NativeMovementDetector();
        detector.observe(51.4416, 5.4697, 5f, true, 0, false, 0L);
        detector.observe(51.4416, 5.4697, 5f, true, 0, false, 90_000L);

        assertEquals(NativeMovementDetector.State.STATIONARY, detector.getState());
    }

    @Test
    public void clearlyMovingSpeedLeavesStationaryStateImmediately() {
        NativeMovementDetector detector = new NativeMovementDetector();
        detector.observe(51.4416, 5.4697, 5f, true, 0, false, 0L);
        detector.observe(51.4416, 5.4697, 5f, true, 0, false, 90_000L);
        detector.observe(51.44161, 5.4697, 5f, true, 3.0, true, 91_000L);

        assertEquals(NativeMovementDetector.State.MOVING, detector.getState());
    }

    @Test
    public void ignoresOutOfOrderLocations() {
        NativeMovementDetector detector = new NativeMovementDetector();
        detector.observe(51.4416, 5.4697, 5f, true, 3.0, true, 10_000L);
        detector.observe(51.4416, 5.4697, 5f, true, 0, false, 9_000L);

        assertEquals(NativeMovementDetector.State.UNKNOWN, detector.getState());
    }
}
