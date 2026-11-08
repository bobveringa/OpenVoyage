import type { ReactNode } from 'react'

/** A checkbox with a label and a short explanation, set apart in a panel. */
export function CheckboxField({
  checked,
  description,
  disabled,
  label,
  onChange,
}: {
  checked: boolean
  description: ReactNode
  disabled?: boolean
  label: ReactNode
  onChange: (checked: boolean) => void
}) {
  return (
    <label className="flex items-start gap-3 rounded-xl border border-border bg-muted/60 px-4 py-3 text-sm text-foreground has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-60">
      <input
        checked={checked}
        className="mt-0.5 size-4 rounded border-input accent-primary"
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
        type="checkbox"
      />
      <span>
        <span className="block font-medium">{label}</span>
        <span className="mt-1 block text-xs leading-5 text-muted-foreground">
          {description}
        </span>
      </span>
    </label>
  )
}
