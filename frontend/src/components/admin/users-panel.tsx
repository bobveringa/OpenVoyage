import {
  AlertCircle,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Trash2,
  Users,
} from 'lucide-react'
import {
  useCallback,
  useEffect,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react'

import {
  createAdminUser,
  deleteAdminUser,
  getErrorMessage,
  listAdminUsers,
  updateAdminUser,
  type AdminUser,
  type AdminUserCreatePayload,
} from '@/api/client'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
} from '@/components/ui/card'
import { EmptyState, LoadingState } from '@/components/ui/empty-state'
import { Input } from '@/components/ui/input'
import { Modal } from '@/components/ui/modal'
import { Select } from '@/components/ui/select'

type UsersPanelProps = {
  accessToken: string | null
}

type LoadStatus = 'error' | 'loading' | 'ready'
type EditorState =
  | { mode: 'create' }
  | { mode: 'edit'; user: AdminUser }
  | null

const pageSize = 20

export function UsersPanel({ accessToken }: UsersPanelProps) {
  const [users, setUsers] = useState<AdminUser[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [query, setQuery] = useState('')
  const [appliedQuery, setAppliedQuery] = useState('')
  const [role, setRole] = useState<'ADMIN' | 'USER' | 'ALL'>('ALL')
  const [loadStatus, setLoadStatus] = useState<LoadStatus>('loading')
  const [loadError, setLoadError] = useState<string | null>(null)
  const [editor, setEditor] = useState<EditorState>(null)
  const [deleteTarget, setDeleteTarget] = useState<AdminUser | null>(null)

  const loadUsers = useCallback(
    async (nextPage: number) => {
      if (!accessToken) {
        setLoadStatus('error')
        setLoadError('An authenticated admin session is required.')
        return
      }

      setLoadStatus('loading')
      setLoadError(null)
      try {
        const response = await listAdminUsers({
          accessToken,
          page: nextPage,
          pageSize,
          query: appliedQuery,
          role: role === 'ALL' ? undefined : role,
        })
        setUsers(response.users)
        setTotal(response.total)
        setPage(response.page)
        setLoadStatus('ready')
      } catch (error) {
        setLoadError(getErrorMessage(error))
        setLoadStatus('error')
      }
    },
    [accessToken, appliedQuery, role],
  )

  useEffect(() => {
    void loadUsers(1)
  }, [appliedQuery, loadUsers, role])

  function submitSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setAppliedQuery(query.trim())
  }

  function changeRole(nextRole: 'ADMIN' | 'USER' | 'ALL') {
    setRole(nextRole)
  }

  async function refreshAfterChange() {
    await loadUsers(page)
  }

  const showingFrom = total === 0 ? 0 : (page - 1) * pageSize + 1
  const showingTo = Math.min(page * pageSize, total)
  const canGoBack = page > 1
  const canGoForward = page * pageSize < total

  return (
    <section
      aria-labelledby="admin-users-heading"
      className="space-y-6"
      id="admin-panel-users"
      role="tabpanel"
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <SectionHeading
          description="Create accounts, update access, and reset passwords for your travellers."
          eyebrow="Administration"
          title="Users"
        />
        <Button onClick={() => setEditor({ mode: 'create' })}>
          <Plus aria-hidden="true" className="size-4" />
          Create user
        </Button>
      </div>

      <Card>
        <CardContent className="p-4 sm:p-5">
          <div className="flex flex-col gap-3 sm:flex-row">
            <form className="flex min-w-0 flex-1 gap-2" onSubmit={submitSearch}>
              <Input
                aria-label="Search users"
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search email, name, or username"
                value={query}
              />
              <Button aria-label="Search users" size="icon" type="submit">
                <Search aria-hidden="true" className="size-4" />
              </Button>
            </form>
            <div className="w-full sm:w-40">
              <Select
                ariaLabel="Filter by role"
                onValueChange={changeRole}
                options={[
                  { label: 'All roles', value: 'ALL' },
                  { label: 'Administrators', value: 'ADMIN' },
                  { label: 'Users', value: 'USER' },
                ]}
                value={role}
              />
            </div>
            <Button
              aria-label="Refresh users"
              onClick={() => void loadUsers(page)}
              size="icon"
              type="button"
              variant="outline"
            >
              <RefreshCw aria-hidden="true" className="size-4" />
            </Button>
          </div>
        </CardContent>
      </Card>

      {loadStatus === 'loading' ? <LoadingState label="Loading users" /> : null}
      {loadStatus === 'error' ? (
        <EmptyState
          action={
            <Button
              onClick={() => void loadUsers(page)}
              size="sm"
              variant="outline"
            >
              <RefreshCw aria-hidden="true" className="size-4" />
              Try again
            </Button>
          }
          description={loadError ?? 'The user service did not return a response.'}
          icon={AlertCircle}
          title="Users could not be loaded"
        />
      ) : null}
      {loadStatus === 'ready' && users.length === 0 ? (
        <EmptyState
          action={
            <Button onClick={() => setEditor({ mode: 'create' })} size="sm">
              <Plus aria-hidden="true" className="size-4" />
              Create user
            </Button>
          }
          description={
            appliedQuery || role !== 'ALL'
              ? 'Try a different search or role filter.'
              : 'Create the first user managed from this area.'
          }
          icon={Users}
          title="No users found"
        />
      ) : null}
      {loadStatus === 'ready' && users.length > 0 ? (
        <Card className="overflow-hidden">
          <div className="divide-y divide-emerald-100">
            {users.map((user) => (
              <UserRow
                key={user.id}
                onDelete={() => setDeleteTarget(user)}
                onEdit={() => setEditor({ mode: 'edit', user })}
                user={user}
              />
            ))}
          </div>
          <div className="flex flex-col gap-3 border-t border-emerald-100 px-5 py-4 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
            <span>
              Showing {showingFrom}–{showingTo} of {total}
            </span>
            <div className="flex gap-2">
              <Button
                disabled={!canGoBack}
                onClick={() => void loadUsers(page - 1)}
                size="sm"
                type="button"
                variant="outline"
              >
                Previous
              </Button>
              <Button
                disabled={!canGoForward}
                onClick={() => void loadUsers(page + 1)}
                size="sm"
                type="button"
                variant="outline"
              >
                Next
              </Button>
            </div>
          </div>
        </Card>
      ) : null}

      <UserEditorModal
        accessToken={accessToken}
        editor={editor}
        onClose={() => setEditor(null)}
        onSaved={async () => {
          setEditor(null)
          await refreshAfterChange()
        }}
      />
      <DeleteUserModal
        accessToken={accessToken}
        onClose={() => setDeleteTarget(null)}
        onDeleted={async () => {
          setDeleteTarget(null)
          await refreshAfterChange()
        }}
        user={deleteTarget}
      />
    </section>
  )
}

