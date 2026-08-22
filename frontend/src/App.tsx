import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react'

import { getSetupStatus } from '@/api/client'
import { AuthProvider } from '@/auth/auth-provider'
import { useAuth } from '@/auth/use-auth'
import { AppBackground } from '@/components/layout/app-background'
import { AppShell } from '@/components/layout/app-shell'
import { RouteErrorBoundary } from '@/components/layout/route-error-boundary'
import { ClockFormatProvider } from '@/components/clock-format-provider'
import type { AccountSettingsSection } from '@/components/users/account-settings-layout'
import { useClockFormat } from '@/lib/date-time'
import { getUserUsername } from '@/lib/users'
import { NativeServerGate } from '@/native/native-server-gate'
import { LoginPage } from '@/pages/login-page'
import { PlaceholderPage } from '@/pages/placeholder-page'
import { SetupPage } from '@/pages/setup-page'
import { PublicSettingsProvider } from '@/settings/public-settings'
import { ThemeProvider } from '@/theme'
import { TrackingProvider } from '@/tracking/tracking-provider'

const AccountSettingsPage = lazy(() =>
  import('@/pages/account-settings-page').then((module) => ({
    default: module.AccountSettingsPage,
  })),
)
const ActiveTrackingPage = lazy(() =>
  import('@/pages/active-tracking-page').then((module) => ({
    default: module.ActiveTrackingPage,
  })),
)
const AdminPage = lazy(() =>
  import('@/pages/admin-page').then((module) => ({
    default: module.AdminPage,
  })),
)
const TripDetailPage = lazy(() =>
  import('@/pages/trip-detail-page').then((module) => ({
    default: module.TripDetailPage,
  })),
)
const UserTripOverviewPage = lazy(() =>
  import('@/pages/user-trip-overview-page').then((module) => ({
    default: module.UserTripOverviewPage,
  })),
)

type Route =
  | { name: 'admin' }
  | { initialSection?: AccountSettingsSection; name: 'account-settings' }
  | { name: 'login' }
  | { name: 'not-found' }
  | { name: 'setup' }
  | { name: 'tracking-active' }
  | { name: 'tracking-settings' }
  | { name: 'trip-detail'; tripId: string }
  | { name: 'user-overview'; username: string }

function getRouteKey(route: Route) {
  switch (route.name) {
    case 'trip-detail':
      return `${route.name}-${route.tripId}`
    case 'user-overview':
      return `${route.name}-${route.username}`
    default:
      return route.name
  }
}

type NavigateOptions = {
  replace?: boolean
}

type InitialSetupStatus = 'complete' | 'loading' | 'required' | 'unknown'

function App() {
  // Theming wraps the server gate (not the other way around) so the
  // server-selection screen picks up the same light/dark mode as the rest
  // of the app instead of flashing to the unthemed default the instant
  // ThemeProvider mounts afterward.
  return (
    <PublicSettingsProvider>
      <ClockFormatProvider>
        <ThemeProvider>
          <NativeServerGate>
            <AuthProvider>
              <TrackingProvider>
                <AppRoutes />
              </TrackingProvider>
            </AuthProvider>
          </NativeServerGate>
        </ThemeProvider>
      </ClockFormatProvider>
    </PublicSettingsProvider>
  )
}

