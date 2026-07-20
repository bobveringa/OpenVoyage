import { Settings } from 'lucide-react'

import { PlaceholderPage } from '@/pages/placeholder-page'

export function SetupPage() {
  return (
    <PlaceholderPage
      description="First-time setup will be added in a later pass."
      icon={Settings}
      title="Setup"
    />
  )
}
