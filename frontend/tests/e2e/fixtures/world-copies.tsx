import * as L from 'leaflet'
import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { ClockFormatProvider } from '../../../src/components/clock-format-provider'
import { TrackingSessionMap } from '../../../src/components/trips/tracking-session-map'
import { PublicSettingsContext } from '../../../src/settings/public-settings-context'
import { ThemeProvider } from '../../../src/theme/theme-provider'
import { TripLeafletMap } from '../../../src/pages/trip-detail/trip-map'
import { createOuterConnectionDraft } from '../../../src/pages/trip-detail/outer-connection'
import { EMPTY_TRACKING_GEOMETRY, type Stop, type Connection, type TravelPost } from '../../../src/pages/trip-detail/models'
import type { GpsPostCandidate, TrackSample } from '../../../src/api/client'
import '../../../src/index.css'

let map: L.Map
L.Map.addInitHook(function (this: L.Map) {
  // The fixture's navigation buttons control the real component's map.
  // eslint-disable-next-line @typescript-eslint/no-this-alias
  map = this
})
const timestamp = '2026-10-20T12:00:00Z'
const stops: Stop[] = [
  { name: 'Bucharest', latitude: 44.4268, longitude: 26.1025 },
  { name: 'Honolulu', latitude: 21.3099, longitude: -157.8581 },
].map((place, index) => ({
  id: 'stop-' + index, trip_id: 'trip', title: place.name, planned_start_date: '2026-10-20', planned_nights: 2,
  notes: '', same_day_position: 0, visited: false, created_at: timestamp, updated_at: timestamp,
  created_by: { id: 'owner', first_name: null, last_name: null, username: null },
  location: { ...place, id: 'place-' + index, full_name: place.name, region: '', country_code: '' },
}))
const geometry = { type: 'LineString' as const, coordinates: [[26.1025, 44.4268], [-157.8581, 21.3099]] }
const connection: Connection = {
  ...createOuterConnectionDraft('DEPARTURE', stops[0]), id: 'flight', connection_type: 'BETWEEN_STOPS',
  from: { type: 'STOP', stop_id: stops[0].id }, to: { type: 'STOP', stop_id: stops[1].id },
  segments: [{ id: 'flight-segment', input_version: 1, intent: { travel_mode: 'FLIGHT', mode_selected: false, notes: '', route_option: 0 },
    mode_source: 'USER', route_state: 'UNSUPPORTED', geometry, from_endpoint: null, to_endpoint: null }],
  route: { type: 'SIMPLE', geometry, distance_meters: null, duration_seconds: null },
}
const post: TravelPost = {
  id: 'hawaii-post', title: 'Hawaii post', coordinates: [25, -150], bubbleMediaId: null, excerpt: '', isDraft: false,
  location: 'Hawaii', media: [], occurredAt: timestamp, publishedAt: timestamp, revision: 1,
  routeAfter: { durationSeconds: null, segments: [{ coordinates: [[25, -150], [35, -140]], travelMode: 'WALK', visibleToMembersOnly: true }] }, time: '',
  author: { id: 'owner', displayName: 'Owner', initials: 'O', profilePicture: null },
  social: { canInteract: false, canLike: false, commentCount: 0, likeCount: 0, viewerHasLiked: false },
}
const candidate = { latitude: 12, longitude: -166, recorded_at: timestamp } as GpsPostCandidate
const samples: TrackSample[] = [0, 1].map((index) => ({
  id: 'point-' + index, recorded_at: timestamp, latitude: 21.3099 + index * 0.005, longitude: -157.8581 + index * 0.005,
  travel_mode: 'WALK', accuracy_meters: 5, altitude_meters: null, speed_mps: null, heading_degrees: null,
}))

export function Preview() {
  const editor = new URLSearchParams(location.search).has('editor')
  const [timeline, setTimeline] = useState(false)
  const [selected, setSelected] = useState('')
  const [picked, setPicked] = useState('')
  const [moved, setMoved] = useState('')
  return <main>
    <div style={{ height: 100 }}>
      <button onClick={() => map.setView([21.3099, -157.8581], editor ? 14 : 3, { animate: false })}>Hawaii</button>
      <button onClick={() => map.setView([21.3099, map.getCenter().lng + 360], map.getZoom(), { animate: false })}>East one world</button>
      <button onClick={() => map.setView([21.3099, map.getCenter().lng - 360], map.getZoom(), { animate: false })}>West one world</button>
      <button onClick={() => setTimeline((value) => !value)}>Toggle timeline</button>
      <output data-testid="selected">{selected}</output>
      <output data-testid="picked">{picked}</output>
      <output data-testid="moved">{moved}</output>
    </div>
    <div style={{ position: 'relative', height: 'calc(100dvh - 100px)' }}>
      {editor ? <TrackingSessionMap paths={[{ id: 'recording', color: '#246b49', points: samples }]}
        selectedSessionId="recording" editablePoints={samples} selectedPoint={samples[0]} origin={samples[0]}
        onSelect={setSelected} onMove={(lat, lon) => setMoved(JSON.stringify([lat, lon]))} /> :
      <TripLeafletMap draftMapLocation={null} mapPointEnabled onDraftMapPointSelect={(point) => setPicked(JSON.stringify(point))}
        resetNonce={0} routeMode={timeline ? 'travel-timeline' : 'itinerary'} stops={stops}
        connections={[connection]} travelPosts={timeline ? [post] : []} isTripOngoing={timeline}
        trackingGeometry={timeline ? { openingRoute: { durationSeconds: null, segments: [{ coordinates: [[21.1, -158], [21.8, -157.2]], travelMode: 'WALK', visibleToMembersOnly: true }] } } : EMPTY_TRACKING_GEOMETRY}
        gpsPostCandidates={timeline ? [candidate] : []} onGpsPostCandidateSelect={() => setSelected('candidate')}
        onPostMarkerSelect={setSelected} />}
    </div>
  </main>
}

createRoot(document.getElementById('root')!).render(<PublicSettingsContext value={{ settings: {}, refresh: async () => true }}>
  <ThemeProvider><ClockFormatProvider><Preview /></ClockFormatProvider></ThemeProvider>
</PublicSettingsContext>)
