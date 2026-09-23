import { CheckCircle2, Loader2, PlugZap, Unplug } from 'lucide-react'
import { useCallback, useEffect, useState, type FormEvent } from 'react'

import {
  disconnectImmich,
  getErrorMessage,
  getImmichConnection,
  saveImmichConnection,
  testImmichConnection,
} from '@/api/client'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { InlineNotice } from '@/pages/trip-detail/inline-notice'

export function ImmichSettingsPage({ accessToken }: { accessToken: string | null }) {
  const [serverUrl, setServerUrl] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [connectedServer, setConnectedServer] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [busyAction, setBusyAction] = useState<'disconnect' | 'save' | 'test' | null>(null)
  const [notice, setNotice] = useState<{ message: string; error: boolean } | null>(null)

  const loadConnection = useCallback(async () => {
    if (!accessToken) {
      setIsLoading(false)
      return
    }
    try {
      const state = await getImmichConnection(accessToken)
      const savedUrl = state.connection?.server_url ?? ''
      setConnectedServer(savedUrl || null)
      setServerUrl(savedUrl)
    } catch (error) {
      setNotice({ message: getErrorMessage(error), error: true })
    } finally {
      setIsLoading(false)
    }
  }, [accessToken])

  useEffect(() => {
    void loadConnection()
  }, [loadConnection])

  async function run(action: 'save' | 'test') {
    if (!accessToken) {
      setNotice({ message: 'Sign in to configure Immich.', error: true })
      return
    }
    setBusyAction(action)
    setNotice(null)
    try {
      if (action === 'test') {
        await testImmichConnection({ accessToken, apiKey, serverUrl })
        setNotice({ message: 'Connection successful.', error: false })
      } else {
        const connection = await saveImmichConnection({ accessToken, apiKey, serverUrl })
        setConnectedServer(connection.server_url)
        setServerUrl(connection.server_url)
        setApiKey('')
        setNotice({ message: 'Immich connection saved.', error: false })
      }
    } catch (error) {
      setNotice({ message: getErrorMessage(error), error: true })
    } finally {
      setBusyAction(null)
    }
  }

  async function handleDisconnect() {
    if (!accessToken) return
    setBusyAction('disconnect')
    setNotice(null)
    try {
      await disconnectImmich(accessToken)
      setConnectedServer(null)
      setServerUrl('')
      setApiKey('')
      setNotice({ message: 'Immich disconnected. Imported media is unchanged.', error: false })
    } catch (error) {
      setNotice({ message: getErrorMessage(error), error: true })
    } finally {
      setBusyAction(null)
    }
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    void run('save')
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start gap-3">
          <span className="grid size-10 place-items-center rounded-xl bg-muted text-primary">
            <PlugZap className="size-5" aria-hidden="true" />
          </span>
          <div>
            <h3 className="font-semibold text-foreground">Personal Immich connection</h3>
            <CardDescription>
              The server must be reachable from OpenVoyage. Your browser never contacts Immich directly.
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <p className="inline-flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Loading connection…
          </p>
        ) : (
          <form className="grid gap-5" onSubmit={handleSubmit}>
            {connectedServer ? (
              <p className="inline-flex items-center gap-2 text-sm font-medium text-primary">
                <CheckCircle2 className="size-4" /> Connected to {connectedServer}
              </p>
            ) : null}
            <label className="grid gap-2 text-sm font-medium">
              Server URL
              <Input
                onChange={(event) => setServerUrl(event.target.value)}
                placeholder="https://photos.example.com"
                required
                type="url"
                value={serverUrl}
              />
            </label>
            <label className="grid gap-2 text-sm font-medium">
              API key
              <Input
                autoComplete="new-password"
                onChange={(event) => setApiKey(event.target.value)}
                placeholder={connectedServer ? 'Leave blank to keep the saved key' : 'Enter API key'}
                type="password"
                value={apiKey}
              />
              <span className="text-xs font-normal leading-5 text-muted-foreground">
                Required Immich v3 permissions: album.read, asset.read, asset.view, asset.download, and user.read.
              </span>
            </label>
            {notice ? <InlineNotice tone={notice.error ? 'error' : 'default'}>{notice.message}</InlineNotice> : null}
            <div className="flex flex-wrap gap-2">
              <Button disabled={busyAction !== null} onClick={() => void run('test')} type="button" variant="outline">
                {busyAction === 'test' ? 'Testing…' : 'Test connection'}
              </Button>
              <Button disabled={busyAction !== null} type="submit">
                {busyAction === 'save' ? 'Saving…' : 'Save'}
              </Button>
              {connectedServer ? (
                <Button disabled={busyAction !== null} onClick={() => void handleDisconnect()} type="button" variant="destructive">
                  <Unplug className="size-4" />
                  {busyAction === 'disconnect' ? 'Disconnecting…' : 'Disconnect'}
                </Button>
              ) : null}
            </div>
            {connectedServer ? (
              <p className="text-xs leading-5 text-muted-foreground">
                Disconnecting removes album links created through your connection across all trips. Already imported media stays in OpenVoyage.
              </p>
            ) : null}
          </form>
        )}
      </CardContent>
    </Card>
  )
}
