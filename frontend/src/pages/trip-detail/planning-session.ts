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
  /** Where the stop card goes over the map on a computer. */
  stopCardHost?: HTMLDivElement | null
  onPanelOpenChange: (open: boolean) => void
  itineraryRevision: number
  onPreview: (connection: Connection | null) => void
  stopMarkerMap?: {
    active: boolean
    start: () => void
  }
  /** Placing a stay's pin works like placing a connection end. */
  stayMap?: {
    location: DraftPostLocation | null
    active: boolean
    /** ``name`` is the stay's name so far, for the hint over the map. */
    start: (initial: DraftPostLocation | null, name?: string | null) => void
    stop: () => void
  }
  connectionMap?: {
    location: DraftPostLocation | null
    active: boolean
    start: (initial: DraftPostLocation | null) => void
    stop: () => void
  }
}>({ accessToken: null, itineraryRevision: 0, onPreview: () => {}, panelHost: null, onPanelOpenChange: () => {} })
