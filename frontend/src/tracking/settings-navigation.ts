export function trackingSettingsHref(returnTo: string): string {
  return `/settings?${new URLSearchParams({ returnTo })}#tracking`
}

export function tripTrackingReturnPath(tripId: string): string {
  const path = `/trips/${encodeURIComponent(tripId)}`
  const url = new URL(path, window.location.origin)
  if (window.location.pathname === path) {
    url.search = window.location.search
  } else {
    url.searchParams.set('tab', 'travel')
  }
  url.searchParams.set('dialog', 'management')
  url.searchParams.set('section', 'gps')
  return url.pathname + url.search
}

export function readTrackingSettingsReturnPath(search: string): string | null {
  const value = new URLSearchParams(search).get('returnTo')
  if (!value?.startsWith('/') || value.startsWith('//')) return null
  const url = new URL(value, window.location.origin)
  if (
    url.origin !== window.location.origin ||
    !(
      url.pathname === '/tracking/active' ||
      /^\/trips\/[^/]+$/.test(url.pathname)
    )
  )
    return null
  return url.pathname + url.search + url.hash
}
