import { Database, Info } from 'lucide-react'
import { useState, type FormEvent } from 'react'

import {
  getErrorMessage,
  importPlaces,
  type PlaceImportDataset,
} from '@/api/client'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Select, type SelectOption } from '@/components/ui/select'

type PlaceImportPanelProps = {
  accessToken: string | null
}

type ImportStatus = {
  message: string
  type: 'error' | 'success'
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
  allCountries: 'Full GeoNames place coverage. This is the largest import.',
  cities500: 'Cities and settlements with at least 500 residents.',
}

const numberFormatter = new Intl.NumberFormat()

export function PlaceImportPanel({ accessToken }: PlaceImportPanelProps) {
  const [dataset, setDataset] = useState<PlaceImportDataset>('cities500')
  const [importStatus, setImportStatus] = useState<ImportStatus | null>(null)
  const [isImporting, setIsImporting] = useState(false)
  const [replaceExisting, setReplaceExisting] = useState(false)

  async function handleImportPlaces(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (!accessToken || isImporting) {
      return
    }

    setIsImporting(true)
    setImportStatus(null)

    try {
      const result = await importPlaces(
        { dataset, replace_existing: replaceExisting },
        accessToken,
      )
      const deletedMessage =
        result.deleted > 0
          ? ` Deleted ${numberFormatter.format(result.deleted)} existing places.`
          : ''
      setImportStatus({
        message: `Processed ${numberFormatter.format(result.processed)} places from ${getPlaceDatasetLabel(result.dataset)}.${deletedMessage}`,
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
    <Card>
      <CardHeader className="border-b border-emerald-100/80">
        <div className="flex items-start gap-4">
          <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-emerald-50 text-primary shadow-sm">
            <Database aria-hidden="true" className="size-5" />
          </span>
          <div className="space-y-1">
            <CardTitle className="text-xl">Places import</CardTitle>
            <CardDescription className="leading-6">
              Refresh the shared place-search index from GeoNames.
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="pt-6">
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

          <label className="flex items-start gap-3 rounded-xl border border-emerald-100 bg-emerald-50/50 px-4 py-3 text-sm text-foreground">
            <input
              checked={replaceExisting}
              className="mt-1 size-4 accent-emerald-700"
              disabled={isImporting}
              onChange={(event) => {
                setReplaceExisting(event.target.checked)
                setImportStatus(null)
              }}
              type="checkbox"
            />
            <span>
              <span className="block font-medium">Replace existing places</span>
              <span className="mt-0.5 block text-xs leading-5 text-muted-foreground">
                Delete the current place-search rows before importing GeoNames.
              </span>
            </span>
          </label>

          {replaceExisting ? (
            <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-900">
              <Info aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
              Existing place-search data will be replaced before the import.
            </div>
          ) : null}

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
              <Database aria-hidden="true" className="size-4" />
              {isImporting ? 'Importing…' : 'Import places'}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  )
}

function getPlaceDatasetLabel(dataset: PlaceImportDataset) {
  return (
    placeDatasetOptions.find((option) => option.value === dataset)?.label ??
    dataset
  )
}
