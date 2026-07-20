import { Check, ChevronDown } from 'lucide-react'
import { cva } from 'class-variance-authority'
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react'

import { cn } from '@/lib/utils'

export type SelectOption<TValue extends string = string> = {
  disabled?: boolean
  label: string
  value: TValue
}

type SelectProps<TValue extends string = string> = {
  className?: string
  disabled?: boolean
  id?: string
  onValueChange: (value: TValue) => void
  options: readonly SelectOption<TValue>[]
  placeholder?: string
  value: TValue
}

const selectTriggerVariants = cva(
  'flex h-11 w-full items-center justify-between gap-3 rounded-2xl border border-emerald-100 bg-white px-3 py-2 text-left text-base text-foreground shadow-sm transition-colors hover:border-emerald-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50 md:text-sm',
)

const selectOptionVariants = cva(
  'flex min-h-10 w-full items-center justify-between gap-3 rounded-xl px-3 py-2 text-left text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-50',
  {
    variants: {
      active: {
        false: 'text-foreground hover:bg-emerald-50',
        true: 'bg-emerald-50 text-foreground',
      },
      selected: {
        false: '',
        true: 'font-medium text-primary',
      },
    },
  },
)

export function Select<TValue extends string = string>({
  className,
  disabled = false,
  id,
  onValueChange,
  options,
  placeholder = 'Select',
  value,
}: SelectProps<TValue>) {
  const generatedId = useId()
  const buttonId = id ?? generatedId
  const listboxId = `${buttonId}-listbox`
  const rootRef = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(-1)

  const selectedOption = useMemo(
    () => options.find((option) => option.value === value),
    [options, value],
  )

  useEffect(() => {
    if (!open) {
      return undefined
    }

    function handlePointerDown(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false)
      }
    }

    document.addEventListener('mousedown', handlePointerDown)
    return () => document.removeEventListener('mousedown', handlePointerDown)
  }, [open])

  function getInitialActiveIndex() {
    const selectedIndex = options.findIndex((option) => option.value === value)
    if (selectedIndex >= 0 && !options[selectedIndex]?.disabled) {
      return selectedIndex
    }

    return options.findIndex((option) => !option.disabled)
  }

  function getNextActiveIndex(currentIndex: number, direction: -1 | 1) {
    if (options.length === 0) {
      return -1
    }

    let nextIndex = currentIndex
    for (let checked = 0; checked < options.length; checked += 1) {
      nextIndex = (nextIndex + direction + options.length) % options.length
      if (!options[nextIndex]?.disabled) {
        return nextIndex
      }
    }

    return currentIndex
  }

  function openMenu() {
    if (disabled) {
      return
    }

    setActiveIndex(getInitialActiveIndex())
    setOpen(true)
  }

  function selectOption(option: SelectOption<TValue>) {
    if (option.disabled) {
      return
    }

    onValueChange(option.value)
    setOpen(false)
  }

  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (disabled) {
      return
    }

    if (event.key === 'ArrowDown') {
      event.preventDefault()
      if (!open) {
        openMenu()
        return
      }
      setActiveIndex((current) =>
        getNextActiveIndex(current >= 0 ? current : getInitialActiveIndex(), 1),
      )
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault()
      if (!open) {
        openMenu()
        return
      }
      setActiveIndex((current) =>
        getNextActiveIndex(current >= 0 ? current : getInitialActiveIndex(), -1),
      )
    }

    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      if (!open) {
        openMenu()
        return
      }

      const option = options[activeIndex]
      if (option) {
        selectOption(option)
      }
    }

    if (event.key === 'Escape') {
      if (open) {
        event.preventDefault()
        event.stopPropagation()
        setOpen(false)
      }
    }
  }

  return (
    <div className={cn('relative', className)} ref={rootRef}>
      <button
        aria-activedescendant={
          open && activeIndex >= 0 ? `${listboxId}-option-${activeIndex}` : undefined
        }
        aria-controls={listboxId}
        aria-expanded={open}
        aria-haspopup="listbox"
        className={selectTriggerVariants()}
        disabled={disabled}
        id={buttonId}
        onClick={() => (open ? setOpen(false) : openMenu())}
        onKeyDown={handleKeyDown}
        type="button"
      >
        <span className={cn(selectedOption ? '' : 'text-muted-foreground')}>
          {selectedOption?.label ?? placeholder}
        </span>
        <ChevronDown
          aria-hidden="true"
          className={cn(
            'size-4 shrink-0 text-muted-foreground transition-transform',
            open ? 'rotate-180' : '',
          )}
        />
      </button>

      {open ? (
        <div className="absolute left-0 right-0 z-30 mt-2 overflow-hidden rounded-2xl border border-emerald-100 bg-white p-1 shadow-xl shadow-emerald-950/10">
          <div
            aria-labelledby={buttonId}
            className="scrollbar-subtle max-h-56 overflow-auto"
            id={listboxId}
            role="listbox"
            tabIndex={-1}
          >
            {options.map((option, index) => {
              const selected = option.value === value
              return (
                <button
                  aria-selected={selected}
                  className={selectOptionVariants({
                    active: index === activeIndex,
                    selected,
                  })}
                  disabled={option.disabled}
                  id={`${listboxId}-option-${index}`}
                  key={option.value}
                  onClick={() => selectOption(option)}
                  onMouseEnter={() => {
                    if (!option.disabled) {
                      setActiveIndex(index)
                    }
                  }}
                  role="option"
                  type="button"
                >
                  <span>{option.label}</span>
                  <Check
                    aria-hidden="true"
                    className={cn(
                      'size-4 shrink-0 text-primary',
                      selected ? 'opacity-100' : 'opacity-0',
                    )}
                  />
                </button>
              )
            })}
          </div>
        </div>
      ) : null}
    </div>
  )
}
