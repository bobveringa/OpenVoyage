import { X } from 'lucide-react'
import { useEffect, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { cn } from '@/lib/utils'

type ModalProps = {
  children: ReactNode
  bottomSheetOnMobile?: boolean
  className?: string
  contentClassName?: string
  description?: string
  dismissible?: boolean
  footer?: ReactNode
  fullscreenOnMobile?: boolean
  onClose: () => void
  open: boolean
  title: ReactNode
  toolbar?: ReactNode
}

export function Modal({
  bottomSheetOnMobile = false,
  children,
  className,
  contentClassName,
  description,
  dismissible = true,
  footer,
  fullscreenOnMobile = false,
  onClose,
  open,
  title,
  toolbar,
}: ModalProps) {
  useEffect(() => {
    if (!open || !dismissible) {
      return undefined
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        onClose()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [dismissible, onClose, open])

  if (!open) {
    return null
  }

  return createPortal(
    <div
      aria-modal="true"
      className={cn(
        'fixed inset-0 z-50 grid place-items-center bg-foreground/35 backdrop-blur-md',
        bottomSheetOnMobile
          ? 'items-end p-0 sm:items-center sm:p-4'
          : fullscreenOnMobile
            ? 'p-0 sm:p-4'
            : 'p-4',
      )}
      role="dialog"
    >
      <div
        className={cn(
          'grid w-full overflow-hidden border border-border bg-card shadow-soft',
          toolbar && footer
            ? 'grid-rows-[auto_auto_minmax(0,1fr)_auto]'
            : toolbar
              ? 'grid-rows-[auto_auto_minmax(0,1fr)]'
              : footer
                ? 'grid-rows-[auto_minmax(0,1fr)_auto]'
                : 'grid-rows-[auto_minmax(0,1fr)]',
          fullscreenOnMobile
            ? 'h-dvh max-w-none sm:h-[min(44rem,calc(100dvh-2rem))] sm:max-w-2xl sm:rounded-2xl'
            : bottomSheetOnMobile
              ? 'h-auto max-h-[calc(100dvh-1rem)] max-w-none rounded-t-2xl sm:max-h-[min(28rem,calc(100dvh-2rem))] sm:max-w-md sm:rounded-2xl'
              : 'h-[min(44rem,calc(100dvh-2rem))] max-w-2xl rounded-2xl',
          className,
        )}
      >
        <div
          className={cn(
            'flex items-start justify-between gap-4 border-b border-border bg-card',
            fullscreenOnMobile
              ? 'px-5 pb-5 pt-[max(1.25rem,var(--app-safe-area-inset-top))] sm:p-5'
              : 'p-5',
          )}
        >
          <div className="space-y-1">
            <h2 className="text-xl font-semibold tracking-normal text-popover-foreground">
              {title}
            </h2>
            {description ? (
              <p className="text-sm text-muted-foreground">{description}</p>
            ) : null}
          </div>
          {dismissible ? (
            <Button
              aria-label="Close"
              onClick={onClose}
              size="icon"
              type="button"
              variant="ghost"
            >
              <X className="size-4" aria-hidden="true" />
            </Button>
          ) : null}
        </div>
        {toolbar ? (
          <div className="border-b border-border bg-card px-5 py-3 shadow-sm">
            {toolbar}
          </div>
        ) : null}
        <ScrollArea className={cn('m-2 min-h-0 rounded-xl px-3 py-3', contentClassName)}>
          {children}
        </ScrollArea>
        {footer ? (
          <div className="border-t border-border bg-card px-5 pb-[max(1rem,var(--app-safe-area-inset-bottom))] pt-3 sm:pb-4">
            {footer}
          </div>
        ) : null}
      </div>
    </div>,
    document.body,
  )
}
