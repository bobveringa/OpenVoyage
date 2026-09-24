import { Loader2, RefreshCw, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'

import {
  connectTripImmichAlbum,
  getErrorMessage,
  listImmichAlbums,
  listTripImmichAlbums,
  removeTripImmichAlbum,
  type ImmichAlbum,
  type ImmichAlbumLink,
} from '@/api/client'
import { ImmichLogo } from '@/components/branding/immich-logo'
import { Button } from '@/components/ui/button'
import { Select } from '@/components/ui/select'
import { InlineNotice } from '@/pages/trip-detail/inline-notice'

export function ImmichAlbumsPanel({
  accessToken,
  tripId,
}: {
  accessToken: string
  tripId: string
}) {
  const [links, setLinks] = useState<ImmichAlbumLink[]>([])
  const [albums, setAlbums] = useState<ImmichAlbum[]>([])
  const [selectedAlbumId, setSelectedAlbumId] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [notice, setNotice] = useState<{ message: string; error: boolean } | null>(null)

  const load = useCallback(async () => {
    setIsLoading(true)
    setNotice(null)
    const [linksResult, albumsResult] = await Promise.allSettled([
      listTripImmichAlbums({ accessToken, tripId }),
      listImmichAlbums(accessToken),
    ])
    if (linksResult.status === 'fulfilled') {
      setLinks(linksResult.value)
    } else {
      setNotice({ message: getErrorMessage(linksResult.reason), error: true })
    }
    if (albumsResult.status === 'fulfilled') {
      setAlbums(albumsResult.value)
    } else {
      setAlbums([])
    }
    setIsLoading(false)
  }, [accessToken, tripId])

  useEffect(() => {
    void load()
  }, [load])

  const options = useMemo(
    () => albums.map((album) => ({ label: album.name, value: album.id })),
    [albums],
  )

  async function connectAlbum() {
    if (!selectedAlbumId) return
    setBusyId(selectedAlbumId)
    setNotice(null)
    try {
      const link = await connectTripImmichAlbum({
        accessToken,
        albumId: selectedAlbumId,
        tripId,
      })
      setLinks((current) => [
        ...current.filter((item) => item.id !== link.id),
        link,
      ])
      setSelectedAlbumId('')
      setNotice({ message: 'Album connected to this trip.', error: false })
    } catch (error) {
      setNotice({ message: getErrorMessage(error), error: true })
    } finally {
      setBusyId(null)
    }
  }

  async function removeAlbum(link: ImmichAlbumLink) {
    setBusyId(link.id)
    setNotice(null)
    try {
      await removeTripImmichAlbum({ accessToken, linkId: link.id, tripId })
      setLinks((current) => current.filter((item) => item.id !== link.id))
      setNotice({ message: 'Album link removed. Immich and imported media are unchanged.', error: false })
    } catch (error) {
      setNotice({ message: getErrorMessage(error), error: true })
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h3 className="flex items-center gap-2 font-semibold text-foreground">
          <ImmichLogo className="size-5" aria-hidden="true" /> Immich albums
        </h3>
        <p className="text-sm leading-6 text-muted-foreground">
          Connecting an album grants every trip contributor access to browse and import it using your Immich credentials.
        </p>
      </div>
      {notice ? <InlineNotice tone={notice.error ? 'error' : 'default'}>{notice.message}</InlineNotice> : null}
      <div className="flex flex-col gap-2 rounded-2xl border border-border bg-muted/40 p-4 sm:flex-row">
        <Select
          className="flex-1"
          disabled={isLoading || busyId !== null || options.length === 0}
          onValueChange={setSelectedAlbumId}
          options={options}
          placeholder={options.length ? 'Choose an album' : 'Connect Immich in account settings first'}
          value={selectedAlbumId}
        />
        <Button
          className="border border-[#1e83f7]/35 bg-[#1e83f7]/10 text-foreground hover:bg-[#1e83f7]/15"
          disabled={!selectedAlbumId || busyId !== null}
          onClick={() => void connectAlbum()}
          type="button"
        >
          <ImmichLogo className="size-4" aria-hidden="true" /> Connect album
        </Button>
      </div>
      {isLoading ? (
        <p className="inline-flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" /> Loading albums…</p>
      ) : links.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-border p-5 text-sm text-muted-foreground">No Immich albums are connected to this trip.</p>
      ) : (
        <div className="grid gap-2">
          {links.map((link) => {
            const person = [link.connected_by.first_name, link.connected_by.last_name].filter(Boolean).join(' ') || link.connected_by.username || 'Trip contributor'
            return (
              <div className="flex items-center justify-between gap-3 rounded-2xl border border-border bg-card p-4" key={link.id}>
                <div className="min-w-0">
                  <p className="truncate font-semibold text-foreground">{link.name ?? 'Unavailable album'}</p>
                  <p className="text-xs text-muted-foreground">Connected by {person}</p>
                </div>
                {link.can_remove ? (
                  <Button aria-label={`Remove ${link.name ?? 'unavailable album'}`} disabled={busyId !== null} onClick={() => void removeAlbum(link)} size="icon" type="button" variant="ghost">
                    <Trash2 className="size-4" />
                  </Button>
                ) : null}
              </div>
            )
          })}
        </div>
      )}
      <Button disabled={isLoading} onClick={() => void load()} size="sm" type="button" variant="outline">
        <RefreshCw className="size-4" /> Refresh
      </Button>
    </div>
  )
}
