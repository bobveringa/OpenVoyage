import { useContext, useEffect, useEffectEvent, useState } from 'react'
import type { Place } from '@/api/client'
import { Button } from '@/components/ui/button'
import { PlaceLocationPicker } from './place-location-picker'
import { PlanningSessionContext } from './planning-session'
import { getPlaceSearchInput } from './planning-utils'
import type { ConnectionLocation } from './outer-connection'

export function ConnectionLocationPicker({ label, value, onChange, disabled }: {
  label: string
  value: ConnectionLocation | null
  onChange: (value: ConnectionLocation | null) => void
  disabled: boolean
}) {
  const { connectionMap } = useContext(PlanningSessionContext)
  const [source, setSource] = useState<'search' | 'map'>('search')
  const [query, setQuery] = useState(value?.anchor.title ?? '')
  const [selectedPlace, setSelectedPlace] = useState<Place | null>(null)
  const [searchedLocation, setSearchedLocation] = useState(value)
  const [resultsOpen, setResultsOpen] = useState(false)
  const applyMapLocation = useEffectEvent(() => {
    const point = connectionMap?.location
    if (!point || disabled) return
    const location = { latitude: point.coordinates[0], longitude: point.coordinates[1], name: point.label }
    onChange({ input: { latitude: location.latitude, longitude: location.longitude }, anchor: { title: point.label, location } })
  })
  useEffect(() => {
    if (connectionMap?.active) {
      setSource('map')
      applyMapLocation()
    }
  }, [connectionMap?.active, connectionMap?.location])

  function selectSearch() {
    if (disabled) return
    connectionMap?.stop()
    setSource('search')
    setResultsOpen(true)
    onChange(searchedLocation)
  }
  function selectPlace(place: Place) {
    if (disabled) return
    const location = { input: { place_id: place.id }, anchor: { title: place.name, location: place } }
    connectionMap?.stop()
    setSource('search'); setSelectedPlace(place); setSearchedLocation(location)
    setQuery(getPlaceSearchInput(place)); setResultsOpen(false)
    onChange(location)
  }
  function clear() {
    connectionMap?.stop()
    setSource('search'); setSelectedPlace(null); setSearchedLocation(null); setQuery(''); setResultsOpen(false)
    onChange(null)
  }
  const coordinates = query.split(',').map((part) => Number(part.trim()))
  const validCoordinates = query.includes(',') && coordinates.length === 2 && coordinates.every(Number.isFinite)
    && Math.abs(coordinates[0]) <= 90 && Math.abs(coordinates[1]) <= 180
  return <div className="space-y-3" role="group" aria-label={label}>
    <PlaceLocationPicker disabled={disabled} searchValue={query} selectedPlace={selectedPlace}
      resultsOpen={resultsOpen} source={source} mapActive={connectionMap?.active ?? false} mapLocation={connectionMap?.location ?? null}
      onSearchChange={(query) => {
        connectionMap?.stop(); setSource('search'); setQuery(query); setSelectedPlace(null); setSearchedLocation(null)
        setResultsOpen(true); onChange(null)
      }} onSearchFocus={() => setResultsOpen(true)} onSelectPlace={selectPlace} onSelectSearch={selectSearch}
      onSelectMap={() => connectionMap?.start(value ? {
        coordinates: [value.anchor.location.latitude, value.anchor.location.longitude], label: value.anchor.title,
      } : null)}
      selectedSearchLabel={searchedLocation?.anchor.title}
      mapInstruction="Click on the map to choose this location.">
      {validCoordinates && source === 'search' && !searchedLocation ? <Button disabled={disabled} type="button" variant="outline" onClick={() => {
        const location = { latitude: coordinates[0], longitude: coordinates[1], name: query.trim() }
        const selected = { input: { latitude: location.latitude, longitude: location.longitude }, anchor: { title: location.name, location } }
        setSearchedLocation(selected); setResultsOpen(false); onChange(selected)
      }}>Use coordinates</Button> : null}
    </PlaceLocationPicker>
    {value ? <Button disabled={disabled} type="button" variant="ghost" onClick={clear}>Clear {label.toLowerCase()}</Button> : null}
  </div>
}
