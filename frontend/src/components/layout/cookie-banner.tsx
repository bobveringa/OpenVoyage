import { useEffect, useState } from 'react'
import { Cookie } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { usePublicSetting } from '@/settings/public-settings'

const DISMISSED_KEY = 'openvoyage.cookie-banner.dismissed.v1'

function wasDismissed() {
  try {
    return window.localStorage.getItem(DISMISSED_KEY) === 'true'
  } catch {
    return false
  }
}

export function CookieBanner() {
  const enabled = usePublicSetting('site.cookie_banner_enabled') === true
  const [dismissed, setDismissed] = useState(wasDismissed)

  useEffect(() => {
    function handleStorage(event: StorageEvent) {
      if (event.key === DISMISSED_KEY || event.key === null) {
        setDismissed(wasDismissed())
      }
    }

    window.addEventListener('storage', handleStorage)
    return () => window.removeEventListener('storage', handleStorage)
  }, [])

  if (!enabled || dismissed) {
    return null
  }

  function dismiss() {
    setDismissed(true)
    try {
      window.localStorage.setItem(DISMISSED_KEY, 'true')
    } catch {
      // Still dismiss for this visit when browser storage is unavailable.
    }
  }

  return (
    <section
      aria-label="Cookie notice"
      className="fixed inset-x-4 bottom-[calc(1rem+var(--app-safe-area-inset-bottom,0px))] z-50 mx-auto max-w-2xl rounded-2xl border border-border bg-card p-4 text-card-foreground shadow-xl sm:bottom-[calc(1.5rem+var(--app-safe-area-inset-bottom,0px))] sm:p-5"
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
        <Cookie aria-hidden="true" className="hidden size-6 shrink-0 text-primary sm:block" />
        <p className="flex-1 text-sm leading-6">
          This site uses cookies to support your experience.
        </p>
        <Button className="w-full shrink-0 sm:w-auto" onClick={dismiss} type="button">
          Got it
        </Button>
      </div>
    </section>
  )
}
