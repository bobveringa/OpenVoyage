import type { LucideIcon } from 'lucide-react'
import { Construction } from 'lucide-react'

import { EmptyState } from '@/components/ui/empty-state'

type PlaceholderPageProps = {
  description?: string
  icon?: LucideIcon
  title: string
}

export function PlaceholderPage({
  description,
  icon = Construction,
  title,
}: PlaceholderPageProps) {
  return (
    <div className="py-8 sm:py-10">
      <EmptyState description={description} icon={icon} title={title} />
    </div>
  )
}