function UserRow({
  onDelete,
  onEdit,
  user,
}: {
  onDelete: () => void
  onEdit: () => void
  user: AdminUser
}) {
  return (
    <div className="flex flex-col gap-4 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="truncate font-semibold text-foreground">
            {user.first_name} {user.last_name}
          </p>
          <Badge variant={user.role === 'ADMIN' ? 'secondary' : 'outline'}>
            {user.role === 'ADMIN' ? 'Administrator' : 'User'}
          </Badge>
        </div>
        <p className="truncate text-sm text-muted-foreground">{user.email}</p>
        <p className="text-xs text-muted-foreground">@{user.username}</p>
      </div>
      <div className="flex shrink-0 gap-2">
        <Button onClick={onEdit} size="sm" type="button" variant="outline">
          <Pencil aria-hidden="true" className="size-3.5" />
          Edit
        </Button>
        <Button
          aria-label={`Delete ${user.email}`}
          onClick={onDelete}
          size="sm"
          type="button"
          variant="outline"
        >
          <Trash2 aria-hidden="true" className="size-3.5 text-destructive" />
          Delete
        </Button>
      </div>
    </div>
  )
}

function UserEditorModal({
  accessToken,
  editor,
  onClose,
  onSaved,
}: {
  accessToken: string | null
  editor: EditorState
  onClose: () => void
  onSaved: () => Promise<void>
}) {
  const existingUser = editor?.mode === 'edit' ? editor.user : null
  const [email, setEmail] = useState('')
  const [username, setUsername] = useState('')
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [role, setRole] = useState<'ADMIN' | 'USER'>('USER')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)

  useEffect(() => {
    setEmail(existingUser?.email ?? '')
    setUsername(existingUser?.username ?? '')
    setFirstName(existingUser?.first_name ?? '')
    setLastName(existingUser?.last_name ?? '')
    setRole(existingUser?.role ?? 'USER')
    setPassword('')
    setError(null)
  }, [existingUser, editor?.mode])

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!accessToken || isSaving) {
      return
    }

    setIsSaving(true)
    setError(null)
    try {
      if (existingUser) {
        const payload = {
          email,
          first_name: firstName,
          last_name: lastName,
          role,
          username,
          ...(password ? { password } : {}),
        }
        await updateAdminUser({
          accessToken,
          payload,
          userId: existingUser.id,
        })
      } else {
        const payload: AdminUserCreatePayload = {
          email,
          first_name: firstName,
          last_name: lastName,
          password,
          role,
          username,
        }
        await createAdminUser({ accessToken, payload })
      }
      await onSaved()
    } catch (saveError) {
      setError(getErrorMessage(saveError))
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <Modal
      description={
        existingUser
          ? 'Update account details, access level, or set a replacement password.'
          : 'Create a new traveller account with an initial password.'
      }
      onClose={onClose}
      open={editor !== null}
      title={existingUser ? 'Edit user' : 'Create user'}
    >
      <form className="space-y-5 p-1" onSubmit={submit}>
        <FormField label="Email" required>
          <Input
            autoComplete="email"
            onChange={(event) => setEmail(event.target.value)}
            required
            type="email"
            value={email}
          />
        </FormField>
        <div className="grid gap-5 sm:grid-cols-2">
          <FormField label="First name" required={!existingUser}>
            <Input
              autoComplete="given-name"
              maxLength={255}
              onChange={(event) => setFirstName(event.target.value)}
              required={!existingUser}
              value={firstName}
            />
          </FormField>
          <FormField label="Last name" required={!existingUser}>
            <Input
              autoComplete="family-name"
              maxLength={255}
              onChange={(event) => setLastName(event.target.value)}
              required={!existingUser}
              value={lastName}
            />
          </FormField>
        </div>
        <FormField hint="3–32 characters; letters, numbers, hyphens, underscores, and periods." label="Username" required>
          <Input
            autoComplete="username"
            maxLength={32}
            minLength={3}
            onChange={(event) => setUsername(event.target.value)}
            required
            value={username}
          />
        </FormField>
        <FormField label="Role" required>
          <Select
            ariaLabel="Role"
            onValueChange={setRole}
            options={[
              { label: 'User', value: 'USER' },
              { label: 'Administrator', value: 'ADMIN' },
            ]}
            value={role}
          />
        </FormField>
        <FormField
          hint={
            existingUser
              ? 'Leave empty to keep the current password.'
              : 'Use at least 8 characters.'
          }
          label={existingUser ? 'New password' : 'Password'}
          required={!existingUser}
        >
          <Input
            autoComplete="new-password"
            minLength={password ? 8 : undefined}
            onChange={(event) => setPassword(event.target.value)}
            required={!existingUser}
            type="password"
            value={password}
          />
        </FormField>
        {error ? (
          <p className="flex items-start gap-2 text-sm text-destructive" role="alert">
            <AlertCircle aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
            {error}
          </p>
        ) : null}
        <div className="flex justify-end gap-2 pt-1">
          <Button disabled={isSaving} onClick={onClose} type="button" variant="ghost">
            Cancel
          </Button>
          <Button disabled={isSaving} type="submit">
            <ShieldCheck aria-hidden="true" className="size-4" />
            {isSaving ? 'Saving…' : existingUser ? 'Save changes' : 'Create user'}
          </Button>
        </div>
      </form>
    </Modal>
  )
}