function AppRoutes() {
  useClockFormat()
  const { accessToken, currentUser, error, signOut, status, updateCurrentUser } = useAuth()
  const { location, navigate } = useBrowserLocation()
  const route = useMemo(() => parseRoute(location), [location])
  const currentUsername = getUserUsername(currentUser)
  const [initialSetupStatus, setInitialSetupStatus] =
    useState<InitialSetupStatus>('loading')

  useEffect(() => {
    let isCurrent = true

    void getSetupStatus()
      .then(({ setup_required }) => {
        if (isCurrent) {
          setInitialSetupStatus(setup_required ? 'required' : 'complete')
        }
      })
      .catch(() => {
        if (isCurrent) {
          // Preserve normal sign-in behavior if an older API has not yet
          // implemented the setup-status endpoint.
          setInitialSetupStatus('unknown')
        }
      })

    return () => {
      isCurrent = false
    }
  }, [])

  useEffect(() => {
    if (status !== 'authenticated') {
      return
    }

    if (currentUser?.password_change_required) {
      if (route.name !== 'account-settings' || window.location.hash !== '#security') {
        navigate('/settings#security', { replace: true })
      }
      return
    }

    if (route.name === 'setup') {
      navigate(
        currentUsername
          ? `/users/${encodeURIComponent(currentUsername)}`
          : '/login',
        { replace: true },
      )
      return
    }

    if (route.name !== 'login') {
      return
    }

    navigate(
      currentUsername ? `/users/${encodeURIComponent(currentUsername)}` : '/setup',
      { replace: true },
    )
  }, [currentUser?.password_change_required, currentUsername, navigate, route.name, status])

  function handleAuthenticated(user: NonNullable<typeof currentUser>) {
    if (user.password_change_required) {
      navigate('/settings#security', { replace: true })
      return
    }
    const username = getUserUsername(user)
    navigate(username ? `/users/${encodeURIComponent(username)}` : '/setup', {
      replace: true,
    })
  }

  function handleLogout() {
    signOut()
    navigate('/', { replace: true })
  }

  if (status === 'unavailable') {
    return <ApiUnavailablePage error={error} />
  }

  if (status === 'loading' || initialSetupStatus === 'loading') {
    return <LoadingPage />
  }

  if (
    initialSetupStatus === 'required' &&
    status === 'unauthenticated'
  ) {
    return (
      <SetupPage
        onAuthenticated={handleAuthenticated}
        onSetupCompleted={() => setInitialSetupStatus('complete')}
      />
    )
  }

  if (
    route.name === 'setup' &&
    initialSetupStatus !== 'required' &&
    status === 'unauthenticated'
  ) {
    return <LoginPage onAuthenticated={handleAuthenticated} />
  }

  if (route.name === 'login') {
    return <LoginPage onAuthenticated={handleAuthenticated} />
  }

  if (route.name === 'setup') {
    return <LoadingPage />
  }

  const renderedRoute =
    status === 'authenticated' &&
    currentUser?.password_change_required &&
    route.name !== 'account-settings' || window.location.hash !== '#security'
      ? ({ initialSection: 'security', name: 'account-settings' } as const)
      : route

  return (
    <AppShell
      authStatus={status}
      currentUser={currentUser}
      onLogout={handleLogout}
      onNavigate={navigate}
      passwordChangeRequired={currentUser?.password_change_required ?? false}
    >
      <RouteErrorBoundary key={getRouteKey(renderedRoute)}>
        <Suspense fallback={<RouteLoadingPage />}>
          {renderRoute(renderedRoute, {
            accessToken,
            currentUser,
            onNavigate: navigate,
            onProfileUpdated: updateCurrentUser,
            status,
          })}
        </Suspense>
      </RouteErrorBoundary>
    </AppShell>
  )
}

type RouteRenderContext = {
  accessToken: string | null
  currentUser: ReturnType<typeof useAuth>['currentUser']
  onNavigate: (to: string) => void
  onProfileUpdated: ReturnType<typeof useAuth>['updateCurrentUser']
  status: ReturnType<typeof useAuth>['status']
}

