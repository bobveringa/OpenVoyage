import { useEffect, useRef } from 'react'
import { AlertTriangle } from 'lucide-react'
import type { ConnectionDeletionSummary } from '@/api/client'
import { Button } from '@/components/ui/button'
import { Modal } from '@/components/ui/modal'

export function ConnectionDeletionDialog({ connections, onCancel, onConfirm }: {
  connections: ConnectionDeletionSummary[] | null
  onCancel: () => void
  onConfirm: () => void
}) {
  const contentRef = useRef<HTMLDivElement>(null)
  const cancelRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (!connections) return
    const previousFocus = document.activeElement
    const dialog = contentRef.current?.closest('[role="dialog"]')
    cancelRef.current?.focus()
    function handleKey(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        // Keep Escape from also closing an underlying stop editor.
        event.preventDefault()
        event.stopImmediatePropagation()
        onCancel()
      }
      if (event.key !== 'Tab') return
      const buttons = [...dialog?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? []]
      const first = buttons[0]
      const last = buttons[buttons.length - 1]
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
    }
    window.addEventListener('keydown', handleKey, true)
    return () => {
      window.removeEventListener('keydown', handleKey, true)
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus()
    }
  }, [connections, onCancel])

  return <Modal open={connections !== null} title="Discard travel details?" onClose={onCancel}
    description="This change removes the saved travel details for these connections."
    className="h-auto max-h-[calc(100dvh-2rem)] max-w-md" overlayClassName="z-[80]"
    footer={<div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
      <Button ref={cancelRef} type="button" variant="outline" onClick={onCancel}>Cancel</Button>
      <Button type="button" variant="destructive" onClick={onConfirm}>Discard and continue</Button>
    </div>}>
    <div ref={contentRef} className="space-y-3">
      <AlertTriangle className="size-6 text-destructive" aria-hidden="true" />
      <ul className="space-y-2 rounded-xl bg-muted p-3">
        {connections?.map((connection, index) => <li key={index} className="break-words font-semibold">
          {connection.from} → {connection.to}
        </li>)}
      </ul>
      <p className="text-sm text-muted-foreground">Cancel to keep your current itinerary and travel details.</p>
    </div>
  </Modal>
}
