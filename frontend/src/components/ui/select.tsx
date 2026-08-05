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
import { createPortal } from 'react-dom'

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

type SelectMenuPosition = {
  left: number
  maxHeight: number
  openAbove: boolean
  top: number
  width: number
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
  const menuRef = useRef<HTMLDivElement>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(-1)
  const [menuPosition, setMenuPosition] =
    useState<SelectMenuPosition | null>(null)

  const selectedOption = useMemo(
    () => options.find((option) => option.value === value),
    [options, value],
  )

  useEffect(() => {
    if (!open) {
      return undefined
    }

    function handlePointerDown(event: MouseEvent) {
      const target = event.target as Node
      if (
        !rootRef.current?.contains(target) &&
        !menuRef.current?.contains(target)
      ) {
        setOpen(false)
      }
    }

    document.addEventListener('mousedown', handlePointerDown)
    return () => document.removeEventListener('mousedown', handlePointerDown)
  }, [open])

  useEffect(() => {
    if (!open) {
      return undefined
    }

    function updateMenuPosition() {
      if (triggerRef.current) {
        setMenuPosition(getSelectMenuPosition(triggerRef.current))
      }
    }

    updateMenuPosition()
    window.addEventListener('resize', updateMenuPosition)
    window.addEventListener('scroll', updateMenuPosition, true)
    window.visualViewport?.addEventListener('resize', updateMenuPosition)
    window.visualViewport?.addEventListener('scroll', updateMenuPosition)

    return () => {
      window.removeEventListener('resize', updateMenuPosition)
      window.removeEventListener('scroll', updateMenuPosition, true)
      window.visualViewport?.removeEventListener('resize', updateMenuPosition)
      window.visualViewport?.removeEventListener('scroll', updateMenuPosition)
    }
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
    if (triggerRef.current) {
      setMenuPosition(getSelectMenuPosition(triggerRef.current))
    }
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

    if (event.key === 'Tab') {
      setOpen(false)
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
        ref={triggerRef}
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

      {open && menuPosition && typeof document !== 'undefined'
        ? createPortal(
            <div
              className="fixed z-[100] overflow-hidden rounded-2xl border border-emerald-100 bg-white p-1 shadow-xl shadow-emerald-950/10"
              ref={menuRef}
              style={{
                left: menuPosition.left,
                top: menuPosition.top,
                maxHeight: menuPosition.maxHeight + 10,
                transform: menuPosition.openAbove
                  ? 'translateY(-100%)'
                  : undefined,
                width: menuPosition.width,
              }}
            >
              <div
                aria-labelledby={buttonId}
                className="scrollbar-subtle overflow-auto"
                id={listboxId}
                role="listbox"
                style={{ maxHeight: menuPosition.maxHeight }}
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
                      tabIndex={-1}
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
            </div>,
            document.body,
          )
        : null}
    </div>
  )
}

function getSelectMenuPosition(
  trigger: HTMLButtonElement,
): SelectMenuPosition {
  const viewportPadding = 8
  const menuGap = 8
  const menuChromeHeight = 10
  const maxMenuHeight = 224
  const triggerBounds = trigger.getBoundingClientRect()
  const visualViewport = window.visualViewport
  const viewportLeft = visualViewport?.offsetLeft ?? 0
  const viewportTop = visualViewport?.offsetTop ?? 0
  const viewportWidth = visualViewport?.width ?? window.innerWidth
  const viewportHeight = visualViewport?.height ?? window.innerHeight
  const viewportRight = viewportLeft + viewportWidth
  const viewportBottom = viewportTop + viewportHeight
  const belowTop = Math.max(
    viewportTop + viewportPadding,
    triggerBounds.bottom + menuGap,
  )
  const aboveBottom = Math.min(
    viewportBottom - viewportPadding,
    triggerBounds.top - menuGap,
  )
  const spaceBelow = Math.max(
    0,
    viewportBottom - viewportPadding - belowTop,
  )
  const spaceAbove = Math.max(
    0,
    aboveBottom - viewportTop - viewportPadding,
  )
  let openAbove = spaceBelow < 160 && spaceAbove > spaceBelow
  let availableHeight = openAbove ? spaceAbove : spaceBelow
  let top = openAbove ? aboveBottom : belowTop

  if (availableHeight < 56) {
    openAbove = false
    availableHeight = Math.max(0, viewportHeight - viewportPadding * 2)
    top = viewportTop + viewportPadding
  }

  const width = Math.min(
    triggerBounds.width,
    viewportWidth - viewportPadding * 2,
  )
  const left = Math.min(
    Math.max(viewportLeft + viewportPadding, triggerBounds.left),
    viewportRight - viewportPadding - width,
  )

  return {
    left,
    maxHeight: Math.max(
      1,
      Math.min(maxMenuHeight, availableHeight - menuChromeHeight),
    ),
    openAbove,
    top,
    width,
  }
}
