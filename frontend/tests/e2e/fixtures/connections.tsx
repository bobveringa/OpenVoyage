import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { ClockFormatProvider } from '../../../src/components/clock-format-provider'
import { PublicSettingsContext } from '../../../src/settings/public-settings-context'
import { ThemeProvider } from '../../../src/theme/theme-provider'
import { PlanningPanel } from '../../../src/pages/trip-detail/planning-ui'
import { PlanningSessionContext } from '../../../src/pages/trip-detail/planning-session'
import { MapWorkspace } from '../../../src/pages/trip-detail/trip-map'
import { MobileMapPointPicker } from '../../../src/pages/trip-detail/trip-sidebar'
import { useMediaQuery } from '../../../src/pages/trip-detail/use-media-query'
import { createOuterConnectionDraft } from '../../../src/pages/trip-detail/outer-connection'
import { createItineraryConnection, deleteItineraryConnection, type ItineraryConnectionReplacePayload } from '../../../src/api/client'
import { EMPTY_TRACKING_GEOMETRY, type Stop, type Connection } from '../../../src/pages/trip-detail/models'
import type { DraftPostLocation } from '../../../src/pages/trip-detail/page-types'
import '../../../src/index.css'

const noop = () => {}
const stops: Stop[] = [
  { id: 'first', title: 'Amsterdam', latitude: 52.37, longitude: 4.9 },
  { id: 'last', title: 'Utrecht', latitude: 52.09, longitude: 5.12 },
].map((place) => ({
  id: place.id, trip_id: 'trip', title: place.title, planned_start_date: '2026-11-18', planned_nights: 2,
  notes: '', same_day_position: 0, visited: false, created_at: '2026-10-20T12:00:00Z', updated_at: '2026-10-20T12:00:00Z',
  created_by: { id: 'owner', first_name: null, last_name: null, username: null },
  location: { id: place.id, latitude: place.latitude, longitude: place.longitude, name: place.title, full_name: place.title, region: '', country_code: 'NL' },
}))
const interior: Connection = {
  ...createOuterConnectionDraft('DEPARTURE', stops[0]), id: 'interior', connection_type: 'BETWEEN_STOPS',
  from: { type: 'STOP', stop_id: 'first' }, to: { type: 'STOP', stop_id: 'last' },
  segments: [{ id: 'segment', input_version: 1, intent: { travel_mode: 'TRAIN', mode_selected: false, notes: '', route_option: 0 }, mode_source: 'USER', route_state: 'UNSUPPORTED', geometry: null, from_endpoint: null, to_endpoint: null }],
  route: { type: 'SIMPLE', geometry: { type: 'LineString', coordinates: [[4.9, 52.37], [5.12, 52.09]] }, distance_meters: null, duration_seconds: null },
}
export function Preview() {
  const desktop = useMediaQuery('(min-width: 1024px)')
  const [host, setHost] = useState<HTMLDivElement | null>(null)
  const [preview, setPreview] = useState<Connection | null>(null)
  const [connections, setConnections] = useState(() => {
    const side = new URLSearchParams(window.location.search).get('connection')
    if (side !== 'departure' && side !== 'return') return [interior]
    const outside = { type: 'LOCATION' as const, location: { ...stops[0].location, name: 'London', latitude: 51.5, longitude: -0.1 } }
    const connection: Connection = { ...interior, id: 'saved-' + side, connection_type: side === 'departure' ? 'DEPARTURE' : 'RETURN',
      from: side === 'departure' ? outside : { type: 'STOP', stop_id: 'last' },
      to: side === 'return' ? outside : { type: 'STOP', stop_id: 'first' } }
    return [interior, connection]
  })
  const [location, setLocation] = useState<DraftPostLocation | null>(null)
  const [active, setActive] = useState(false)
  const [picker, setPicker] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  async function create(payload: ItineraryConnectionReplacePayload) {
    setSaving(true); setError(null)
    try {
      const result = await createItineraryConnection({ tripId: 'trip', accessToken: 'fixture', itineraryRevision: 2, payload })
      setConnections((previous) => [...previous, result.connection])
    } catch (error) { setError(String(error)) } finally { setSaving(false) }
  }
  async function remove(connectionId: string) {
    setSaving(true); setError(null)
    try {
      const result = await deleteItineraryConnection({ tripId: 'trip', connectionId, accessToken: 'fixture', itineraryRevision: 2, confirmConnectionDeletion: true })
      setConnections(result.connections)
    } catch (error) { setError(String(error)) } finally { setSaving(false) }
  }
  return <PlanningSessionContext value={{ accessToken: 'fixture', itineraryRevision: 2, panelHost: host, onPanelOpenChange: noop,
    onPreview: setPreview, saveError: error, connectionMap: { location, active,
      start: (initial) => { setLocation(initial); setActive(true); setPicker(!desktop) },
      stop: () => { setActive(false); setPicker(false) },
    } }}>
    <main className="relative z-0 h-dvh p-4">
      <h1 className="mb-4 text-2xl font-semibold">A weekend in the Netherlands</h1>
      <div style={{ display: 'grid', height: 'calc(100dvh - 5rem)', gridTemplateColumns: desktop ? '25rem minmax(0, 1fr)' : '1fr', gap: 16 }}>
        <div className="overflow-auto rounded-2xl border border-border bg-card"><PlanningPanel canMutate isMutating={saving}
          onAddStop={noop} onRefreshConnectionRoute={noop} onStopChange={noop} onStopDelete={noop} onStopSave={noop}
          onConnectionSave={noop} onConnectionCreate={(payload) => void create(payload)} onConnectionDelete={(id) => void remove(id)}
          pendingAction={null} stops={stops} tripStartDate="2026-11-18" connections={connections} /></div>
        {desktop ? <MapWorkspace onPlanningPanelHostChange={setHost} planningPreview={preview}
          draftMapLocation={active ? location : null} focusedPostId={null} gpsPostCandidates={[]} isTripOngoing={false}
          mapPointEnabled={active} onDraftMapPointSelect={(coordinates) => setLocation({ coordinates, label: 'Selected connection location' })}
          onGpsPostCandidateSelect={noop} onPostMarkerSelect={noop} routeMode="itinerary" stops={stops}
          trackingGeometry={EMPTY_TRACKING_GEOMETRY} connections={connections} travelPosts={[]} /> : null}
      </div>
    </main>
    <MobileMapPointPicker initialLocation={location} isTripOngoing={false} onCancel={() => setPicker(false)}
      onConfirm={(coordinates) => { setLocation({ coordinates, label: 'Selected connection location' }); setPicker(false) }}
      open={picker} routeMode="itinerary" stops={stops} target="connection" trackingGeometry={EMPTY_TRACKING_GEOMETRY} connections={connections} travelPosts={[]} />
  </PlanningSessionContext>
}
createRoot(document.getElementById('root')!).render(<PublicSettingsContext value={{ settings: {}, refresh: async () => true }}>
  <ThemeProvider><ClockFormatProvider><Preview /></ClockFormatProvider></ThemeProvider>
</PublicSettingsContext>)
