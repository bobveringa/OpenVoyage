import { Map } from 'lucide-react'

import { PlaceholderPage } from '@/pages/placeholder-page'

type TripDetailPageProps = {
  tripId: string
}

export function TripDetailPage({ tripId }: TripDetailPageProps) {
  return (
    <PlaceholderPage
      description={`Trip ${tripId} will get the plan, travel, and map views next.`}
      icon={Map}
      title="Trip page"
    />
  )
}
