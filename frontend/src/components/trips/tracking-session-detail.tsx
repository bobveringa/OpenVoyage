import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
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
import { insertDistanceLimit } from '@/tracking/edit-geometry'
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
  const index = draft.findIndex((p) => p.id === selectedId)
  const visibleIndex = visible.findIndex((p) => p.id === selectedId)
  const selected = visible[visibleIndex]
  const next = visible[visibleIndex + 1]
  const origin = initial.find((p) => p.id === selectedId)
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
      className="fixed inset-0 z-[60] overflow-y-auto bg-background pb-[max(1rem,env(safe-area-inset-bottom))]"
      role="dialog"
      aria-modal="true"
      aria-label="Recording details"
    >
      <div className="mx-auto max-w-7xl space-y-4 px-3 sm:px-8">
        <header className="sticky top-0 z-20 -mx-3 flex flex-wrap items-center justify-between gap-3 border-b border-border bg-background px-3 pb-3 pt-[max(1rem,env(safe-area-inset-top))] sm:-mx-8 sm:px-8">
          <div>
            <Button variant="ghost" disabled={busy} onClick={back}>
              ← Recordings
            </Button>
            <h2 className="text-xl font-semibold">
              Session · {new Date(session.started_at).toLocaleString()}
            </h2>
          </div>
          <div className="flex flex-wrap gap-2">
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
            <Button
              variant="outline"
              disabled={!dirty || busy}
              onClick={() => setConfirmLeave(true)}
            >
              Discard
            </Button>
            <Button disabled={!dirty || busy} onClick={() => void save()}>
              {busy ? 'Saving…' : 'Save changes'}
            </Button>
          </div>
        </header>
        <p className="text-sm text-muted-foreground">
          Select a point, then drag its handle. Moves are limited to 400 m from
          the last saved position. Other sessions are reference paths only.
          Changes stay local until saved.
        </p>
        {error && (
          <p role="alert" className="text-destructive">
            {error}
          </p>
        )}
        <section className="space-y-2 rounded-xl border border-border bg-card p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="font-semibold">Editing time range</h3>
            <Button
              variant="ghost"
              disabled={busy}
              onClick={() => {
                setRange([minTime, maxTime])
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
              const first = draft.find(
                (p) =>
                  Date.parse(p.recorded_at) >= value[0] &&
                  Date.parse(p.recorded_at) <= value[1],
              )
              setSelectedId(first?.id ?? '')
            }}
          />
          <p className="text-xs text-muted-foreground">
            {visible.length} of {draft.length} points in range. Only these
            points can be selected or edited. The full session trace remains
            visible on the map.
          </p>
        </section>
        <TrackingSessionMap
          paths={displayPaths}
          editablePoints={visible}
          selectedSessionId={session.id}
          selectedPoint={selected}
          origin={origin}
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
              id: crypto.randomUUID(),
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
        <p role="status" className="min-h-6 text-sm">
          {insertion
            ? `Tap inside the green area to insert a point (within ${Math.round(insertDistanceLimit(coordinates(insertion[0]), coordinates(insertion[1])))} m of this segment).`
            : notice}
        </p>
        <div className="grid gap-4 lg:grid-cols-2">
          <section className="space-y-3 rounded-xl border border-border p-4">
            <h3 className="font-semibold">
              Points in range ({visible.length})
            </h3>
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
                  className="w-20 rounded border border-input bg-background p-2"
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
            </ul>
            {!visible.length && <p>No points in this time range.</p>}
          </section>
          {selected && (
            <section className="space-y-3 rounded-xl border border-border p-4">
              <h3 className="font-semibold">Edit selected point</h3>
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
                    Boolean(selected.after_id || next.after_id) ||
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
              {selected.after_id && (
                <p className="text-sm text-muted-foreground">
                  Save this inserted point before moving it or inserting beside
                  it.
                </p>
              )}
              <p className="text-xs text-muted-foreground">
                Point deletion can be undone before saving. Save between
                successive insertions on the same segment.
              </p>
            </section>
          )}
        </div>
        {sessions.length > 1 && (
          <details className="rounded-xl border border-border bg-card p-4">
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
