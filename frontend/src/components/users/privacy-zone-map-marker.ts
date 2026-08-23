import * as L from 'leaflet'

const privacyZoneMarkerSvg = `
  <svg aria-hidden="true" class="privacy-zone-marker" viewBox="0 0 32 42">
    <path d="M16 2C8.27 2 2 8.27 2 16c0 10.5 14 24 14 24s14-13.5 14-24C30 8.27 23.73 2 16 2Z" />
    <circle class="privacy-zone-marker__centre" cx="16" cy="16" r="5.5" />
    <circle class="privacy-zone-marker__dot" cx="16" cy="16" r="2.25" />
  </svg>
`

export const privacyZoneMarkerIcon = L.divIcon({
  className: 'privacy-zone-marker-icon',
  html: privacyZoneMarkerSvg,
  iconAnchor: [18, 42],
  iconSize: [36, 42],
})
