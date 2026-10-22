import { createContext } from 'react'
import type { Connection } from './models'
import type { AirportTransferRequest, AirportTransferSide } from './airport-transfers'
import type { DraftPostLocation } from './page-types'

export const PlanningSessionContext = createContext<{
  accessToken: string | null
  airportTransferRequest?: AirportTransferRequest | null
  onAirportTransferSelect?: (connectionId: string, side: AirportTransferSide) => void
  saveError?: string | null
  panelHost: HTMLDivElement | null
  onPanelOpenChange: (open: boolean) => void
  itineraryRevision: number
  onPreview: (connection: Connection | null) => void
  connectionMap?: {
    location: DraftPostLocation | null
    active: boolean
    start: (initial: DraftPostLocation | null) => void
    stop: () => void
  }
}>({ accessToken: null, itineraryRevision: 0, onPreview: () => {}, panelHost: null, onPanelOpenChange: () => {} })
