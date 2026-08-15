import { X } from 'lucide-react'
import { useEffect, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { cn } from '@/lib/utils'

type ModalProps = {
  children: ReactNode
  className?: string
  contentClassName?: string
  description?: string
  fullscreenOnMobile?: boolean
  onClose: () => void
  open: boolean
  title: string
}

export function Modal({
  children,
  className,
  contentClassName,
  description,
  fullscreenOnMobile = false,
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
      className={cn(
        'fixed inset-0 z-50 grid place-items-center bg-foreground/35 backdrop-blur-md',
        fullscreenOnMobile ? 'p-0 sm:p-4' : 'p-4',
      )}
      role="dialog"
    >
      <div
        className={cn(
          'grid w-full grid-rows-[auto_minmax(0,1fr)] overflow-hidden border border-border bg-card shadow-soft',
          fullscreenOnMobile
            ? 'h-dvh max-w-none sm:h-[min(44rem,calc(100dvh-2rem))] sm:max-w-2xl sm:rounded-2xl'
            : 'h-[min(44rem,calc(100dvh-2rem))] max-w-2xl rounded-2xl',
          className,
        )}
      >
        <div className="flex items-start justify-between gap-4 border-b border-border bg-card p-5">
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
        <ScrollArea className={cn('m-2 min-h-0 rounded-xl px-3 py-3', contentClassName)}>
          {children}
        </ScrollArea>
      </div>
    </div>,
    document.body,
  )
}
