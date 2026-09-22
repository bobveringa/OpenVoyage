import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { Button } from './button'

type Props = {
  title: string
  description: string
  confirmLabel: string
  cancelLabel?: string
  destructive?: boolean
  busy?: boolean
  error?: string | null
  onCancel: () => void
  onConfirm: () => void
}

export function TrackingConfirmation({
  title,
  description,
  confirmLabel,
  cancelLabel = 'Cancel',
  destructive,
  busy,
  error,
  onCancel,
  onConfirm,
}: Props) {
  const root = useRef<HTMLDivElement>(null)
  const cancel = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    cancel.current?.focus()
    return () => previous?.focus()
  }, [])
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopImmediatePropagation()
        if (!busy) onCancel()
      }
      if (event.key === 'Tab') {
        const buttons = [
          ...(root.current?.querySelectorAll<HTMLButtonElement>(
            'button:not(:disabled)',
          ) ?? []),
        ]
        const first = buttons[0],
          last = buttons[buttons.length - 1]
        if (!first) {
          event.preventDefault()
          return
        }
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault()
          last.focus()
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault()
          first.focus()
        }
      }
    }
    window.addEventListener('keydown', keydown, true)
    return () => window.removeEventListener('keydown', keydown, true)
  }, [busy, onCancel])
  return createPortal(
    <div
      ref={root}
      role="alertdialog"
      aria-modal="true"
      aria-label={title}
      className="fixed inset-0 z-[70] grid place-items-center bg-black/40 p-4"
    >
      <div className="max-w-md space-y-4 rounded-xl border border-border bg-card p-6 text-card-foreground shadow-soft">
        <h3 className="font-semibold">{title}</h3>
        <p>{description}</p>
        {error && <p role="alert" className="text-destructive">{error}</p>}
        <div className="flex flex-wrap gap-2">
          <Button
            ref={cancel}
            disabled={busy}
            variant="outline"
            onClick={onCancel}
          >
            {cancelLabel}
          </Button>
          <Button
            disabled={busy}
            variant={destructive ? 'destructive' : 'default'}
            onClick={onConfirm}
          >
            {busy ? 'Working…' : confirmLabel}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