function DeleteUserModal({
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

  useEffect(() => {
    setError(null)
    setIsDeleting(false)
  }, [user])

  async function confirmDelete() {
    if (!accessToken || !user || isDeleting) {
      return
    }

    setIsDeleting(true)
    setError(null)
    try {
      await deleteAdminUser({ accessToken, userId: user.id })
      await onDeleted()
    } catch (deleteError) {
      setError(getErrorMessage(deleteError))
    } finally {
      setIsDeleting(false)
    }
  }

  return (
    <Modal
      description="This permanently deletes the account and its profile. This action cannot be undone."
      onClose={onClose}
      open={user !== null}
      title="Delete user?"
    >
      <div className="space-y-5 p-1">
        {user ? (
          <p className="rounded-xl bg-emerald-50 px-4 py-3 text-sm text-foreground">
            {user.first_name} {user.last_name} ({user.email})
          </p>
        ) : null}
        {error ? (
          <p className="flex items-start gap-2 text-sm text-destructive" role="alert">
            <AlertCircle aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
            {error}
          </p>
        ) : null}
        <div className="flex justify-end gap-2">
          <Button disabled={isDeleting} onClick={onClose} type="button" variant="ghost">
            Cancel
          </Button>
          <Button
            disabled={isDeleting}
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

function FormField({
  children,
  hint,
  label,
  required = false,
}: {
  children: ReactNode
  hint?: string
  label: string
  required?: boolean
}) {
  return (
    <label className="grid gap-2 text-sm font-medium text-foreground">
      <span>
        {label}
        {required ? <span aria-hidden="true"> *</span> : null}
      </span>
      {children}
      {hint ? <span className="text-xs font-normal leading-5 text-muted-foreground">{hint}</span> : null}
    </label>
  )
}

function SectionHeading({
  description,
  eyebrow,
  title,
}: {
  description: string
  eyebrow: string
  title: string
}) {
  return (
    <div className="space-y-2">
      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">
        {eyebrow}
      </p>
      <div className="space-y-1">
        <h2 className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
          {title}
        </h2>
        <p className="max-w-2xl text-sm leading-6 text-muted-foreground">
          {description}
        </p>
      </div>
    </div>
  )
}
