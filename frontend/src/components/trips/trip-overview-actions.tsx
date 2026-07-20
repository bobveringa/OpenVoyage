import { Plus } from 'lucide-react'

import { Button } from '@/components/ui/button'

type TripOverviewActionsProps = {
  canCreate: boolean
  onCreateTrip: () => void
}

export function TripOverviewActions({
  canCreate,
  onCreateTrip,
}: TripOverviewActionsProps) {
  if (!canCreate) {
    return null
  }

  return (
    <div className="flex justify-end">
      <Button className="w-full sm:w-auto" onClick={onCreateTrip} type="button">
        <Plus className="size-4" aria-hidden="true" />
        Create trip
      </Button>
    </div>
  )
}
