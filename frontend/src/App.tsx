import { useCallback, useEffect, useMemo, useState } from 'react'

import { AuthProvider } from '@/auth/auth-provider'
import { useAuth } from '@/auth/use-auth'
import { AppShell } from '@/components/layout/app-shell'
import { getUserUsername } from '@/lib/users'
import { AdminPage } from '@/pages/admin-page'
import { LoginPage } from '@/pages/login-page'
import { PlaceholderPage } from '@/pages/placeholder-page'
import { ProfileSettingsPage } from '@/pages/profile-settings-page'
import { SetupPage } from '@/pages/setup-page'
import { TripDetailPage } from '@/pages/trip-detail-page'
import { TripDetailMockupPage } from '@/pages/trip-detail-mockup-page'
import { UserTripOverviewPage } from '@/pages/user-trip-overview-page'

type Route =
  | { name: 'admin' }
  | { name: 'login' }
  | { name: 'not-found' }
  | { name: 'profile-settings' }
  | { name: 'setup' }
  | { name: 'trip-detail'; tripId: string }
  | { name: 'trip-detail-mockup' }
  | { name: 'user-overview'; username: string }

type NavigateOptions = {
  replace?: boolean
}

function App() {
  return (
    <AuthProvider>
      <AppRoutes />
    </AuthProvider>
  )
}

function AppRoutes() {
  const { accessToken, currentUser, signOut, status, updateCurrentUser } = useAuth()
  const { location, navigate } = useBrowserLocation()
  const route = useMemo(() => parseRoute(location), [location])
  const currentUsername = getUserUsername(currentUser)

  useEffect(() => {
    if (status !== 'authenticated' || route.name !== 'login') {
      return
    }

    navigate(
      currentUsername ? `/users/${encodeURIComponent(currentUsername)}` : '/setup',
      { replace: true },
    )
  }, [currentUsername, navigate, route.name, status])

  function handleAuthenticated(user: NonNullable<typeof currentUser>) {
    const username = getUserUsername(user)
    navigate(username ? `/users/${encodeURIComponent(username)}` : '/setup', {
      replace: true,
    })
  }

  function handleLogout() {
    signOut()
    navigate('/', { replace: true })
  }

  if (route.name === 'login') {
    return <LoginPage onAuthenticated={handleAuthenticated} />
  }

  return (
    <AppShell
      authStatus={status}
      currentUser={currentUser}
      onLogout={handleLogout}
      onNavigate={navigate}
    >
      {renderRoute(route, {
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
    case 'setup':
      return <SetupPage />
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
    case 'trip-detail':
      return <TripDetailPage tripId={route.tripId} />
    case 'trip-detail-mockup':
      return <TripDetailMockupPage />
    case 'user-overview':
      return (
        <UserTripOverviewPage
          accessToken={context.accessToken}
          authStatus={context.status}
          currentUser={context.currentUser}
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

  if (pathname === '/trips/mockup') {
    return { name: 'trip-detail-mockup' }
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

  return { name: 'not-found' }
}

export default App
