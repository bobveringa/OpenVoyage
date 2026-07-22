import { useState, type FormEvent } from 'react'
import { Database, ShieldAlert } from 'lucide-react'

import {
  getErrorMessage,
  importPlaces,
  type CurrentUser,
  type PlaceImportDataset,
} from '@/api/client'
import type { AuthStatus } from '@/auth/auth-context'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { LoadingState } from '@/components/ui/empty-state'
import { Select, type SelectOption } from '@/components/ui/select'
import { PlaceholderPage } from '@/pages/placeholder-page'

type AdminPageProps = {
  accessToken: string | null
  authStatus: AuthStatus
  currentUser: CurrentUser | null
}

type ImportStatus =
  | {
      message: string
      type: 'error'
    }
  | {
      message: string
      type: 'success'
    }

const placeDatasetOptions = [
  {
    label: 'Cities 500',
    value: 'cities500',
  },
  {
    label: 'All countries',
    value: 'allCountries',
  },
] as const satisfies ReadonlyArray<SelectOption<PlaceImportDataset>>

const placeDatasetDescriptions: Record<PlaceImportDataset, string> = {
  allCountries: 'Full GeoNames place coverage.',
  cities500: 'Cities and settlements with at least 500 residents.',
}

const numberFormatter = new Intl.NumberFormat()

export function AdminPage({
  accessToken,
  authStatus,
  currentUser,
}: AdminPageProps) {
  const [dataset, setDataset] = useState<PlaceImportDataset>('cities500')
  const [importStatus, setImportStatus] = useState<ImportStatus | null>(null)
  const [isImporting, setIsImporting] = useState(false)

  if (authStatus === 'loading') {
    return <LoadingState label="Checking access" />
  }

  if (currentUser?.role !== 'ADMIN') {
    return (
      <PlaceholderPage
        description="This area is only available to admin users."
        icon={ShieldAlert}
        title="Admin access required"
      />
    )
  }

  async function handleImportPlaces(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (!accessToken || isImporting) {
      return
    }

    setIsImporting(true)
    setImportStatus(null)

    try {
      const result = await importPlaces({ dataset }, accessToken)
      setImportStatus({
        message: `Processed ${numberFormatter.format(result.processed)} places from ${getPlaceDatasetLabel(result.dataset)}.`,
        type: 'success',
      })
    } catch (error) {
      setImportStatus({
        message: getErrorMessage(error),
        type: 'error',
      })
    } finally {
      setIsImporting(false)
    }
  }

  return (
    <div className="space-y-6 py-6 sm:py-8 lg:py-10">
      <div className="space-y-2">
        <p className="text-sm font-semibold uppercase tracking-wide text-primary">
          Admin
        </p>
        <div className="space-y-1">
          <h1 className="text-3xl font-semibold tracking-normal text-foreground">
            Operations
          </h1>
          <p className="max-w-2xl text-sm leading-6 text-muted-foreground">
            Run maintenance tasks for shared travel data.
          </p>
        </div>
      </div>

      <Card className="max-w-2xl">
        <CardHeader>
          <div className="flex items-start gap-4">
            <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-emerald-50 text-primary shadow-sm">
              <Database className="size-5" aria-hidden="true" />
            </span>
            <div className="space-y-1">
              <CardTitle>Places import</CardTitle>
              <CardDescription>
                Refresh the place search dataset from GeoNames.
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <form className="grid gap-5" onSubmit={handleImportPlaces}>
            <div className="grid gap-2">
              <label
                className="text-sm font-medium text-foreground"
                htmlFor="admin-place-dataset"
              >
                Dataset
              </label>
              <Select
                disabled={isImporting}
                id="admin-place-dataset"
                onValueChange={(nextDataset) => {
                  setDataset(nextDataset)
                  setImportStatus(null)
                }}
                options={placeDatasetOptions}
                value={dataset}
              />
              <p className="text-xs leading-5 text-muted-foreground">
                {placeDatasetDescriptions[dataset]}
              </p>
            </div>

            {importStatus ? (
              <p
                className={
                  importStatus.type === 'success'
                    ? 'rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-medium text-primary'
                    : 'rounded-xl border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive'
                }
                role={importStatus.type === 'error' ? 'alert' : 'status'}
              >
                {importStatus.message}
              </p>
            ) : null}

            <div className="flex justify-end">
              <Button disabled={!accessToken || isImporting} type="submit">
                <Database className="size-4" aria-hidden="true" />
                {isImporting ? 'Importing' : 'Import places'}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}

function getPlaceDatasetLabel(dataset: PlaceImportDataset) {
  return (
    placeDatasetOptions.find((option) => option.value === dataset)?.label ??
    dataset
  )
}
