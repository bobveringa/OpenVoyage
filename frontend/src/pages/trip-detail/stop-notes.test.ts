import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { StopNotes } from '@/api/client'
import { createNotesAutosave, splitNoteLinks, type NotesAutosaveState } from './stop-notes'

describe('splitNoteLinks', () => {
  it('finds http and https links and leaves punctuation outside', () => {
    expect(splitNoteLinks('Tickets: https://example.com/a?b=1. And http://x.org/(info)!')).toEqual([
      { type: 'text', value: 'Tickets: ' },
      { type: 'link', value: 'https://example.com/a?b=1' },
      { type: 'text', value: '. And ' },
      { type: 'link', value: 'http://x.org/(info)' },
      { type: 'text', value: '!' },
    ])
  })

  it('ignores other schemes and plain text', () => {
    expect(splitNoteLinks('ftp://x and javascript:alert(1)')).toEqual([
      { type: 'text', value: 'ftp://x and javascript:alert(1)' },
    ])
  })
})

function last<T>(items: readonly T[]) {
  return items[items.length - 1]
}

describe('createNotesAutosave', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  function setup(save = vi.fn(async (notes: string): Promise<StopNotes> => ({
    notes, notes_updated_at: `t-${notes}`, replaced_change_by: null,
  }))) {
    const states: NotesAutosaveState[] = []
    const saved: StopNotes[] = []
    const autosave = createNotesAutosave({
      basedOn: 't0', notes: 'start', save,
      onSaved: (result) => saved.push(result), onState: (state) => states.push(state),
    })
    return { autosave, save, states, saved }
  }

  it('saves once, a second after typing stops, based on the last seen version', async () => {
    const { autosave, save, states } = setup()
    autosave.change('st')
    vi.advanceTimersByTime(500)
    autosave.change('stop here')
    vi.advanceTimersByTime(999)
    expect(save).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(save).toHaveBeenCalledExactlyOnceWith('stop here', 't0', false)
    expect(last(states)?.status).toBe('saved')
    autosave.change('stop here again')
    await vi.advanceTimersByTimeAsync(1000)
    expect(save).toHaveBeenLastCalledWith('stop here again', 't-stop here', false)
  })

  it('does not save text that matches what is stored', async () => {
    const { autosave, save } = setup()
    autosave.change('start!')
    autosave.change('start')
    await vi.advanceTimersByTimeAsync(2000)
    autosave.flush()
    expect(save).not.toHaveBeenCalled()
  })

  it('flushes immediately with keepalive when the tab closes', async () => {
    const { autosave, save } = setup()
    autosave.change('last words')
    autosave.flush(true)
    expect(save).toHaveBeenCalledExactlyOnceWith('last words', 't0', true)
    await vi.advanceTimersByTimeAsync(2000)
    expect(save).toHaveBeenCalledTimes(1)
  })

  it('keeps the text after a failure and saves it on retry', async () => {
    const save = vi.fn<(notes: string) => Promise<StopNotes>>()
      .mockRejectedValueOnce(new Error('offline'))
      .mockImplementation(async (notes) => ({ notes, notes_updated_at: 't1', replaced_change_by: null }))
    const { autosave, states, saved } = setup(save)
    autosave.change('unsent')
    await vi.advanceTimersByTimeAsync(1000)
    expect(last(states)?.status).toBe('failed')
    expect(autosave.hasUnsavedChanges).toBe(true)
    autosave.retry()
    await vi.advanceTimersByTimeAsync(0)
    expect(last(states)?.status).toBe('saved')
    expect(last(saved)?.notes).toBe('unsent')
  })

  it('keeps the replaced-change notice until the card closes', async () => {
    const anna = { id: 'anna', first_name: 'Anna', last_name: null, username: null }
    const save = vi.fn<(notes: string) => Promise<StopNotes>>()
      .mockResolvedValueOnce({ notes: 'a', notes_updated_at: 't1', replaced_change_by: anna })
      .mockResolvedValueOnce({ notes: 'ab', notes_updated_at: 't2', replaced_change_by: null })
    const { autosave, states } = setup(save)
    autosave.change('a')
    await vi.advanceTimersByTimeAsync(1000)
    autosave.change('ab')
    await vi.advanceTimersByTimeAsync(1000)
    expect(last(states)?.replacedBy).toEqual(anna)
  })

  it('adopts reloaded notes only without unsaved changes', () => {
    const { autosave } = setup()
    expect(autosave.sync('from server', 't5')).toBe(true)
    autosave.change('typing')
    expect(autosave.sync('newer', 't6')).toBe(false)
  })
})
