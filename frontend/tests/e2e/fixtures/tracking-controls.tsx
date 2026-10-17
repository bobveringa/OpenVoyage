import { ClockFormatProvider } from '../../../src/components/clock-format-provider'
import { Capacitor } from '@capacitor/core'
import { lazy, Suspense, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { AuthContext } from '../../../src/auth/auth-context'
import { TrackingManagementPanel } from '../../../src/components/trips/tracking-management-dialog'
import { ActiveTrackingPage } from '../../../src/pages/active-tracking-page'
import { TripManagementDialog } from '../../../src/pages/trip-detail/management-ui'
import type { TripManagementSection } from '../../../src/pages/trip-detail/url-state'
import {
  TrackingContext,
  type ActiveTrackingSession,
  type TrackingContextValue,
} from '../../../src/tracking/tracking-context'
import type { TravelMode } from '../../../src/api/client'
import { PublicSettingsContext } from '../../../src/settings/public-settings-context'
import '../../../src/index.css'

// Exercise the native controls without starting a real location service.
Capacitor.isNativePlatform = () => true
const AccountSettingsPage = lazy(async () => ({
  default: (await import('../../../src/pages/account-settings-page'))
    .AccountSettingsPage,
}))
const params = new URLSearchParams(location.search)
if (params.has('dark')) document.documentElement.classList.add('dark')
const initialSession: ActiveTrackingSession = {
  sessionId: 'local-session',
  tripId: params.has('other') ? 'other-trip' : 'trip',
  tripTitle: 'A weekend along the coast',
  startedAt: new Date(Date.now() - 3_725_000).toISOString(),
  endedAt: null,
}

export function Preview() {
  const [session, setSession] = useState<ActiveTrackingSession | null>(
    params.has('active') ? initialSession : null,
  )
  const [mode, setMode] = useState<TravelMode>('UNKNOWN')
  const [startupFeedback, setStartupFeedback] = useState<TrackingContextValue['startupFeedback']>(null)
  useEffect(() => {
    const acquireFix = () => setStartupFeedback((feedback) =>
      feedback && feedback.locationFoundAt === null
        ? { locationFoundAt: Date.now() } : feedback,
    )
    window.addEventListener('test-gps-fix', acquireFix)
    return () => window.removeEventListener('test-gps-fix', acquireFix)
  }, [])
  const [navigated, setNavigated] = useState('')
  const [path, setPath] = useState(location.pathname)
  useEffect(() => {
    const update = () => setPath(location.pathname)
    window.addEventListener('popstate', update)
    return () => window.removeEventListener('popstate', update)
  }, [])
  const navigate = (to: string) => {
    window.history.pushState(null, '', to)
    window.dispatchEvent(new PopStateEvent('popstate'))
    setNavigated(to)
  }
  const [section, setSection] = useState<TripManagementSection>('gps')
  const controls = (
    <TrackingManagementPanel
      accessToken="fixture"
      canManageLiveSharing
      tripId="trip"
      tripTitle="A weekend along the coast"
      onTrackingChanged={() => {}}
    />
  )
  const tracking: TrackingContextValue = {
    activeSession: session,
    status: session ? (session.endedAt ? 'syncing' : 'recording') : 'idle',
    error: null,
    startupFeedback,
    adaptiveDecision: null,
    locationWarning: params.has('warning')
      ? 'Waiting for a GPS signal. Recording is still running.'
      : null,
    clockSkewWarningSeconds: null,
    clockSkewNoticeSeconds: null,
    currentTravelMode: mode,
    queueStats: {
      sampleCount: 12,
      oldestSampleAt: null,
      droppedLocallyCount: 0,
      simulatedRejectedCount: 0,
    },
    uploaderSnapshot: {
      status: 'waiting-retry',
      queueDepth: 12,
      lastSyncAt: null,
      lastErrorMessage: null,
      discardedCount: 0,
      filteredCount: 2,
    },
    startTracking: async () => {
      setStartupFeedback({ locationFoundAt: null })
      setSession(initialSession)
    },
    stopTracking: async () =>
      setSession((current) =>
        current ? { ...current, endedAt: new Date().toISOString() } : null,
      ),
    setTravelMode: async (value) => setMode(value),
    notifySettingsChanged: () => {},
  }
  return (
    <AuthContext.Provider
      value={
        {
          accessToken: 'fixture',
          currentUser: { id: 'owner', role: 'ADMIN' },
          status: 'authenticated',
        } as never
      }
    >
      <TrackingContext.Provider value={tracking}>
        <PublicSettingsContext.Provider
          value={{ settings: {}, refresh: async () => true }}
        >
          <main className="mx-auto max-w-xl p-4">
            {path === '/settings' ? (
              <Suspense fallback={<p>Loading settings…</p>}>
                <AccountSettingsPage
                  accessToken="fixture"
                  authStatus="authenticated"
                  currentUser={{ id: 'owner', role: 'ADMIN' } as never}
                  onNavigate={navigate}
                  onProfileUpdated={() => {}}
                />
              </Suspense>
            ) : params.has('page') ? (
              <ActiveTrackingPage onNavigate={navigate} />
            ) : params.has('modal') ? (
              <TripManagementDialog
                open
                accessToken="fixture"
                canManageTrip
                canManageLiveSharing
                immichEnabled={false}
                error={null}
                isSaving={false}
                members={[]}
                viewers={[]}
                shareLinks={[]}
                tripId="trip"
                trip={{
                  id: 'trip',
                  name: 'A weekend along the coast',
                  description: '',
                  startDate: '2026-10-13',
                  endDate: '2026-10-14',
                  visibility: 'PRIVATE',
                }}
                section={section}
                onSectionChange={setSection}
                onClose={() => setNavigated('/trips/trip')}
                onCreateLink={() => {}}
                onDeleteLink={() => {}}
                onDeleteTrip={() => {}}
                onInviteMember={() => {}}
                onInviteViewer={() => {}}
                onRemoveMember={() => {}}
                onRemoveViewer={() => {}}
                onRevokeLink={() => {}}
                onRestoreLink={() => {}}
                onUpdateLink={() => {}}
                onSaveSettings={() => {}}
                onTrackingChanged={() => {}}
                onUpdateMemberRole={() => {}}
              />
            ) : (
              <>
                <h1 className="mb-5 text-xl font-semibold">
                  GPS &amp; Location
                </h1>
                {controls}
              </>
            )}
            {navigated && <p role="status">Navigated to {navigated}</p>}
          </main>
        </PublicSettingsContext.Provider>
      </TrackingContext.Provider>
    </AuthContext.Provider>
  )
}
createRoot(document.getElementById('root')!).render(<ClockFormatProvider><Preview /></ClockFormatProvider>)
