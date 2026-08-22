import {
  ArrowLeft,
  ArrowRight,
  CalendarDays,
  Copy,
  Eye,
  Globe2,
  Link2,
  Lock,
  Mail,
  Plus,
  Radio,
  Send,
  Settings,
  Trash2,
  UserPlus,
  Users,
  type LucideIcon,
} from 'lucide-react'
import {
  useEffect,
  useMemo,
  useState,
  type FocusEvent,
  type KeyboardEvent,
  type SyntheticEvent,
} from 'react'

import {
  getErrorMessage,
  searchUsers,
  type UserSearchResult,
} from '@/api/client'
import { ImageUploadDropzone } from '@/components/media/image-upload-dropzone'
import { TrackingManagementPanel } from '@/components/trips/tracking-management-dialog'
import { TripMemberPresence } from '@/components/trips/trip-member-presence'
import { Button } from '@/components/ui/button'
import { DatePicker, DateTimePicker } from '@/components/ui/date-time-picker'
import { Input } from '@/components/ui/input'
import { MediaImage } from '@/components/ui/media-image'
import { Modal } from '@/components/ui/modal'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import { InlineNotice } from '@/pages/trip-detail/inline-notice'
import {
  formatDateTimeLabel,
  formatTripDateRange,
  getInitials,
  getRoleLabel,
  getShareUrl,
  getUserDisplayName,
  getVisibilityDescription,
  getVisibilityLabel,
} from '@/pages/trip-detail/management-utils'
import type {
  ShareLinkViewModel,
  TripMemberViewModel,
  TripRole,
  TripViewerViewModel,
  TripViewModel,
  TripVisibility,
} from '@/pages/trip-detail/models'
import type {
  ShareLinkCreateDraft,
  TripSettingsDraft,
  UserLookupDraft,
} from '@/pages/trip-detail/page-types'
import type { TripManagementSection } from '@/pages/trip-detail/url-state'
import { useMediaQuery } from '@/pages/trip-detail/use-media-query'

const visibilityOptions = [
  { label: 'Private', value: 'PRIVATE' },
  { label: 'Platform public', value: 'PLATFORM_PUBLIC' },
  { label: 'Public', value: 'PUBLIC' },
] as const satisfies ReadonlyArray<{
  label: string
  value: TripVisibility
}>

const memberRoleOptions = [
  { label: 'Owner', value: 'OWNER' },
  { label: 'Member', value: 'MEMBER' },
] as const satisfies ReadonlyArray<{ label: string; value: TripRole }>

