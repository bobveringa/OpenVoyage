import { X } from 'lucide-react'
import { useEffect, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'

type ModalProps = {
  children: ReactNode
  description?: string
  onClose: () => void
  open: boolean
  title: string
}

export function Modal({
  children,
  description,
  onClose,
  open,
  title,
}: ModalProps) {
  useEffect(() => {
    if (!open) {
      return undefined
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        onClose()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose, open])

  if (!open) {
    return null
  }

  return createPortal(
    <div
      aria-modal="true"
      className="fixed inset-0 z-50 grid place-items-center bg-slate-950/35 p-4 backdrop-blur-md"
      role="dialog"
    >
      <div className="grid h-[min(44rem,calc(100vh-2rem))] w-full max-w-2xl grid-rows-[auto_minmax(0,1fr)] overflow-hidden rounded-2xl border border-emerald-100 bg-white shadow-soft">
        <div className="flex items-start justify-between gap-4 border-b border-emerald-100 bg-white p-5">
          <div className="space-y-1">
            <h2 className="text-xl font-semibold tracking-normal text-popover-foreground">
              {title}
            </h2>
            {description ? (
              <p className="text-sm text-muted-foreground">{description}</p>
            ) : null}
          </div>
          <Button
            aria-label="Close"
            onClick={onClose}
            size="icon"
            type="button"
            variant="ghost"
          >
            <X className="size-4" aria-hidden="true" />
          </Button>
        </div>
        <ScrollArea className="m-2 min-h-0 rounded-xl px-3 py-3">
          {children}
        </ScrollArea>
      </div>
    </div>,
    document.body,
  )
}
