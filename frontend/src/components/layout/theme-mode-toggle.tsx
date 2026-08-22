import { Moon, Sun } from 'lucide-react'

import { cn } from '@/lib/utils'
import { useTheme, type ThemeModePreference } from '@/theme'

const options: Array<{
  icon: typeof Sun
  label: string
  value: ThemeModePreference
}> = [
  { icon: Sun, label: 'Use light appearance', value: 'light' },
  { icon: Moon, label: 'Use dark appearance', value: 'dark' },
]

export function ThemeModeToggle() {
  const { preference, setPreference } = useTheme()

  return (
    <div
      aria-label="Color mode"
      className="inline-flex items-center rounded-xl border border-border bg-card p-1 shadow-sm"
      role="group"
    >
      {options.map(({ icon: Icon, label, value }) => (
        <button
          aria-label={label}
          aria-pressed={preference === value}
          className={cn(
            'grid size-8 place-items-center rounded-lg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
            preference === value
              ? 'bg-primary text-primary-foreground shadow-sm'
              : 'text-muted-foreground hover:bg-muted hover:text-foreground',
          )}
          key={value}
          onClick={() => setPreference(value)}
          title={label}
          type="button"
        >
          <Icon aria-hidden="true" className="size-4" />
        </button>
      ))}
    </div>
  )
}
