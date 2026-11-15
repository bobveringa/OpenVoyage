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
  let draftNotes = options.notes
  let basedOn = options.basedOn
  let saving = false
  let keepaliveRequested = false
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

  async function send() {
    if (saving || draftNotes === savedNotes) return
    const notes = draftNotes
    const keepalive = keepaliveRequested
    keepaliveRequested = false
    saving = true
    setState({ status: 'saving' })
    try {
      const result = await options.save(notes, basedOn, keepalive)
      savedNotes = result.notes
      basedOn = result.notes_updated_at
      saving = false
      const hasPendingDraft = draftNotes !== savedNotes
      if (!hasPendingDraft) keepaliveRequested = false
      // The notice stays until the card closes, so it isn't missed.
      setState({ status: hasPendingDraft ? 'saving' : 'saved', replacedBy: state.replacedBy ?? result.replaced_change_by })
      options.onSaved(result)
      if (hasPendingDraft) void send()
    } catch {
      saving = false
      setState({ status: 'failed' })
    }
  }

  return {
    change(notes: string) {
      clearTimer()
      draftNotes = notes
      if (saving || draftNotes === savedNotes) {
        if (!saving && state.status === 'failed') setState({ status: 'saved' })
        return
      }
      timer = setTimeout(() => {
        timer = null
        void send()
      }, delayMs)
    },
    /** Save now, for example when the card closes. */
    flush(keepalive = false) {
      clearTimer()
      if (!saving && draftNotes === savedNotes) return
      // A close can request keepalive for the next save, while the current
      // request finishes before another write goes out.
      keepaliveRequested ||= keepalive
      void send()
    },
    retry() {
      clearTimer()
      void send()
    },
    /** Adopt notes from a reload, unless there are unsaved changes. */
    sync(notes: string, notesUpdatedAt: string | null) {
      if (saving || draftNotes !== savedNotes) return false
      savedNotes = notes
      draftNotes = notes
      basedOn = notesUpdatedAt
      return true
    },
    get hasUnsavedChanges() {
      return saving || draftNotes !== savedNotes
    },
  }
}

export type NotesAutosave = ReturnType<typeof createNotesAutosave>
