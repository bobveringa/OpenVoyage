import { X } from 'lucide-react'
import { useContext, useEffect, useId, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

import { Button } from '@/components/ui/button'
import { Modal } from '@/components/ui/modal'
import { ScrollArea } from '@/components/ui/scroll-area'
import { PlanningSessionContext } from './planning-session'

export function RouteChooserShell({ children, desktop, description, footer, onClose, open }: {
  children: ReactNode
  desktop: boolean
  description: string
  footer: ReactNode
  onClose: () => void
  open: boolean
}) {
  const titleId = useId()
  const { panelHost, onPanelOpenChange } = useContext(PlanningSessionContext)
  useEffect(() => {
    onPanelOpenChange(desktop && open)
    return () => onPanelOpenChange(false)
  }, [desktop, open, onPanelOpenChange])

  useEffect(() => {
    if (!desktop || !open) return
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [desktop, onClose, open])

  if (!desktop) return (
    <Modal fullscreenOnMobile open={open} onClose={onClose}
      className="sm:max-w-6xl sm:h-[min(54rem,calc(100dvh-2rem))]"
      contentClassName="m-0 rounded-none p-0" title="Select your route"
      description={description} footer={footer}>
      {children}
    </Modal>
  )

  if (!open || !panelHost) return null
  return createPortal(
    <section aria-labelledby={titleId} className="grid h-full min-h-0 min-w-0 grid-cols-1 grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden rounded-2xl border border-border bg-card shadow-soft">
      <header className="flex items-start justify-between gap-3 border-b border-border p-4">
        <div className="space-y-1">
          <h2 id={titleId} className="text-lg font-semibold">Select your route</h2>
          <p className="text-sm text-muted-foreground">{description}</p>
        </div>
        <Button aria-label="Close route chooser" size="icon" variant="ghost" onClick={onClose}><X className="size-4" /></Button>
      </header>
      <ScrollArea className="min-h-0 min-w-0">{children}</ScrollArea>
      <footer className="border-t border-border bg-card p-4">{footer}</footer>
    </section>, panelHost,
  )
}