export function TripSidebarHeader({
  canManageTrip,
  canMutate,
  currentUserId,
  members,
  onOpenManagement,
  trip,
}: {
  canManageTrip: boolean
  canMutate: boolean
  currentUserId: string | null
  members: readonly TripMemberViewModel[]
  onOpenManagement: (section: TripManagementSection) => void
  trip: TripViewModel
}) {
  return (
    <div className="space-y-2 border-b border-border px-4 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <h1 className="truncate text-lg font-semibold tracking-normal text-foreground">
            {trip.name}
          </h1>
          <div className="flex min-w-0 items-center gap-3 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1.5">
              <CalendarDays className="size-3.5" aria-hidden="true" />
              {formatTripDateRange(trip.startDate, trip.endDate)}
            </span>
            <TripMemberPresence currentUserId={currentUserId} members={members} />
          </div>
        </div>

        {canMutate ? (
          <div className="flex shrink-0 items-center gap-1">
            <Button
              aria-label="GPS tracking"
              className="size-8 gap-1.5 rounded-xl p-0 text-xs sm:h-8 sm:w-auto sm:px-2.5"
              onClick={() => onOpenManagement('gps')}
              size="sm"
              title="GPS tracking"
              type="button"
              variant="outline"
            >
              <Radio className="size-3.5" aria-hidden="true" />
              <span className="sr-only sm:not-sr-only">GPS</span>
            </Button>
            {canManageTrip ? (
              <Button
                aria-label="Manage trip"
                className="size-8 gap-1.5 rounded-xl p-0 text-xs sm:h-8 sm:w-auto sm:px-2.5"
                onClick={() => onOpenManagement('general')}
                size="sm"
                title="Manage trip"
                type="button"
                variant="outline"
              >
                <Settings className="size-3.5" aria-hidden="true" />
                <span className="sr-only sm:not-sr-only">Manage trip</span>
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  )
}

function TripSettingsPanel({
  canMutate,
  isSaving,
  onClose,
  onSave,
  trip,
}: {
  canMutate: boolean
  isSaving: boolean
  onClose: () => void
  onSave: (draft: TripSettingsDraft) => void
  trip: TripViewModel
}) {
  const [description, setDescription] = useState(trip.description)
  const [coverFile, setCoverFile] = useState<File | null>(null)
  const [endDate, setEndDate] = useState(trip.endDate)
  const [name, setName] = useState(trip.name)
  const [startDate, setStartDate] = useState(trip.startDate)
  const [visibility, setVisibility] = useState<TripVisibility>(
    trip.visibility,
  )

  useEffect(() => {
    setDescription(trip.description)
    setCoverFile(null)
    setEndDate(trip.endDate)
    setName(trip.name)
    setStartDate(trip.startDate)
    setVisibility(trip.visibility)
  }, [trip])

  function handleStartDateChange(nextStartDate: string) {
    setStartDate(nextStartDate)
    setEndDate((currentEndDate) =>
      currentEndDate && currentEndDate < nextStartDate ? '' : currentEndDate,
    )
  }

  function handleSubmit(event: SyntheticEvent<HTMLFormElement, SubmitEvent>) {
    event.preventDefault()
    onSave({
      coverFile,
      description: description.trim(),
      endDate: endDate || null,
      name: name.trim(),
      startDate,
      visibility,
    })
  }

  return (
    <form className="grid gap-5" onSubmit={handleSubmit}>
        <ImageUploadDropzone
          buttonLabel="Choose a new cover"
          description="PNG, JPG, or WebP work best. Leave this unchanged to keep the current cover."
          disabled={!canMutate || isSaving}
          dropzoneClassName="min-h-44"
          file={coverFile}
          onFileChange={setCoverFile}
          title="Drop a new cover image here"
        />

        <label className="grid gap-2 text-sm font-medium text-foreground">
          Trip title
          <Input
            disabled={!canMutate || isSaving}
            maxLength={255}
            onChange={(event) => setName(event.target.value)}
            value={name}
          />
        </label>

        <div className="grid gap-4 sm:grid-cols-2">
          <label className="grid gap-2 text-sm font-medium text-foreground">
            Start date
            <DatePicker
              disabled={!canMutate || isSaving}
              onValueChange={handleStartDateChange}
              value={startDate}
            />
          </label>
          <label className="grid gap-2 text-sm font-medium text-foreground">
            End date
            <DatePicker
              disabled={!canMutate || isSaving}
              min={startDate || undefined}
              onValueChange={setEndDate}
              value={endDate}
            />
          </label>
        </div>

        <label className="grid gap-2 text-sm font-medium text-foreground">
          Visibility
          <Select<TripVisibility>
            disabled={!canMutate || isSaving}
            onValueChange={setVisibility}
            options={visibilityOptions}
            value={visibility}
          />
        </label>

        <VisibilityPreview visibility={visibility} />

        <label className="grid gap-2 text-sm font-medium text-foreground">
          Description
          <Textarea
            className="min-h-32"
            disabled={!canMutate || isSaving}
            onChange={(event) => setDescription(event.target.value)}
            value={description}
          />
        </label>

        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button disabled={isSaving} onClick={onClose} type="button" variant="outline">
            Cancel
          </Button>
          <Button
            disabled={!canMutate || isSaving || name.trim().length === 0 || !startDate}
            type="submit"
          >
            {isSaving ? 'Saving' : 'Save changes'}
          </Button>
        </div>
    </form>
  )
}

function VisibilityPreview({
  visibility,
}: {
  visibility: TripVisibility
}) {
  const Icon =
    visibility === 'PRIVATE'
      ? Lock
      : visibility === 'PLATFORM_PUBLIC'
        ? Users
        : Globe2

  return (
    <div className="flex items-start gap-3 rounded-[1.25rem] border border-border bg-muted/70 p-3">
      <span className="grid size-10 shrink-0 place-items-center rounded-2xl bg-card text-primary">
        <Icon className="size-4" aria-hidden="true" />
      </span>
      <div>
        <p className="font-semibold text-foreground">
          {getVisibilityLabel(visibility)}
        </p>
        <p className="mt-1 text-sm text-muted-foreground">
          {getVisibilityDescription(visibility)}
        </p>
      </div>
    </div>
  )
}

type UserSearchSelectProps = {
  accessToken?: string | null
  disabled: boolean
  excludedUserIds: readonly string[]
  id: string
  onValueChange: (user: UserSearchResult | null) => void
  value: UserSearchResult | null
}

function UserSearchSelect({
  accessToken,
  disabled,
  excludedUserIds,
  id,
  onValueChange,
  value,
}: UserSearchSelectProps) {
  const [activeIndex, setActiveIndex] = useState(0)
  const [isOpen, setIsOpen] = useState(false)
  const [isSearching, setIsSearching] = useState(false)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<readonly UserSearchResult[]>([])
  const [searchError, setSearchError] = useState<string | null>(null)
  const excludedUserIdSet = useMemo(
    () => new Set(excludedUserIds),
    [excludedUserIds],
  )
  const listboxId = `${id}-results`

  useEffect(() => {
    const trimmedQuery = query.trim()
    if (value || !trimmedQuery) {
      setIsSearching(false)
      setResults([])
      setSearchError(null)
      return undefined
    }

    if (!accessToken) {
      setIsSearching(false)
      setResults([])
      setSearchError('Sign in to search users.')
      return undefined
    }

    let isCurrent = true
    setIsSearching(true)
    setSearchError(null)

    const timeoutId = window.setTimeout(() => {
      void searchUsers({
        accessToken,
        excludeCurrentUser: true,
        pageSize: 8,
        query: trimmedQuery,
      })
        .then((response) => {
          if (!isCurrent) {
            return
          }

          const availableUsers = response.items.filter(
            (user) => !excludedUserIdSet.has(user.id),
          )
          setResults(availableUsers)
          setActiveIndex(0)
        })
        .catch((error) => {
          if (isCurrent) {
            setResults([])
            setSearchError(getErrorMessage(error))
          }
        })
        .finally(() => {
          if (isCurrent) {
            setIsSearching(false)
          }
        })
    }, 250)

    return () => {
      isCurrent = false
      window.clearTimeout(timeoutId)
    }
  }, [accessToken, excludedUserIdSet, query, value])

  function selectUser(user: UserSearchResult) {
    onValueChange(user)
    setQuery(getUserDisplayName(user))
    setIsOpen(false)
    setSearchError(null)
  }

  function handleBlur(event: FocusEvent<HTMLDivElement>) {
    if (
      event.relatedTarget instanceof Node &&
      event.currentTarget.contains(event.relatedTarget)
    ) {
      return
    }
    setIsOpen(false)
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Escape') {
      setIsOpen(false)
      return
    }

    if (!isOpen || results.length === 0) {
      return
    }

    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setActiveIndex((current) => (current + 1) % results.length)
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActiveIndex(
        (current) => (current - 1 + results.length) % results.length,
      )
    } else if (event.key === 'Enter') {
      event.preventDefault()
      selectUser(results[activeIndex] ?? results[0])
    }
  }

  return (
    <div className="grid content-start gap-2 text-sm font-medium text-foreground">
      <label htmlFor={id}>User search</label>
      <div className="relative" onBlur={handleBlur}>
        <Input
          aria-autocomplete="list"
          aria-controls={listboxId}
          aria-expanded={isOpen}
          autoComplete="off"
          disabled={disabled}
          id={id}
          onChange={(event) => {
            setQuery(event.target.value)
            onValueChange(null)
            setIsOpen(event.target.value.trim().length > 0)
          }}
          onFocus={() => {
            if (query.trim() && !value) {
              setIsOpen(true)
            }
          }}
          onKeyDown={handleKeyDown}
          placeholder="Name, username, or full email"
          role="combobox"
          value={query}
        />

        {isOpen ? (
          <div
            className="absolute inset-x-0 top-full z-30 mt-2 overflow-hidden rounded-xl border border-border bg-card shadow-lg"
            id={listboxId}
            role="listbox"
          >
            {isSearching ? (
              <p className="px-3 py-3 text-sm text-muted-foreground">
                Searching users…
              </p>
            ) : searchError ? (
              <p className="px-3 py-3 text-sm text-destructive" role="alert">
                {searchError}
              </p>
            ) : results.length > 0 ? (
              <div className="max-h-64 overflow-y-auto p-1.5">
                {results.map((user, index) => {
                  const name = getUserDisplayName(user)
                  const username = user.username
                  return (
                    <button
                      aria-selected={index === activeIndex}
                      className={cn(
                        'flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left transition-colors',
                        index === activeIndex
                          ? 'bg-muted'
                          : 'hover:bg-muted/70',
                      )}
                      key={user.id}
                      onClick={() => selectUser(user)}
                      onMouseEnter={() => setActiveIndex(index)}
                      role="option"
                      type="button"
                    >
                      <MediaImage
                        alt=""
                        className="size-10 shrink-0 rounded-xl text-sm font-semibold"
                        fallback={getInitials(name)}
                        media={user.profile_picture}
                      />
                      <span className="min-w-0">
                        <span className="block truncate font-semibold text-foreground">
                          {name}
                        </span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {username ? `@${username}` : 'No username'}
                        </span>
                      </span>
                    </button>
                  )
                })}
              </div>
            ) : (
              <p className="px-3 py-3 text-sm text-muted-foreground">
                No users found.
              </p>
            )}
          </div>
        ) : null}
      </div>
    </div>
  )
}

function ShareManagementPanel({
  accessToken,
  canMutate,
  error,
  isSaving,
  members,
  onCreateLink,
  onInviteViewer,
  onRemoveViewer,
  onRevokeLink,
  shareLinks,
  viewers,
}: {
  accessToken?: string | null
  canMutate: boolean
  error: string | null
  isSaving: boolean
  members: readonly TripMemberViewModel[]
  onCreateLink: (draft: ShareLinkCreateDraft) => void
  onInviteViewer: (draft: UserLookupDraft) => void
  onRemoveViewer: (viewer: TripViewerViewModel) => void
  onRevokeLink: (link: ShareLinkViewModel) => void
  shareLinks: readonly ShareLinkViewModel[]
  viewers: readonly TripViewerViewModel[]
}) {
  const [linkExpiresAt, setLinkExpiresAt] = useState('2027-06-01T09:00')
  const [linkLabel, setLinkLabel] = useState('Family preview')
  const [notice, setNotice] = useState<string | null>(null)
  const [selectedViewer, setSelectedViewer] =
    useState<UserSearchResult | null>(null)
  const [viewerSearchKey, setViewerSearchKey] = useState(0)

  function handleCreateLink(
    event: SyntheticEvent<HTMLFormElement, SubmitEvent>,
  ) {
    event.preventDefault()
    onCreateLink({
      expiresAt: linkExpiresAt || null,
      label: linkLabel.trim() || null,
    })
    setNotice(null)
    setLinkLabel('')
  }

  function handleInviteViewer(
    event: SyntheticEvent<HTMLFormElement, SubmitEvent>,
  ) {
    event.preventDefault()
    if (!selectedViewer) {
      return
    }

    onInviteViewer({ user: selectedViewer })
    setNotice(null)
    setSelectedViewer(null)
    setViewerSearchKey((current) => current + 1)
  }

  return (
    <div className="grid gap-5">
        {error ? (
          <p
            className="sticky top-0 z-40 rounded-[1.2rem] border border-destructive/30 bg-card px-3 py-2 text-sm text-destructive shadow-md"
            role="alert"
          >
            {error}
          </p>
        ) : null}
        {notice ? <InlineNotice>{notice}</InlineNotice> : null}

        <section className="space-y-4 rounded-[1.5rem] border border-border bg-card p-4">
          <div className="flex items-start gap-3">
            <span className="grid size-10 shrink-0 place-items-center rounded-2xl bg-muted text-primary">
              <Link2 className="size-4" aria-hidden="true" />
            </span>
            <div>
              <h3 className="font-semibold text-foreground">Share links</h3>
              <p className="text-sm text-muted-foreground">
                Links are read-only visitor access for people outside the member list.
              </p>
            </div>
          </div>

          <form className="grid gap-3" onSubmit={handleCreateLink}>
            <label className="grid gap-2 text-sm font-medium text-foreground">
              Link label
              <Input
                disabled={!canMutate || isSaving}
                onChange={(event) => setLinkLabel(event.target.value)}
                placeholder="Family preview"
                value={linkLabel}
              />
            </label>
            <label className="grid gap-2 text-sm font-medium text-foreground">
              Expiration
              <DateTimePicker
                disabled={!canMutate || isSaving}
                onValueChange={setLinkExpiresAt}
                value={linkExpiresAt}
              />
            </label>
            <div className="flex justify-end">
              <Button disabled={!canMutate || isSaving} type="submit">
                <Plus className="size-4" aria-hidden="true" />
                {isSaving ? 'Creating' : 'Create link'}
              </Button>
            </div>
          </form>

          <div className="grid gap-2">
            {shareLinks.map((link) => (
              <ShareLinkRow
                canMutate={canMutate}
                isSaving={isSaving}
                key={link.id}
                link={link}
                onNotice={setNotice}
                onRevoke={onRevokeLink}
              />
            ))}
            {shareLinks.length === 0 ? (
              <p className="rounded-[1.1rem] bg-muted/70 px-3 py-2 text-sm text-muted-foreground">
                No share links yet.
              </p>
            ) : null}
          </div>
        </section>

        <section className="space-y-4 rounded-[1.5rem] border border-border bg-card p-4">
          <div className="flex items-start gap-3">
            <span className="grid size-10 shrink-0 place-items-center rounded-2xl bg-muted text-primary">
              <Eye className="size-4" aria-hidden="true" />
            </span>
            <div>
              <h3 className="font-semibold text-foreground">Viewer allowlist</h3>
              <p className="text-sm text-muted-foreground">
                Viewers can open the trip but cannot edit planning or posts.
              </p>
            </div>
          </div>

          <form className="grid items-start gap-3 sm:grid-cols-[minmax(0,1fr)_auto]" onSubmit={handleInviteViewer}>
            <UserSearchSelect
              accessToken={accessToken}
              disabled={!canMutate || isSaving}
              excludedUserIds={[
                ...viewers.map((viewer) => viewer.userId ?? viewer.id),
                ...members.map((member) => member.userId ?? member.id),
              ]}
              id="viewer-search"
              key={viewerSearchKey}
              onValueChange={setSelectedViewer}
              value={selectedViewer}
            />
            <Button
              className="self-end"
              disabled={!canMutate || isSaving || !selectedViewer}
              type="submit"
            >
              <Send className="size-4" aria-hidden="true" />
              {isSaving ? 'Adding' : 'Add viewer'}
            </Button>
            <p className="text-xs font-normal text-muted-foreground sm:col-span-2">
              Search names and usernames partially, or enter a complete email address.
            </p>
          </form>

          <div className="grid gap-2">
            {viewers.map((viewer) => (
              <div
                className="flex items-center justify-between gap-3 rounded-[1.2rem] border border-border bg-muted/40 px-3 py-2"
                key={viewer.id}
              >
                <UserSummary name={viewer.name} subtitle={viewer.email} />
                <Button
                  aria-label={`Remove ${viewer.name}`}
                  disabled={!canMutate || isSaving}
                  onClick={() => onRemoveViewer(viewer)}
                  size="icon"
                  title={`Remove ${viewer.name}`}
                  type="button"
                  variant="ghost"
                >
                  <Trash2 className="size-4" aria-hidden="true" />
                </Button>
              </div>
            ))}
            {viewers.length === 0 ? (
              <p className="rounded-[1.1rem] bg-muted/70 px-3 py-2 text-sm text-muted-foreground">
                No viewers yet.
              </p>
            ) : null}
          </div>
        </section>
    </div>
  )
}

function TripMembersPanel({
  accessToken,
  canMutate,
  error,
  isSaving,
  members,
  onInviteMember,
  onRemoveMember,
  onUpdateMemberRole,
}: {
  accessToken?: string | null
  canMutate: boolean
  error: string | null
  isSaving: boolean
  members: readonly TripMemberViewModel[]
  onInviteMember: (draft: UserLookupDraft) => void
  onRemoveMember: (member: TripMemberViewModel) => void
  onUpdateMemberRole: (member: TripMemberViewModel, role: TripRole) => void
}) {
  const [inviteRole, setInviteRole] = useState<TripRole>('MEMBER')
  const [notice, setNotice] = useState<string | null>(null)
  const [selectedMember, setSelectedMember] =
    useState<UserSearchResult | null>(null)
  const [memberSearchKey, setMemberSearchKey] = useState(0)

  function handleInviteMember(
    event: SyntheticEvent<HTMLFormElement, SubmitEvent>,
  ) {
    event.preventDefault()
    if (!selectedMember) {
      return
    }

    onInviteMember({ role: inviteRole, user: selectedMember })
    setNotice(null)
    setSelectedMember(null)
    setMemberSearchKey((current) => current + 1)
    setInviteRole('MEMBER')
  }

  return (
    <div className="grid gap-5">
        {error ? (
          <p
            className="sticky top-0 z-40 rounded-[1.2rem] border border-destructive/30 bg-card px-3 py-2 text-sm text-destructive shadow-md"
            role="alert"
          >
            {error}
          </p>
        ) : null}
        {notice ? <InlineNotice>{notice}</InlineNotice> : null}

        <form
          className="grid gap-3 rounded-[1.5rem] border border-border bg-muted/70 p-4"
          onSubmit={handleInviteMember}
        >
          <div className="flex items-start gap-3">
            <span className="grid size-10 shrink-0 place-items-center rounded-2xl bg-card text-primary">
              <UserPlus className="size-4" aria-hidden="true" />
            </span>
            <div>
              <h3 className="font-semibold text-foreground">Invite user</h3>
              <p className="text-sm text-muted-foreground">
                Members can help manage posts and planning.
              </p>
            </div>
          </div>

          <div className="grid items-start gap-3 sm:grid-cols-[minmax(0,1fr)_11rem]">
            <UserSearchSelect
              accessToken={accessToken}
              disabled={!canMutate || isSaving}
              excludedUserIds={members.map((member) => member.userId ?? member.id)}
              id="member-search"
              key={memberSearchKey}
              onValueChange={setSelectedMember}
              value={selectedMember}
            />
            <label className="grid content-start gap-2 self-start text-sm font-medium text-foreground">
              Role
              <Select<TripRole>
                disabled={!canMutate || isSaving}
                onValueChange={setInviteRole}
                options={memberRoleOptions}
                value={inviteRole}
              />
            </label>
          </div>
          <p className="text-xs text-muted-foreground">
            Search names and usernames partially, or enter a complete email address.
          </p>

          <div className="flex justify-end">
            <Button
              disabled={!canMutate || isSaving || !selectedMember}
              type="submit"
            >
              <Mail className="size-4" aria-hidden="true" />
              {isSaving ? 'Adding' : 'Add member'}
            </Button>
          </div>
        </form>

        <section className="space-y-3 rounded-[1.5rem] border border-border bg-card p-4">
          <div className="flex items-start gap-3">
            <span className="grid size-10 shrink-0 place-items-center rounded-2xl bg-muted text-primary">
              <Users className="size-4" aria-hidden="true" />
            </span>
            <div>
              <h3 className="font-semibold text-foreground">Current members</h3>
              <p className="text-sm text-muted-foreground">
                Owners can manage roles and member access.
              </p>
            </div>
          </div>

          <div className="grid gap-2">
            {members.map((member) => (
              <MemberRow
                canMutate={canMutate}
                isSaving={isSaving}
                key={member.id}
                member={member}
                onNotice={setNotice}
                onRemove={onRemoveMember}
                onRoleChange={onUpdateMemberRole}
              />
            ))}
            {members.length === 0 ? (
              <p className="rounded-[1.1rem] bg-muted/70 px-3 py-2 text-sm text-muted-foreground">
                No members yet.
              </p>
            ) : null}
          </div>
        </section>
    </div>
  )
}

const managementSections = [
  {
    description: 'Details, dates, cover, and visibility.',
    icon: Settings,
    label: 'General',
    value: 'general',
  },
  {
    description: 'Members, viewers, and share links.',
    icon: Users,
    label: 'People & sharing',
    value: 'people',
  },
  {
    description: 'Recordings, points, and live location.',
    icon: Radio,
    label: 'GPS & location',
    value: 'gps',
  },
  {
    description: 'Permanently delete this trip.',
    icon: Trash2,
    label: 'Danger zone',
    value: 'danger',
  },
] as const satisfies ReadonlyArray<{
  description: string
  icon: LucideIcon
  label: string
  value: TripManagementSection
}>

export function TripManagementDialog({
  accessToken,
  canManageLiveSharing,
  canManageTrip,
  error,
  isSaving,
  members,
  onClose,
  onCreateLink,
  onDeleteTrip,
  onInviteMember,
  onInviteViewer,
  onRemoveMember,
  onRemoveViewer,
  onRevokeLink,
  onSaveSettings,
  onSectionChange,
  onTrackingChanged,
  onUpdateMemberRole,
  open,
  section,
  shareLinks,
  trip,
  tripId,
  viewers,
}: {
  accessToken?: string | null
  canManageLiveSharing: boolean
  canManageTrip: boolean
  error: string | null
  isSaving: boolean
  members: readonly TripMemberViewModel[]
  onClose: () => void
  onCreateLink: (draft: ShareLinkCreateDraft) => void
  onDeleteTrip: () => void
  onInviteMember: (draft: UserLookupDraft) => void
  onInviteViewer: (draft: UserLookupDraft) => void
  onRemoveMember: (member: TripMemberViewModel) => void
  onRemoveViewer: (viewer: TripViewerViewModel) => void
  onRevokeLink: (link: ShareLinkViewModel) => void
  onSaveSettings: (draft: TripSettingsDraft) => void
  onSectionChange: (section: TripManagementSection) => void
  onTrackingChanged: () => void
  onUpdateMemberRole: (member: TripMemberViewModel, role: TripRole) => void
  open: boolean
  section: TripManagementSection
  shareLinks: readonly ShareLinkViewModel[]
  trip: TripViewModel
  tripId?: string
  viewers: readonly TripViewerViewModel[]
}) {
  const isMobile = useMediaQuery('(max-width: 639px)')
  const [showMobileMenu, setShowMobileMenu] = useState(false)
  const effectiveSection = canManageTrip ? section : 'gps'
  const activeSection = managementSections.find(
    (item) => item.value === effectiveSection,
  )!
  const availableSections = canManageTrip
    ? managementSections
    : managementSections.filter((item) => item.value === 'gps')

  useEffect(() => {
    if (open) {
      setShowMobileMenu(isMobile && effectiveSection === 'general')
    }
  }, [effectiveSection, isMobile, open])

  function selectSection(nextSection: TripManagementSection) {
    onSectionChange(nextSection)
    setShowMobileMenu(false)
  }

  return (
    <Modal
      className="sm:h-[min(48rem,calc(100dvh-2rem))] sm:max-w-5xl"
      contentClassName="pl-3 pr-5 sm:px-4"
      description={
        isMobile && !showMobileMenu
          ? activeSection.description
          : 'Settings, access, location data, and trip administration.'
      }
      fullscreenOnMobile
      onClose={onClose}
      open={open}
      title={isMobile && !showMobileMenu ? activeSection.label : 'Manage trip'}
    >
      {isMobile && showMobileMenu ? (
        <div className="grid gap-2 p-1">
          {availableSections.map(({ description, icon: Icon, label, value }) => (
            <button
              className="flex items-center gap-3 rounded-2xl border border-border bg-card px-4 py-4 text-left transition-colors hover:bg-muted"
              key={value}
              onClick={() => selectSection(value)}
              type="button"
            >
              <span className="grid size-10 place-items-center rounded-xl bg-muted text-primary">
                <Icon className="size-4" aria-hidden="true" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block font-semibold text-foreground">{label}</span>
                <span className="mt-0.5 block text-sm text-muted-foreground">{description}</span>
              </span>
              <ArrowRight className="size-4 text-muted-foreground" aria-hidden="true" />
            </button>
          ))}
        </div>
      ) : (
        <div className="grid min-h-full gap-5 sm:grid-cols-[11.5rem_minmax(0,1fr)]">
          <nav
            aria-label="Trip management sections"
            className="sticky top-0 z-10 hidden self-start bg-card pb-2 pr-4 sm:grid content-start gap-1 border-r border-border"
          >
            {availableSections.map(({ icon: Icon, label, value }) => (
              <Button
                className="justify-start gap-2"
                key={value}
                onClick={() => selectSection(value)}
                type="button"
                variant={effectiveSection === value ? 'secondary' : 'ghost'}
              >
                <Icon className="size-4" aria-hidden="true" />
                {label}
              </Button>
            ))}
          </nav>
          <div className="min-w-0 pb-2">
            {isMobile ? (
              <Button
                className="mb-4 -ml-2 gap-1.5"
                onClick={() => setShowMobileMenu(true)}
                type="button"
                variant="ghost"
              >
                <ArrowLeft className="size-4" aria-hidden="true" />
                All trip settings
              </Button>
            ) : null}
            {effectiveSection === 'general' && canManageTrip ? (
              <TripSettingsPanel
                canMutate={canManageTrip}
                isSaving={isSaving}
                onClose={onClose}
                onSave={onSaveSettings}
                trip={trip}
              />
            ) : null}
            {effectiveSection === 'people' && canManageTrip ? (
              <div className="grid gap-8">
                <TripMembersPanel
                  accessToken={accessToken}
                  canMutate={canManageTrip}
                  error={error}
                  isSaving={isSaving}
                  members={members}
                  onInviteMember={onInviteMember}
                  onRemoveMember={onRemoveMember}
                  onUpdateMemberRole={onUpdateMemberRole}
                />
                <ShareManagementPanel
                  accessToken={accessToken}
                  canMutate={canManageTrip}
                  error={error}
                  isSaving={isSaving}
                  members={members}
                  onCreateLink={onCreateLink}
                  onInviteViewer={onInviteViewer}
                  onRemoveViewer={onRemoveViewer}
                  onRevokeLink={onRevokeLink}
                  shareLinks={shareLinks}
                  viewers={viewers}
                />
              </div>
            ) : null}
            {effectiveSection === 'gps' && accessToken && tripId ? (
              <TrackingManagementPanel
                accessToken={accessToken}
                canManageLiveSharing={canManageLiveSharing}
                onTrackingChanged={onTrackingChanged}
                tripId={tripId}
                tripTitle={trip.name}
              />
            ) : null}
            {effectiveSection === 'gps' && (!accessToken || !tripId) ? (
              <p className="rounded-2xl border border-border bg-muted/50 p-4 text-sm text-muted-foreground">
                GPS recordings are available after this trip has been saved and opened while signed in.
              </p>
            ) : null}
            {effectiveSection === 'danger' && canManageTrip ? (
              <TripDangerZone
                error={error}
                isDeleting={isSaving}
                onDelete={onDeleteTrip}
                tripName={trip.name}
              />
            ) : null}
          </div>
        </div>
      )}
    </Modal>
  )
}

function TripDangerZone({
  error,
  isDeleting,
  onDelete,
  tripName,
}: {
  error: string | null
  isDeleting: boolean
  onDelete: () => void
  tripName: string
}) {
  const [isConfirming, setIsConfirming] = useState(false)
  const [secondsRemaining, setSecondsRemaining] = useState(3)

  useEffect(() => {
    setIsConfirming(false)
    setSecondsRemaining(3)
  }, [tripName])

  useEffect(() => {
    if (!isConfirming || isDeleting || secondsRemaining === 0) {
      return undefined
    }

    const timeoutId = window.setTimeout(() => {
      setSecondsRemaining((current) => Math.max(0, current - 1))
    }, 1000)

    return () => window.clearTimeout(timeoutId)
  }, [isConfirming, isDeleting, secondsRemaining])

  return (
    <section className="space-y-4 rounded-[1.5rem] border border-destructive/35 bg-destructive/5 p-5">
      <div className="space-y-1">
        <h3 className="font-semibold text-foreground">Delete trip</h3>
        <p className="text-sm leading-6 text-muted-foreground">
          Permanently remove {tripName}, including posts, itinerary, sharing access, and GPS data. This cannot be undone.
        </p>
      </div>
      {error ? (
        <p className="rounded-xl border border-destructive/30 bg-card px-3 py-2 text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}
      {isConfirming ? (
        <div className="space-y-4 rounded-[1.25rem] border border-destructive/30 bg-card p-4">
          <div className="space-y-1">
            <p className="font-semibold text-foreground">Confirm deletion</p>
            <p className="text-sm leading-6 text-muted-foreground">
              This permanently deletes <span className="font-medium text-foreground">{tripName}</span> and its data. You can cancel while the deletion button unlocks.
            </p>
          </div>
          {secondsRemaining > 0 ? (
            <p aria-live="polite" className="text-sm font-medium text-destructive">
              Deletion available in {secondsRemaining} second{secondsRemaining === 1 ? '' : 's'}
            </p>
          ) : null}
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button
              disabled={isDeleting}
              onClick={() => {
                setIsConfirming(false)
                setSecondsRemaining(3)
              }}
              type="button"
              variant="outline"
            >
              Cancel
            </Button>
            <Button
              disabled={isDeleting || secondsRemaining > 0}
              onClick={onDelete}
              type="button"
              variant="destructive"
            >
              <Trash2 className="size-4" aria-hidden="true" />
              {isDeleting
                ? 'Deleting trip'
                : secondsRemaining > 0
                  ? `Delete in ${secondsRemaining}s`
                  : 'Permanently delete trip'}
            </Button>
          </div>
        </div>
      ) : (
        <Button
          disabled={isDeleting}
          onClick={() => {
            setSecondsRemaining(3)
            setIsConfirming(true)
          }}
          type="button"
          variant="destructive"
        >
          <Trash2 className="size-4" aria-hidden="true" />
          Delete trip
        </Button>
      )}
    </section>
  )
}

function ShareLinkRow({
  canMutate,
  isSaving,
  link,
  onNotice,
  onRevoke,
}: {
  canMutate: boolean
  isSaving: boolean
  link: ShareLinkViewModel
  onNotice: (notice: string) => void
  onRevoke: (link: ShareLinkViewModel) => void
}) {
  const [copied, setCopied] = useState(false)
  const shareUrl = link.token ? getShareUrl(link.token, link.tripId) : null

  function handleCopy() {
    if (!shareUrl) {
      return
    }

    setCopied(true)
    onNotice(`${link.label} copied to clipboard.`)
    void navigator.clipboard
      ?.writeText(shareUrl)
      .catch(() => undefined)
    window.setTimeout(() => setCopied(false), 1200)
  }

  return (
    <div className="grid gap-3 rounded-[1.2rem] border border-border bg-muted/40 p-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
      <div className="min-w-0">
        <p className="font-semibold text-foreground">{link.label}</p>
        <p className="mt-1 truncate text-xs text-muted-foreground">
          {shareUrl ?? 'Token hidden after creation'}
        </p>
        <p className="mt-2 text-xs text-muted-foreground">
          Expires {link.expiresAt ? formatDateTimeLabel(link.expiresAt) : 'never'} ·
          Last used {link.lastUsedAt ? link.lastUsedAt.toLowerCase() : 'never'}
        </p>
      </div>
      <div className="flex gap-2">
        <Button
          disabled={!shareUrl}
          onClick={handleCopy}
          type="button"
          variant="outline"
        >
          <Copy className="size-4" aria-hidden="true" />
          {copied ? 'Copied' : 'Copy'}
        </Button>
        <Button
          aria-label={`Revoke ${link.label}`}
          disabled={!canMutate || isSaving}
          onClick={() => onRevoke(link)}
          size="icon"
          title={`Revoke ${link.label}`}
          type="button"
          variant="ghost"
        >
          <Trash2 className="size-4" aria-hidden="true" />
        </Button>
      </div>
    </div>
  )
}

function MemberRow({
  canMutate,
  isSaving,
  member,
  onNotice,
  onRemove,
  onRoleChange,
}: {
  canMutate: boolean
  isSaving: boolean
  member: TripMemberViewModel
  onNotice: (notice: string) => void
  onRemove: (member: TripMemberViewModel) => void
  onRoleChange: (member: TripMemberViewModel, role: TripRole) => void
}) {
  const [role, setRole] = useState<TripRole>(member.role)
  const isOwner = member.role === 'OWNER'

  useEffect(() => {
    setRole(member.role)
  }, [member.role])

  function handleRoleChange(nextRole: TripRole) {
    setRole(nextRole)
    onNotice(`${member.name} role changed to ${getRoleLabel(nextRole)}.`)
    onRoleChange(member, nextRole)
  }

  return (
    <div className="grid gap-3 rounded-[1.2rem] border border-border bg-muted/40 p-3 sm:grid-cols-[minmax(0,1fr)_11rem_auto] sm:items-center">
      <UserSummary name={member.name} subtitle={member.email} />
      <Select<TripRole>
        disabled={!canMutate || isSaving || isOwner}
        onValueChange={handleRoleChange}
        options={memberRoleOptions}
        value={role}
      />
      <Button
        aria-label={`Remove ${member.name}`}
        disabled={!canMutate || isSaving || isOwner}
        onClick={() => onRemove(member)}
        size="icon"
        title={`Remove ${member.name}`}
        type="button"
        variant="ghost"
      >
        <Trash2 className="size-4" aria-hidden="true" />
      </Button>
    </div>
  )
}

function UserSummary({
  name,
  subtitle,
}: {
  name: string
  subtitle: string
}) {
  return (
    <div className="flex min-w-0 items-center gap-3">
      <span className="grid size-10 shrink-0 place-items-center rounded-2xl bg-card text-sm font-semibold text-primary">
        {getInitials(name)}
      </span>
      <span className="min-w-0">
        <span className="block truncate font-semibold text-foreground">{name}</span>
        <span className="block truncate text-xs text-muted-foreground">
          {subtitle}
        </span>
      </span>
    </div>
  )
}
