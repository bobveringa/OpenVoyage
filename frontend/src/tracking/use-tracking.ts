import { useContext } from 'react'

import { TrackingContext } from '@/tracking/tracking-context'

export function useTracking() {
  const context = useContext(TrackingContext)
  if (!context) {
    throw new Error('useTracking must be used inside TrackingProvider')
  }
  return context
}
