import { createContext } from 'react'
import type { TravelLeg } from './models'
import type { AirportTransferRequest, AirportTransferSide } from './airport-transfers'

export const PlanningSessionContext = createContext<{
  accessToken: string | null
  airportTransferRequest?: AirportTransferRequest | null
  onAirportTransferSelect?: (legId: string, side: AirportTransferSide) => void
  saveError?: string | null
  panelHost: HTMLDivElement | null
  onPanelOpenChange: (open: boolean) => void
  itineraryRevision: number
  onPreview: (leg: TravelLeg | null) => void
}>({ accessToken: null, itineraryRevision: 0, onPreview: () => {}, panelHost: null, onPanelOpenChange: () => {} })
