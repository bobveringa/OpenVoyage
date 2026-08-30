import type { InputHTMLAttributes } from 'react'

import { cn } from '@/lib/utils'

type SwitchProps = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  'className' | 'type'
> & {
  className?: string
  onCheckedChange?: (checked: boolean) => void
}

/** A compact, accessible binary control for settings rows. */
export function Switch({
  checked,
  className,
  disabled,
  id,
  onChange,
  onCheckedChange,
  ...props
}: SwitchProps) {
  return (
    <label
      className={cn(
        'relative inline-flex h-6 w-10 shrink-0 cursor-pointer rounded-full border border-input bg-muted p-0.5 transition-colors has-[:checked]:border-primary has-[:checked]:bg-primary has-[:focus-visible]:outline-none has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring has-[:focus-visible]:ring-offset-2 has-[:focus-visible]:ring-offset-background has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-50',
        className,
      )}
    >
      <input
        checked={checked}
        className="peer sr-only"
        disabled={disabled}
        id={id}
        onChange={(event) => {
          onChange?.(event)
          onCheckedChange?.(event.target.checked)
        }}
        role="switch"
        type="checkbox"
        {...props}
      />
      <span className="size-4 rounded-full bg-card shadow-sm transition-transform peer-checked:translate-x-4" />
    </label>
  )
}