function renderRoute(route: Route, context: RouteRenderContext) {
  switch (route.name) {
    case 'admin':
      return (
        <AdminPage
          accessToken={context.accessToken}
          authStatus={context.status}
          currentUser={context.currentUser}
        />
      )
    case 'account-settings':
      return (
        <AccountSettingsPage
          accessToken={context.accessToken}
          authStatus={context.status}
          currentUser={context.currentUser}
          initialSection={route.initialSection}
          onNavigate={context.onNavigate}
          onProfileUpdated={context.onProfileUpdated}
        />
      )
    case 'tracking-active':
      return <ActiveTrackingPage onNavigate={context.onNavigate} />
    case 'trip-detail':
      return (
        <TripDetailPage
          accessToken={context.accessToken}
          authStatus={context.status}
          currentUser={context.currentUser}
          tripId={route.tripId}
        />
      )
    case 'user-overview':
      return (
        <UserTripOverviewPage
          accessToken={context.accessToken}
          authStatus={context.status}
          currentUser={context.currentUser}
          onNavigate={context.onNavigate}
          username={route.username}
        />
      )
    case 'not-found':
      return (
        <PlaceholderPage
          description="The page you requested does not exist."
          title="Page not found"
        />
      )
    case 'login':
      return null
  }
}

function LoadingPage() {
  return (
    <main className="relative isolate grid min-h-dvh place-items-center px-4 text-foreground">
      <AppBackground />
      <p className="text-sm text-muted-foreground" role="status">
        Loading OpenVoyage…
      </p>
    </main>
  )
}

function RouteLoadingPage() {
  return (
    <div className="grid min-h-[50vh] place-items-center" role="status">
      <p className="text-sm text-muted-foreground">Loading trip…</p>
    </div>
  )
}

function ApiUnavailablePage({ error }: { error: string | null }) {
  return (
    <main className="relative isolate grid min-h-dvh place-items-center px-4 text-foreground">
      <AppBackground />
      <div className="max-w-md space-y-3 rounded-2xl border border-border bg-card/90 p-6 text-center shadow-lg">
        <h1 className="text-lg font-semibold">OpenVoyage is unavailable</h1>
        <p className="text-sm text-muted-foreground">
          We’ll reconnect automatically when the server is available.
        </p>
        {error ? <p className="text-xs text-muted-foreground">{error}</p> : null}
      </div>
    </main>
  )
}

function useBrowserLocation() {
  const [location, setLocation] = useState(() => getCurrentLocation())

  useEffect(() => {
    function handlePopState() {
      setLocation(getCurrentLocation())
    }

    window.addEventListener('popstate', handlePopState)
    return () => window.removeEventListener('popstate', handlePopState)
  }, [])

  const navigate = useCallback((to: string, options: NavigateOptions = {}) => {
    if (to === getCurrentLocation()) {
      return
    }

    if (options.replace) {
      window.history.replaceState(null, '', to)
    } else {
      window.history.pushState(null, '', to)
    }
    setLocation(getCurrentLocation())
  }, [])

  return { location, navigate }
}

function getCurrentLocation() {
  return `${window.location.pathname}${window.location.search}`
}

function parseRoute(location: string): Route {
  const pathname = location.split('?')[0] || '/'
  const segments = pathname.split('/').filter(Boolean).map(decodeURIComponent)

  if (pathname === '/' || pathname === '/login') {
    return { name: 'login' }
  }

  if (segments[0] === 'users' && segments[1] && segments.length === 2) {
    return {
      name: 'user-overview',
      username: segments[1],
    }
  }

  if (segments[0] === 'trips' && segments[1] && segments.length === 2) {
    return {
      name: 'trip-detail',
      tripId: segments[1],
    }
  }

  if (pathname === '/admin') {
    return { name: 'admin' }
  }

  if (pathname === '/setup') {
    return { name: 'setup' }
  }

  if (pathname === '/settings' || pathname === '/settings/profile') {
    return { initialSection: 'profile', name: 'account-settings' }
  }

  if (pathname === '/settings/preferences') {
    return { initialSection: 'preferences', name: 'account-settings' }
  }

  if (pathname === '/settings/privacy') {
    return { initialSection: 'privacy', name: 'account-settings' }
  }

  if (pathname === '/settings/security') {
    return { initialSection: 'security', name: 'account-settings' }
  }

  if (pathname === '/settings/tracking') {
    return { initialSection: 'tracking', name: 'account-settings' }
  }

  if (pathname === '/tracking/active') {
    return { name: 'tracking-active' }
  }

  return { name: 'not-found' }
}

export default App
