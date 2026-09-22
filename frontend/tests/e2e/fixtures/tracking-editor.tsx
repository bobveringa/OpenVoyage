import { createRoot } from 'react-dom/client'
import { TrackingManagementPanel } from '../../../src/components/trips/tracking-management-dialog'
import { AuthContext } from '../../../src/auth/auth-context'
import { PublicSettingsContext } from '../../../src/settings/public-settings-context'
import '../../../src/index.css'

const user = { id: 'owner', role: 'ADMIN' }
createRoot(document.getElementById('root')!).render(
  <AuthContext.Provider
    value={
      {
        accessToken: 'fixture',
        currentUser: user,
        status: 'authenticated',
      } as never
    }
  >
    <PublicSettingsContext.Provider
      value={{ settings: {}, refresh: async () => true }}
    >
      <main className="mx-auto max-w-3xl p-4">
        <h1 className="mb-4 text-2xl font-semibold">GPS &amp; Location</h1>
        <TrackingManagementPanel
          accessToken="fixture"
          canManageLiveSharing
          tripId="trip"
          tripTitle="Test trip"
          onTrackingChanged={() => {}}
        />
      </main>
    </PublicSettingsContext.Provider>
  </AuthContext.Provider>,
)
