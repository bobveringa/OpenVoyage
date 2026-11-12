import type { StopNotes } from '@/api/client'

export type NotesTextPart = { type: 'text' | 'link'; value: string }

const linkPattern = /https?:\/\/[^\s<>"']+/g

/** Split plain-text notes into text and http(s) links. */
export function splitNoteLinks(text: string): NotesTextPart[] {
  const parts: NotesTextPart[] = []
  let last = 0
  for (const match of text.matchAll(linkPattern)) {
    let link = match[0]
    // Leave sentence punctuation and an unmatched closing bracket outside.
    while (/[.,;:!?)\]]$/.test(link)) {
      const opens = link.split('(').length - 1
      const closes = link.split(')').length - 1
      if (link.endsWith(')') && opens >= closes) break
      link = link.slice(0, -1)
    }
    const start = match.index
    if (start > last) parts.push({ type: 'text', value: text.slice(last, start) })
    parts.push({ type: 'link', value: link })
    last = start + link.length
  }
  if (last < text.length) parts.push({ type: 'text', value: text.slice(last) })
  return parts
}

export type NotesSaveStatus = 'idle' | 'saving' | 'saved' | 'failed'

export type NotesAutosaveState = {
  status: NotesSaveStatus
  replacedBy: StopNotes['replaced_change_by']
}

export type NotesSaver = (notes: string, basedOn: string | null, keepalive: boolean) => Promise<StopNotes>

/**
 * Saves notes a short pause after typing stops, and on demand when the card
 * or tab closes. The last save wins; a save that replaced another member's
 * change reports who made it.
 */
export function createNotesAutosave(options: {
  basedOn: string | null
  delayMs?: number
  notes: string
  onSaved: (result: StopNotes) => void
  onState: (state: NotesAutosaveState) => void
  save: NotesSaver
}) {
  const delayMs = options.delayMs ?? 1000
  let savedNotes = options.notes
  let basedOn = options.basedOn
  let pending: string | null = null
  let saving = false
  let timer: ReturnType<typeof setTimeout> | null = null
  let state: NotesAutosaveState = { status: 'idle', replacedBy: null }

  function setState(next: Partial<NotesAutosaveState>) {
    state = { ...state, ...next }
    options.onState(state)
  }

  function clearTimer() {
    if (timer !== null) clearTimeout(timer)
    timer = null
  }

  async function send(keepalive: boolean) {
    const notes = pending
    if (notes === null) return
    saving = true
    setState({ status: 'saving' })
    try {
      const result = await options.save(notes, basedOn, keepalive)
      savedNotes = result.notes
      basedOn = result.notes_updated_at
      if (pending === notes) pending = null
      saving = false
      // The notice stays until the card closes, so it isn't missed.
      setState({ status: pending === null ? 'saved' : 'saving', replacedBy: state.replacedBy ?? result.replaced_change_by })
      options.onSaved(result)
      if (pending !== null) void send(false)
    } catch {
      saving = false
      setState({ status: 'failed' })
    }
  }

  return {
    change(notes: string) {
      clearTimer()
      pending = notes === savedNotes ? null : notes
      if (pending === null) {
        if (!saving && state.status === 'failed') setState({ status: 'saved' })
        return
      }
      timer = setTimeout(() => {
        timer = null
        if (!saving) void send(false)
      }, delayMs)
    },
    /** Save now, for example when the card closes. */
    flush(keepalive = false) {
      clearTimer()
      if (pending === null) return
      // At tab close the earlier request may not survive; send again.
      if (!saving || keepalive) void send(keepalive)
    },
    retry() {
      clearTimer()
      if (!saving) void send(false)
    },
    /** Adopt notes from a reload, unless there are unsaved changes. */
    sync(notes: string, notesUpdatedAt: string | null) {
      if (pending !== null || saving) return false
      savedNotes = notes
      basedOn = notesUpdatedAt
      return true
    },
    get hasUnsavedChanges() {
      return pending !== null
    },
  }
}

export type NotesAutosave = ReturnType<typeof createNotesAutosave>
