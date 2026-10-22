import { useEffect, useRef } from 'react'
import { Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Modal } from '@/components/ui/modal'
import { resolveConnectionEndpoint } from './connection-endpoints'
import type { Stop, Connection } from './models'
import { getTravelModeLabel } from './shared-utils'

export function ConnectionRemovalDialog({ connection, stops, removing, error, onCancel, onConfirm }: {
  connection: Connection | null
  stops: readonly Stop[]
  removing: boolean
  error: string | null
  onCancel: () => void
  onConfirm: () => void
}) {
  const contentRef = useRef<HTMLDivElement>(null)
  const keepRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (!connection) return
    const previousFocus = document.activeElement
    const dialog = contentRef.current?.closest('[role="dialog"]')
    keepRef.current?.focus()
    function trapFocus(event: Event) {
      const key = event as KeyboardEvent
      if (key.key !== 'Tab') return
      const buttons = [...dialog?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? []]
      const first = buttons[0]
      const last = buttons[buttons.length - 1]
      if (key.shiftKey && document.activeElement === first) { key.preventDefault(); last?.focus() }
      else if (!key.shiftKey && document.activeElement === last) { key.preventDefault(); first?.focus() }
    }
    dialog?.addEventListener('keydown', trapFocus)
    return () => {
      dialog?.removeEventListener('keydown', trapFocus)
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus()
    }
  }, [connection])
  if (!connection) return null
  const label = connection.connection_type === 'DEPARTURE' ? 'departure' : 'return'
  const from = resolveConnectionEndpoint(connection.from, stops)
  const to = resolveConnectionEndpoint(connection.to, stops)
  return <Modal open title={'Remove ' + label + '?'} onClose={onCancel} dismissible={!removing}
    className="h-auto max-h-[calc(100dvh-2rem)] max-w-md" overlayClassName="z-[80]"
    description="This removes the connection and its travel details. Your itinerary stops will stay."
    footer={<div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
      <Button ref={keepRef} disabled={removing} variant="outline" type="button" onClick={onCancel}>Keep {label}</Button>
      <Button disabled={removing} variant="destructive" type="button" onClick={onConfirm}>
        <Trash2 className="size-4" aria-hidden="true" />{removing ? 'Removing...' : 'Remove ' + label}
      </Button>
    </div>}>
    <div ref={contentRef} className="space-y-3">
      <div className="space-y-1 rounded-xl bg-muted p-3">
        <p className="break-words font-semibold">{from?.title} → {to?.title}</p>
        <p className="break-words text-sm text-muted-foreground">{connection.segments.map((segment) => [
          getTravelModeLabel(segment.intent.travel_mode), segment.intent.flight?.flight_number || segment.intent.service_number,
        ].filter(Boolean).join(' · ')).join(' → ')}</p>
      </div>
      {removing ? <p role="status" className="text-sm text-muted-foreground">Removing {label}...</p> : null}
      {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
    </div>
  </Modal>
}
