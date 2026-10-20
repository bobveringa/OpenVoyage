import { createContext } from 'react'
import type { TravelLeg } from './models'
import type { AirportTransferRequest, AirportTransferSide } from './airport-transfers'
import type { DraftPostLocation } from './page-types'

export const PlanningSessionContext = createContext<{
  accessToken: string | null
  airportTransferRequest?: AirportTransferRequest | null
  onAirportTransferSelect?: (legId: string, side: AirportTransferSide) => void
  saveError?: string | null
  panelHost: HTMLDivElement | null
  onPanelOpenChange: (open: boolean) => void
  itineraryRevision: number
  onPreview: (leg: TravelLeg | null) => void
  connectionMap?: {
    location: DraftPostLocation | null
    active: boolean
    start: (initial: DraftPostLocation | null) => void
    stop: () => void
  }
}>({ accessToken: null, itineraryRevision: 0, onPreview: () => {}, panelHost: null, onPanelOpenChange: () => {} })
