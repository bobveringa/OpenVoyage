import { Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'

import {
  deleteAdminUser,
  getAdminUserDeletionImpact,
  getErrorMessage,
  type AdminUser,
  type AdminUserDeletionImpact,
} from '@/api/client'
import {
  describeContentElsewhere,
  describeDeletedComments,
  describeDeletedTrips,
  describeReactionsOnPosts,
} from '@/components/admin/user-deletion'
import { Button } from '@/components/ui/button'
import { CheckboxField } from '@/components/ui/checkbox-field'
import { Modal } from '@/components/ui/modal'

export function DeleteUserModal({
  accessToken,
  onClose,
  onDeleted,
  user,
}: {
  accessToken: string | null
  onClose: () => void
  onDeleted: () => Promise<void>
  user: AdminUser | null
}) {
  const [error, setError] = useState<string | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)
  const [impact, setImpact] = useState<AdminUserDeletionImpact | null>(null)
  const [impactError, setImpactError] = useState<string | null>(null)
  const [impactAttempt, setImpactAttempt] = useState(0)
  const [deleteContent, setDeleteContent] = useState(false)
  const userId = user?.id ?? null

  // Only a different user starts over: a refreshed access token must not undo
  // the admin's choice or forget a deletion that is under way.
  useEffect(() => {
    setError(null)
    setIsDeleting(false)
    setImpact(null)
    setImpactError(null)
    setDeleteContent(false)
  }, [userId])

  useEffect(() => {
    if (!accessToken || !userId) {
      return
    }

    let cancelled = false
    getAdminUserDeletionImpact({ accessToken, userId })
      .then((nextImpact) => {
        if (cancelled) return
        setImpact(nextImpact)
        setImpactError(null)
      })
      .catch((loadError: unknown) => {
        if (!cancelled) setImpactError(getErrorMessage(loadError))
      })
    return () => {
      cancelled = true
    }
  }, [accessToken, impactAttempt, userId])

  const tripsText = impact ? describeDeletedTrips(impact) : null
  const commentsText = impact ? describeDeletedComments(impact) : null
  const contentText = impact ? describeContentElsewhere(impact) : null
  const reactionsText = impact ? describeReactionsOnPosts(impact) : null
  // Without a token nothing is loading: the check runs once a token arrives.
  const isSignedOut = !accessToken
  const impactFailed = impact === null && (isSignedOut || impactError !== null)

  function retryImpact() {
    setImpactError(null)
    setImpactAttempt((attempt) => attempt + 1)
  }

  async function confirmDelete() {
    if (!accessToken || !user || !impact) {
      return
    }

    setIsDeleting(true)
    setError(null)
    try {
      await deleteAdminUser({
        accessToken,
        deleteContent: deleteContent && contentText !== null,
        expectedDeletedTripCount: impact.deleted_trip_count,
        userId: user.id,
      })
      await onDeleted()
    } catch (deleteError) {
      setError(getErrorMessage(deleteError))
      // It may have failed because of a change: show what would go by now.
      setImpactAttempt((attempt) => attempt + 1)
    } finally {
      setIsDeleting(false)
    }
  }

  return (
    <Modal
      bottomSheetOnMobile
      className="sm:max-w-md"
      description={`${user?.email ?? ''}. This can’t be undone.`}
      dismissible={!isDeleting}
      onClose={onClose}
      open={user !== null}
      title={`Delete ${user?.first_name ?? ''} ${user?.last_name ?? ''}?`.replace(/\s+\?$/, '?')}
    >
      <div className="space-y-5 p-1">
        {impact === null && !impactFailed ? (
          <p className="text-sm text-muted-foreground">Checking their trips…</p>
        ) : null}
        {isSignedOut ? (
          <p className="text-sm text-destructive" role="alert">
            Sign in again to delete this user.
          </p>
        ) : impactFailed ? (
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm text-destructive" role="alert">{impactError}</p>
            <Button onClick={retryImpact} type="button" variant="ghost">
              Try again
            </Button>
          </div>
        ) : null}
        {tripsText ? <p className="text-sm text-foreground">{tripsText}</p> : null}
        {commentsText ? <p className="text-sm text-foreground">{commentsText}</p> : null}
        {/* Always shown, so the option is known even when it has nothing to do. */}
        <CheckboxField
          checked={deleteContent && contentText !== null}
          description={
            impactFailed
              ? 'Not available until we know what they added.'
              : impact === null
                ? 'Checking what they added…'
                : contentText
                  ? `That’s ${contentText}.${reactionsText ? ` ${reactionsText}` : ''} If you leave this unchecked, they stay and show “Deleted user” as the author.`
                  : 'Not available: they haven’t added posts, photos or GPS tracks to other people’s trips.'
          }
          disabled={isDeleting || contentText === null}
          label="Also delete their posts, photos and GPS tracks in other people’s trips"
          onChange={setDeleteContent}
        />
        {error ? <p className="text-sm text-destructive" role="alert">{error}</p> : null}
        <div className="flex justify-end gap-2">
          <Button disabled={isDeleting} onClick={onClose} type="button" variant="ghost">
            Cancel
          </Button>
          <Button
            disabled={isDeleting || isSignedOut || impact === null}
            onClick={() => void confirmDelete()}
            type="button"
            variant="destructive"
          >
            <Trash2 aria-hidden="true" className="size-4" />
            {isDeleting ? 'Deleting…' : 'Delete user'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
