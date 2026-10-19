import { createContext } from 'react'
import type { TravelLeg } from './models'

export const PlanningSessionContext = createContext<{
  accessToken: string | null
  saveError?: string | null
  itineraryRevision: number
  onPreview: (leg: TravelLeg | null) => void
}>({ accessToken: null, itineraryRevision: 0, onPreview: () => {} })
