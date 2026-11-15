import { LoaderCircle, MapPin, Search } from 'lucide-react'
import { useContext, useEffect, useId, useRef, useState } from 'react'

import { geocodeAddresses, type AddressResult } from '@/api/client'
import { Input } from '@/components/ui/input'
import {
  ADDRESS_SEARCH_MIN_LENGTH,
  ADDRESS_SEARCH_PAUSE_MS,
  addressResultDetail,
  addressSearchErrorMessage,
  type AddressSearchMode,
} from './address-search'
import { PlanningSessionContext } from './planning-session'

type SearchState =
  | { status: 'idle' }
  | { status: 'searching' }
  | { status: 'done'; results: AddressResult[] }
  | { status: 'error'; message: string }

/** "Search hotel or address" in the stay form. Results near the stop come first. */
export function StayAddressSearch({
  disabled,
  label = 'Search hotel or address',
  mode,
  near,
  onPick,
  tripId,
}: {
  disabled: boolean
  label?: string
  mode: Exclude<AddressSearchMode, 'off'>
  near: { latitude: number; longitude: number }
  onPick: (result: AddressResult) => void
  tripId: string
}) {
  const { accessToken } = useContext(PlanningSessionContext)
  const listId = useId()
  const [query, setQuery] = useState('')
  const [state, setState] = useState<SearchState>({ status: 'idle' })
  const requestRef = useRef<AbortController | null>(null)

  function search(text: string) {
    requestRef.current?.abort()
    const trimmed = text.trim()
    if (trimmed.length < ADDRESS_SEARCH_MIN_LENGTH) {
      setState({ status: 'idle' })
      return
    }
    const controller = new AbortController()
    requestRef.current = controller
    setState({ status: 'searching' })
    geocodeAddresses({ accessToken, near, query: trimmed, signal: controller.signal, tripId })
      .then((results) => { if (!controller.signal.aborted) setState({ status: 'done', results }) })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setState({ status: 'error', message: addressSearchErrorMessage(error) })
      })
  }

  // Photon and GraphHopper search after a short pause in typing.
  useEffect(() => {
    if (mode !== 'typing') return
    const timer = window.setTimeout(() => search(query), ADDRESS_SEARCH_PAUSE_MS)
    return () => window.clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- search reads the latest props
  }, [query, mode])

  useEffect(() => () => requestRef.current?.abort(), [])

  function pick(result: AddressResult) {
    onPick(result)
    setQuery('')
    setState({ status: 'idle' })
  }

  const results = state.status === 'done' ? state.results : []
  return (
    <div className="space-y-1.5">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
        <Input
          aria-controls={results.length ? listId : undefined}
          aria-label={label}
          className="pl-9"
          disabled={disabled}
          maxLength={255}
          onChange={(event) => {
            setQuery(event.target.value)
            if (mode === 'enter') setState({ status: 'idle' })
          }}
          onKeyDown={(event) => {
            // Enter searches (and never submits the stay form).
            if (event.key === 'Enter') {
              event.preventDefault()
              search(query)
            }
          }}
          placeholder={mode === 'enter' ? `${label}, then press Enter` : label}
          type="search"
          value={query}
        />
      </div>
      <div aria-live="polite">
        {state.status === 'searching' ? (
          <p className="flex items-center gap-2 px-1 text-xs text-muted-foreground">
            <LoaderCircle className="size-3.5 animate-spin" aria-hidden="true" />
            Searching…
          </p>
        ) : state.status === 'error' ? (
          <p className="px-1 text-xs text-destructive">{state.message}</p>
        ) : state.status === 'done' && results.length === 0 ? (
          <p className="px-1 text-xs text-muted-foreground">No results</p>
        ) : null}
      </div>
      {results.length ? (
        <ul aria-label="Address results" className="divide-y divide-border overflow-hidden rounded-xl border border-border" id={listId}>
          {results.map((result, index) => {
            const detail = addressResultDetail(result)
            return (
              <li key={`${result.latitude},${result.longitude},${index}`}>
                <button
                  className="flex w-full items-start gap-2 px-3 py-2 text-left hover:bg-muted/60 focus-visible:bg-muted/60 focus-visible:outline-none"
                  disabled={disabled}
                  onClick={() => pick(result)}
                  type="button"
                >
                  <MapPin className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium text-foreground">{result.name}</span>
                    {detail ? <span className="block truncate text-xs text-muted-foreground">{detail}</span> : null}
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      ) : null}
    </div>
  )
}
