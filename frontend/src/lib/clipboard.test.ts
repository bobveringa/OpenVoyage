import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { copyTextToClipboard } from './clipboard'

const execCommand = vi.fn<(command: string) => boolean>()

beforeEach(() => {
  execCommand.mockReset()
  Object.defineProperty(document, 'execCommand', {
    configurable: true,
    value: execCommand,
  })
})

afterEach(() => vi.unstubAllGlobals())

it('uses the async clipboard API when available', async () => {
  const writeText = vi.fn().mockResolvedValue(undefined)
  vi.stubGlobal('navigator', { clipboard: { writeText } })

  expect(await copyTextToClipboard('https://voyage.example/s')).toBe(true)
  expect(writeText).toHaveBeenCalledWith('https://voyage.example/s')
  expect(execCommand).not.toHaveBeenCalled()
})

it('falls back to execCommand on plain http where navigator.clipboard is missing', async () => {
  vi.stubGlobal('navigator', {})
  let copiedValue: string | undefined
  execCommand.mockImplementation(() => {
    copiedValue = document.querySelector('textarea')?.value
    return true
  })

  expect(await copyTextToClipboard('http://192.168.1.20/trips/t')).toBe(true)
  expect(execCommand).toHaveBeenCalledWith('copy')
  expect(copiedValue).toBe('http://192.168.1.20/trips/t')
  expect(document.querySelector('textarea')).toBeNull()
})

it('falls back when the clipboard API rejects', async () => {
  vi.stubGlobal('navigator', {
    clipboard: { writeText: vi.fn().mockRejectedValue(new Error('denied')) },
  })
  execCommand.mockReturnValue(true)

  expect(await copyTextToClipboard('text')).toBe(true)
})

it('reports failure instead of claiming success', async () => {
  vi.stubGlobal('navigator', {})
  execCommand.mockReturnValue(false)

  expect(await copyTextToClipboard('text')).toBe(false)
})
