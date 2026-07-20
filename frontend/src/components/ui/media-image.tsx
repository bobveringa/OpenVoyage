import { ImageIcon } from 'lucide-react'
import { useState, type ReactNode } from 'react'

import type { Media } from '@/api/client'
import { cn } from '@/lib/utils'

type MediaImageProps = {
  alt: string
  className?: string
  fallback?: ReactNode
  media: Media | null | undefined
}

export function MediaImage({
  alt,
  className,
  fallback,
  media,
}: MediaImageProps) {
  const [failed, setFailed] = useState(false)
  const source = media?.urls.thumbnail ?? media?.urls.content ?? null

  if (!source || failed) {
    return (
      <div
        className={cn(
          'grid place-items-center overflow-hidden bg-secondary text-secondary-foreground',
          className,
        )}
      >
        {fallback ?? <ImageIcon className="size-6" aria-hidden="true" />}
      </div>
    )
  }

  return (
    <img
      alt={alt}
      className={cn('block object-cover', className)}
      src={source}
      onError={() => setFailed(true)}
    />
  )
}
