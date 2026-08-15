import { useCallback, useEffect, useMemo, useState } from 'react'

import { getSetupStatus } from '@/api/client'
import { AuthProvider } from '@/auth/auth-provider'
import { useAuth } from '@/auth/use-auth'
import { AppBackground } from '@/components/layout/app-background'
import { AppShell } from '@/components/layout/app-shell'
import { getUserUsername } from '@/lib/users'
import { AdminPage } from '@/pages/admin-page'
import { AccountSecurityPage } from '@/pages/account-security-page'
import { LoginPage } from '@/pages/login-page'
import { PlaceholderPage } from '@/pages/placeholder-page'
import { ProfileSettingsPage } from '@/pages/profile-settings-page'
import { SetupPage } from '@/pages/setup-page'
import { TripDetailPage } from '@/pages/trip-detail-page'
import { UserTripOverviewPage } from '@/pages/user-trip-overview-page'
import { PublicSettingsProvider } from '@/settings/public-settings'
import { ThemeProvider } from '@/theme'

type Route =
  | { name: 'admin' }
  | { name: 'login' }
  | { name: 'not-found' }
  | { name: 'profile-settings' }
  | { name: 'security-settings' }
  | { name: 'setup' }
  | { name: 'trip-detail'; tripId: string }
  | { name: 'user-overview'; username: string }

type NavigateOptions = {
  replace?: boolean
}

type InitialSetupStatus = 'complete' | 'loading' | 'required' | 'unknown'

function App() {
  return (
    <PublicSettingsProvider>
      <ThemeProvider>
        <AuthProvider>
          <AppRoutes />
        </AuthProvider>
      </ThemeProvider>
    </PublicSettingsProvider>
  )
}

function AppRoutes() {
  const { accessToken, currentUser, signOut, status, updateCurrentUser } = useAuth()
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
      if (route.name !== 'security-settings') {
        navigate('/settings/security', { replace: true })
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
      navigate('/settings/security', { replace: true })
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
    route.name !== 'security-settings'
      ? ({ name: 'security-settings' } as const)
      : route

  return (
    <AppShell
      authStatus={status}
      currentUser={currentUser}
      onLogout={handleLogout}
      onNavigate={navigate}
      passwordChangeRequired={currentUser?.password_change_required ?? false}
    >
      {renderRoute(renderedRoute, {
        accessToken,
        currentUser,
        onNavigate: navigate,
        onProfileUpdated: updateCurrentUser,
        status,
      })}
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
    case 'profile-settings':
      return (
        <ProfileSettingsPage
          accessToken={context.accessToken}
          authStatus={context.status}
          currentUser={context.currentUser}
          onNavigate={context.onNavigate}
          onProfileUpdated={context.onProfileUpdated}
        />
      )
    case 'security-settings':
      return (
        <AccountSecurityPage
          authStatus={context.status}
          currentUser={context.currentUser}
          onNavigate={context.onNavigate}
        />
      )
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

  if (pathname === '/settings/profile') {
    return { name: 'profile-settings' }
  }

  if (pathname === '/settings/security') {
    return { name: 'security-settings' }
  }

  return { name: 'not-found' }
}

export default App
