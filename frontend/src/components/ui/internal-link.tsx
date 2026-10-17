import type { ComponentProps } from 'react'

// Preserve the app and native tracking context when following a local link.
export function InternalLink({
  href,
  onClick,
  navigationState = null,
  ...props
}: ComponentProps<'a'> & {
  href: string
  navigationState?: Record<string, unknown> | (() => Record<string, unknown>) | null
}) {
  return (
    <a
      {...props}
      href={href}
      onClick={(event) => {
        onClick?.(event)
        if (
          event.defaultPrevented ||
          event.button !== 0 ||
          event.ctrlKey ||
          event.metaKey ||
          event.shiftKey ||
          event.altKey ||
          (props.target && props.target !== '_self') ||
          props.download !== undefined
        )
          return
        const next = new URL(href, window.location.href)
        if (next.origin !== window.location.origin) return
        event.preventDefault()
        const previous = window.location.href
        window.history.pushState(
          typeof navigationState === 'function' ? navigationState() : navigationState,
          '',
          next.pathname + next.search + next.hash,
        )
        window.dispatchEvent(new PopStateEvent('popstate'))
        if (new URL(previous).hash !== next.hash) {
          window.dispatchEvent(
            new HashChangeEvent('hashchange', {
              oldURL: previous,
              newURL: next.href,
            }),
          )
        }
      }}
    />
  )
}
