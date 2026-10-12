package app.openvoyage;

import static org.junit.Assert.assertEquals;

import org.junit.Test;

public class SparseTrackingProfileTest {
    @Test
    public void sparseProfilesMatchObservedIntervalsAndLookupCadence() {
        long[] request = {60 * 60_000L, 15 * 60_000L, 10 * 60_000L, 6 * 60_000L};
        long[] lookup = {8 * 60 * 60_000L, 2 * 60 * 60_000L,
                20 * 60_000L, 20 * 60_000L};
        for (int level = 1; level <= 4; level++) {
            SparseTrackingProfile profile = SparseTrackingProfile.forLevel(level);
            assertEquals(request[level - 1], profile.intervalMs);
            assertEquals(lookup[level - 1], profile.lookupIntervalMs);
        }
    }

    @Test
    public void detailExtensionRetainsTenSecondInterval() {
        SparseTrackingProfile profile = SparseTrackingProfile.forLevel(5);
        assertEquals(10_000L, profile.intervalMs);
        assertEquals(0f, profile.distanceMeters, 0f);
    }
}
