import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Maximize2, Minimize2 } from 'lucide-react'
import {
  getErrorMessage,
  saveSessionPoints,
  type TrackSample,
  type TrackingSession,
  type TravelMode,
} from '@/api/client'
import { Button } from '@/components/ui/button'
import { Select } from '@/components/ui/select'
import { TRAVEL_MODE_OPTIONS } from '@/tracking/travel-mode-options'
import { insertionArea, moveAreaRadius } from '@/tracking/edit-geometry'
import { TrackingSessionMap } from './tracking-session-map'
import {
  coordinates,
  SESSION_COLORS,
  loadSessionPoints,
} from '@/tracking/session-points'
import { TimeRangeSlider } from '@/components/ui/time-range-slider'
import { TrackingConfirmation } from '@/components/ui/tracking-confirmation'

type DraftPoint = TrackSample & { after_id?: string; before_id?: string }
type Props = {
  accessToken: string
  tripId: string
  session: TrackingSession
  initial: readonly TrackSample[]
  sessions: readonly TrackingSession[]
  onBack: () => void
  onSaved: () => Promise<void>
}
export function TrackingSessionDetail({
  accessToken,
  tripId,
  session,
  initial,
  sessions,
  onBack,
  onSaved,
}: Props) {
  const root = useRef<HTMLDivElement>(null)
  const mapContainer = useRef<HTMLDivElement>(null)
  const nextDraftPointId = useRef(0)
  const [mapExpanded, setMapExpanded] = useState(false)
  const [tool, setTool] = useState<'point' | 'transport'>('point')
  const [bulkMode, setBulkMode] = useState<TravelMode>('WALK')
  const [draft, setDraft] = useState<readonly DraftPoint[]>(initial)
  const [history, setHistory] = useState<(readonly DraftPoint[])[]>([])
  const [selectedId, setSelectedId] = useState(initial[0]?.id ?? '')
  const [inserting, setInserting] = useState(false)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const [confirmLeave, setConfirmLeave] = useState(false)
  const minTime = initial.length
    ? Date.parse(initial[0].recorded_at)
    : Date.parse(session.started_at)
  const maxTime = initial.length
    ? Date.parse(initial[initial.length - 1].recorded_at)
    : minTime
  const [range, setRange] = useState<[number, number]>([minTime, maxTime])
  const [references, setReferences] = useState<
    Record<string, readonly TrackSample[]>
  >({})
  const [visibleReferences, setVisibleReferences] = useState<string[]>([])
  const [loadingReference, setLoadingReference] = useState<string | null>(null)
  const visible = useMemo(
    () =>
      draft.filter(
        (p) =>
          Date.parse(p.recorded_at) >= range[0] &&
          Date.parse(p.recorded_at) <= range[1],
      ),
    [draft, range],
  )
  const dirty = history.length > 0
  const bulkIds = new Set(visible.map(p => p.id))
  const bulkChangeCount = visible.filter(p => p.travel_mode !== bulkMode).length
  const index = draft.findIndex((p) => p.id === selectedId)
  const visibleIndex = visible.findIndex((p) => p.id === selectedId)
  const selected = visible[visibleIndex]
  const previous = visible[visibleIndex - 1]
  const next = visible[visibleIndex + 1]
  // A newly inserted point has no saved counterpart yet. Its insertion
  // position is still a valid anchor for the same connection-aware movement area.
  const origin = initial.find((p) => p.id === selectedId) ?? selected
  const moveRadius =
    origin && selected
      ? moveAreaRadius(
          coordinates(origin),
          [previous, next].filter(
            (point): point is TrackSample => point !== undefined,
          ).map(coordinates),
        )
      : undefined
  const insertion: [TrackSample, TrackSample] | null =
    inserting && selected && next ? [selected, next] : null
  const displayPaths = useMemo(
    () => [
      ...sessions
        .filter((s) => visibleReferences.includes(s.id))
        .map((s) => ({
          id: s.id,
          color: SESSION_COLORS[sessions.indexOf(s) % SESSION_COLORS.length],
          points: references[s.id] ?? [],
        })),
      {
        id: session.id,
        color:
          SESSION_COLORS[
            sessions.findIndex((s) => s.id === session.id) %
              SESSION_COLORS.length
          ],
        points: draft,
      },
    ],
    [sessions, visibleReferences, references, draft, session.id],
  )
  const toggleReference = async (id: string) => {
    if (visibleReferences.includes(id)) {
      setVisibleReferences((ids) => ids.filter((value) => value !== id))
      return
    }
    setLoadingReference(id)
    try {
      if (!references[id]) {
        const loaded = await loadSessionPoints({
          accessToken,
          tripId,
          sessionId: id,
        })
        setReferences((current) => ({ ...current, [id]: loaded }))
      }
      setVisibleReferences((ids) => [...ids, id])
    } catch (e) {
      setError(getErrorMessage(e))
    } finally {
      setLoadingReference(null)
    }
  }
  const change = (points: readonly DraftPoint[]) => {
    setHistory((h) => [...h, draft])
    setDraft(points)
    setError('')
  }
  const select = (id: string) => {
    setSelectedId(id)
    setInserting(false)
    setNotice('')
  }
  const back = () => {
    if (dirty) setConfirmLeave(true)
    else onBack()
  }
  useEffect(() => {
    const unload = (event: BeforeUnloadEvent) => {
      if (dirty) event.preventDefault()
    }
    // The parent management modal must not close behind a dirty editor.
    const escape = (event: KeyboardEvent) => {
      if (document.querySelector('[role="listbox"]')) return
      if (event.key === 'Escape' && !confirmLeave) {
        event.stopImmediatePropagation()
        if (!busy) {
          if (dirty) setConfirmLeave(true)
          else onBack()
        }
      }
    }
    window.addEventListener('beforeunload', unload)
    window.addEventListener('keydown', escape, true)
    return () => {
      window.removeEventListener('beforeunload', unload)
      window.removeEventListener('keydown', escape, true)
    }
  }, [dirty, busy, onBack, confirmLeave])
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    const overflow = document.body.style.overflow
    const siblings = Array.from(document.body.children).filter(
      (node): node is HTMLElement => node instanceof HTMLElement && node !== root.current,
    )
    const inert = siblings.map(node => node.inert)
    siblings.forEach(node => { node.inert = true })
    document.body.style.overflow = 'hidden'
    root.current?.focus()
    const trapFocus = (event: KeyboardEvent) => {
      if (event.key !== 'Tab' || document.querySelector('[role="alertdialog"], [role="listbox"]')) return
      const elements = Array.from(root.current?.querySelectorAll<HTMLElement>(
        'button:not(:disabled), input:not(:disabled), summary, [tabindex="0"]',
      ) ?? []).filter(node => node.getClientRects().length > 0)
      const first = elements[0], last = elements[elements.length - 1]
      if (event.shiftKey && (document.activeElement === first || document.activeElement === root.current)) {
        event.preventDefault()
        last?.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first?.focus()
      }
    }
    window.addEventListener('keydown', trapFocus, true)
    return () => {
      siblings.forEach((node, i) => { node.inert = inert[i] })
      document.body.style.overflow = overflow
      window.removeEventListener('keydown', trapFocus, true)
      previous?.focus()
    }
  }, [])
  const save = async () => {
    setBusy(true)
    setError('')
    try {
      const existingIds = new Set(initial.map((point) => point.id))
      await saveSessionPoints({
        accessToken,
        tripId,
        sessionId: session.id,
        points: draft.map((point) => ({
          ...(existingIds.has(point.id) ? { id: point.id } : {}),
          latitude: point.latitude,
          longitude: point.longitude,
          travel_mode: point.travel_mode,
        })),
      })
      await onSaved()
      onBack()
    } catch (e) {
      setError(getErrorMessage(e))
    } finally {
      setBusy(false)
    }
  }
  return createPortal(
    <div
      ref={root}
      tabIndex={-1}
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 outline-none md:p-6"
      role="dialog"
      aria-modal="true"
      aria-label="Recording details"
    >
      <div className="flex h-dvh w-full flex-col overflow-hidden bg-background shadow-2xl md:h-[min(800px,90dvh)] md:max-w-6xl md:rounded-2xl md:border md:border-border">
        <header className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-4 py-3 pt-[max(.75rem,env(safe-area-inset-top))]">
          <div className="min-w-0">
            <h2 className="text-lg font-semibold">Edit recording</h2>
            <p className="truncate text-xs text-muted-foreground">{new Date(session.started_at).toLocaleString()}</p>
          </div>
          <Button variant="ghost" disabled={busy} onClick={back}>{'\u2190 Recordings'}</Button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto md:grid md:grid-cols-[minmax(0,1fr)_360px] md:overflow-hidden">
          <div className="flex min-h-0 flex-col p-3 md:p-4">
        <div ref={mapContainer} className={`relative ${mapExpanded ? 'h-[65dvh]' : 'h-[24dvh]'} min-h-40 md:h-auto md:min-h-0 md:flex-1`}>
        <TrackingSessionMap
          paths={displayPaths}
          editablePoints={visible}
          selectedSessionId={session.id}
          selectedPoint={tool === 'point' ? selected : undefined}
          origin={origin}
          moveRadius={moveRadius}
          insertion={insertion}
          disabled={busy}
          fitKey={session.id}
          onNotice={setNotice}
          onSelect={select}
          onMove={(latitude, longitude) =>
            change(
              draft.map((p) =>
                p.id === selectedId ? { ...p, latitude, longitude } : p,
              ),
            )
          }
          onInsert={(latitude, longitude) => {
            if (!selected || !next) return
            const point: DraftPoint = {
              ...selected,
              // Editor-only identity: save omits this ID and the server assigns
              // a UUID. A counter also works on LAN HTTP, where randomUUID is
              // unavailable. Do not rewind it on undo or reuse a draft's ID.
              id: `draft-point-${nextDraftPointId.current++}`,
              latitude,
              longitude,
              recorded_at: new Date(
                (Date.parse(selected.recorded_at) +
                  Date.parse(next.recorded_at)) /
                  2,
              ).toISOString(),
              after_id: selected.id,
              before_id: next.id,
              accuracy_meters: null,
              speed_mps: null,
              heading_degrees: null,
              altitude_meters: null,
            }
            change([
              ...draft.slice(0, index + 1),
              point,
              ...draft.slice(index + 1),
            ])
            setInserting(false)
            setSelectedId(point.id)
          }}
        />
        <Button
          className="absolute right-2 top-2 z-10 min-h-11 bg-background shadow-sm md:hidden"
          variant="outline"
          disabled={busy}
          aria-expanded={mapExpanded}
          onClick={() => {
            setMapExpanded(value => !value)
            requestAnimationFrame(() => mapContainer.current?.scrollIntoView({ block: 'start' }))
          }}
        >
          {mapExpanded ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />}
          {mapExpanded ? 'Compact map' : 'Expand map'}
        </Button>
        </div>
        <section aria-label="Recording timeline" className="mt-3 shrink-0 space-y-1">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-medium">Timeline</h3>
            <Button
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={() => {
                setRange([minTime, maxTime])
                setSelectedId(selectedId || draft[0]?.id || '')
                setNotice('')
                setInserting(false)
              }}
            >
              Whole session
            </Button>
          </div>
          <TimeRangeSlider
            min={minTime}
            max={maxTime}
            value={range}
            disabled={busy}
            onChange={(value) => {
              setRange(value)
              setNotice('')
              setInserting(false)
              const focused = draft.find(p => p.id === selectedId)
              if (focused && Date.parse(focused.recorded_at) >= value[0] && Date.parse(focused.recorded_at) <= value[1]) return
              const first = draft.find(
                (p) =>
                  Date.parse(p.recorded_at) >= value[0] &&
                  Date.parse(p.recorded_at) <= value[1],
              )
              setSelectedId(first?.id ?? '')
            }}
          />
          <p className="text-xs text-muted-foreground">
            {visible.length} of {draft.length} points in view. Other times are faded to separate overlapping routes.
          </p>
        </section>
        <p role="status" className="mt-2 text-xs text-muted-foreground">
          {insertion
            ? `Tap inside the highlighted circle to insert a point (within ${Math.round(insertionArea(coordinates(insertion[0]), coordinates(insertion[1])).radius)} m of its centre).`
            : notice || (tool === 'point' ? 'Tap a point, then drag its handle inside the highlighted area to move it.' : 'Apply a transport type to the points in this timeline window.')}
        </p>
          </div>
          <aside className="space-y-4 border-t border-border p-3 md:overflow-y-auto md:border-l md:border-t-0 md:p-4">
            <div className="grid grid-cols-2 gap-1 rounded-xl bg-muted p-1" role="group" aria-label="Editing tools">
              <Button variant={tool === 'point' ? 'default' : 'ghost'} aria-pressed={tool === 'point'} disabled={busy} onClick={() => { setTool('point'); setInserting(false) }}>Edit point</Button>
              <Button variant={tool === 'transport' ? 'default' : 'ghost'} aria-pressed={tool === 'transport'} disabled={busy} onClick={() => { setTool('transport'); setInserting(false); setNotice('') }}>Bulk transport</Button>
            </div>

            {tool === 'transport' && (
              <section className="space-y-3">
                <h3 className="font-semibold">Transport for {visible.length} points</h3>
                <p className="text-sm text-muted-foreground">Use the timeline to focus on part of the recording, then apply a transport type to all points in view.</p>
                <Select ariaLabel="Bulk transport type" value={bulkMode} options={TRAVEL_MODE_OPTIONS} disabled={busy || !visible.length} onValueChange={setBulkMode} />
                <Button className="w-full" disabled={busy || !bulkChangeCount} onClick={() => {
                  change(draft.map(p => bulkIds.has(p.id) ? { ...p, travel_mode: bulkMode } : p))
                  setNotice(`Transport updated for ${bulkChangeCount} points. Save changes to finish.`)
                }}>Apply to {visible.length} points</Button>
                <p className="text-xs text-muted-foreground">Transport describes travel arriving at each point. Undo restores the entire batch before saving.</p>
              </section>
            )}
            <div hidden={tool !== 'point'} className="space-y-4">
          <section className="space-y-3">
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                disabled={busy || visibleIndex <= 0}
                onClick={() => select(visible[visibleIndex - 1].id)}
              >
                Previous
              </Button>
              <label className="text-sm">
                Point{' '}
                <input
                  aria-label="Point number"
                  className="w-16 rounded border border-input bg-background p-2"
                  type="number"
                  min={1}
                  max={visible.length}
                  value={visibleIndex < 0 ? '' : visibleIndex + 1}
                  disabled={busy}
                  onChange={(e) => {
                    const p = visible[Number(e.target.value) - 1]
                    if (p) select(p.id)
                  }}
                />
              </label>
              <Button
                variant="outline"
                disabled={busy || !next}
                onClick={() => select(next.id)}
              >
                Next
              </Button>
            </div>

            {!visible.length && <p>No points in this time range.</p>}
          </section>
          {selected && (
            <section className="space-y-3">
              <h3 className="text-sm font-medium">Transport type</h3>
              <Select
                ariaLabel="Point travel mode"
                value={selected.travel_mode}
                options={TRAVEL_MODE_OPTIONS}
                disabled={busy}
                onValueChange={(mode) => {
                  if (!busy && mode !== selected.travel_mode)
                    change(
                      draft.map((p) =>
                        p.id === selected.id
                          ? { ...p, travel_mode: mode as TravelMode }
                          : p,
                      ),
                    )
                }}
              />
              <p className="text-xs text-muted-foreground">
                The mode describes travel arriving at this point.
              </p>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  disabled={
                    busy ||
                    !next ||
                    Date.parse(next.recorded_at) -
                      Date.parse(selected.recorded_at) <
                      2
                  }
                  onClick={() => setInserting((v) => !v)}
                >
                  {inserting ? 'Cancel insertion' : 'Insert after point'}
                </Button>
                <Button
                  variant="destructive"
                  disabled={
                    busy ||
                    draft.some(
                      (p) =>
                        p.after_id === selected.id ||
                        p.before_id === selected.id,
                    )
                  }
                  onClick={() => {
                    change(draft.filter((p) => p.id !== selected.id))
                    select(next?.id ?? visible[visibleIndex - 1]?.id ?? '')
                  }}
                >
                  Delete point
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Point deletion and successive insertions can be undone before
                saving.
              </p>
            </section>
          )}
        </div>
        <div hidden={tool !== 'point'}>
            <details><summary className="cursor-pointer py-2 text-sm text-muted-foreground">Browse point list</summary>
            <ul className="max-h-52 overflow-auto divide-y divide-border">
              {visible
                .slice(
                  Math.max(0, visibleIndex - 10),
                  Math.max(0, visibleIndex - 10) + 25,
                )
                .map((p) => (
                  <li key={p.id}>
                    <button
                      disabled={busy}
                      className={`min-h-11 w-full px-2 py-3 text-left text-sm ${p.id === selectedId ? 'bg-primary/15 font-semibold' : ''}`}
                      aria-pressed={p.id === selectedId}
                      onClick={() => select(p.id)}
                    >
                      {new Date(p.recorded_at).toLocaleTimeString()} ·{' '}
                      {p.latitude.toFixed(5)}, {p.longitude.toFixed(5)} ·{' '}
                      {p.travel_mode}
                    </button>
                  </li>
                ))}
            </ul></details>
        </div>
        {sessions.length > 1 && (
          <details className="border-t border-border pt-3">
            <summary className="cursor-pointer font-semibold">
              Other recordings on the map
            </summary>
            <p className="mt-2 text-xs text-muted-foreground">
              Optional reference paths. Only this session's selected time range
              is editable.
            </p>
            <ul className="mt-2 max-h-48 overflow-auto">
              {sessions
                .filter((s) => s.id !== session.id)
                .map((s) => (
                  <li key={s.id}>
                    <label className="flex min-h-11 items-center gap-3 text-sm">
                      <input
                        type="checkbox"
                        checked={visibleReferences.includes(s.id)}
                        disabled={busy || loadingReference !== null}
                        onChange={() => void toggleReference(s.id)}
                      />
                      <span
                        className="size-3 rounded-full"
                        style={{
                          backgroundColor:
                            SESSION_COLORS[
                              sessions.indexOf(s) % SESSION_COLORS.length
                            ],
                        }}
                      />
                      <span>
                        {new Date(s.started_at).toLocaleString()}
                        {loadingReference === s.id ? ' · Loading…' : ''}
                      </span>
                    </label>
                  </li>
                ))}
            </ul>
          </details>
        )}
          </aside>
        </div>
        <footer className="shrink-0 border-t border-border bg-background px-4 pt-3 pb-[max(.75rem,env(safe-area-inset-bottom))]">
          {error && <p role="alert" className="mb-2 text-sm text-destructive">{error}</p>}
          <div className="flex items-center justify-between gap-2">
            <Button
              variant="outline"
              disabled={!dirty || busy}
              onClick={() => {
                const previous = history[history.length - 1]
                setDraft(previous)
                if (!previous.some(p => p.id === selectedId)) {
                  setSelectedId(previous.find(p => Date.parse(p.recorded_at) >= range[0] && Date.parse(p.recorded_at) <= range[1])?.id ?? '')
                }
                setNotice('')
                setHistory((h) => h.slice(0, -1))
                setInserting(false)
              }}
            >
              Undo
            </Button>

            <span className="hidden text-xs text-muted-foreground sm:block">{dirty ? 'Unsaved changes' : 'All changes saved'}</span>
            <Button disabled={!dirty || busy} onClick={() => void save()}>{busy ? 'Saving…' : 'Save changes'}</Button>
          </div>
        </footer>
        {confirmLeave && (
          <TrackingConfirmation
            title="Discard point changes?"
            description="Discard unsaved changes? Your saved recording will stay as it is."
            confirmLabel="Discard changes"
            cancelLabel="Keep editing"
            destructive
            onCancel={() => setConfirmLeave(false)}
            onConfirm={onBack}
          />
        )}
      </div>
    </div>,
    document.body,
  )
}
