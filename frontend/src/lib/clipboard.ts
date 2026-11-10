// navigator.clipboard only exists in secure contexts, so a self-hosted server
// on plain http needs the legacy execCommand fallback. Resolves to whether the
// text actually reached the clipboard.
export async function copyTextToClipboard(text: string): Promise<boolean> {
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text)
      return true
    } catch {
      // Permission denied or document not focused: try the fallback.
    }
  }

  return copyWithExecCommand(text)
}

function copyWithExecCommand(text: string) {
  if (typeof document === 'undefined' || !document.body) return false

  const activeElement = document.activeElement
  const textarea = document.createElement('textarea')
  textarea.value = text
  textarea.setAttribute('readonly', '')
  textarea.style.position = 'fixed'
  textarea.style.top = '0'
  textarea.style.left = '0'
  textarea.style.opacity = '0'
  document.body.append(textarea)
  textarea.select()

  try {
    return document.execCommand('copy')
  } catch {
    return false
  } finally {
    textarea.remove()
    if (activeElement instanceof HTMLElement) activeElement.focus()
  }
}
