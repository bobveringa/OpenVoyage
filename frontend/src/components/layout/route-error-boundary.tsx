import { Component, type ErrorInfo, type ReactNode } from 'react'

import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'

type RouteErrorBoundaryProps = {
  children: ReactNode
}

type RouteErrorBoundaryState = {
  error: Error | null
}

// Route chunks are code-split (see App.tsx), so a stale deploy or a flaky
// network can make the dynamic import() itself reject. Without a boundary
// here that throw has nowhere to land and the whole app goes blank.
//
// Render with `key={route.name}` at the call site: JSX children are a new
// object on every render, so comparing them can't tell "the route changed"
// apart from "an unrelated re-render happened" — remounting on route change
// is what actually clears a stale error when navigation moves on.
export class RouteErrorBoundary extends Component<
  RouteErrorBoundaryProps,
  RouteErrorBoundaryState
> {
  state: RouteErrorBoundaryState = { error: null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Route failed to render', error, errorInfo)
  }

  render() {
    if (this.state.error) {
      return (
        <div className="py-8 sm:py-10">
          <EmptyState
            action={
              <Button onClick={() => window.location.reload()} type="button">
                Reload
              </Button>
            }
            description="Something went wrong loading this page. Reloading usually fixes it."
            title="Unable to load page"
          />
        </div>
      )
    }

    return this.props.children
  }
}
