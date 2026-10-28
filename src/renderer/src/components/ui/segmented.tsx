import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

export interface SegmentedOption<T extends string> {
  value: T
  label: ReactNode
  icon?: ReactNode
  disabled?: boolean
}

export function Segmented<T extends string>({
  value,
  onChange,
  options,
  className,
  size = 'md'
}: {
  value: T
  onChange: (value: T) => void
  options: SegmentedOption<T>[]
  className?: string
  size?: 'sm' | 'md'
}) {
  return (
    <div
      role="radiogroup"
      className={cn(
        'inline-flex rounded-[8px] bg-sunken p-[3px] shadow-[inset_0_0_0_1px_var(--line)]',
        size === 'sm' ? 'h-7' : 'h-8',
        className
      )}
    >
      {options.map((o) => {
        const active = o.value === value
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={active}
            disabled={o.disabled}
            onClick={() => onChange(o.value)}
            className={cn(
              'flex flex-1 items-center justify-center gap-1.5 rounded-[6px] px-2.5 font-medium whitespace-nowrap transition-[background-color,color,box-shadow] duration-100 disabled:opacity-40',
              size === 'sm' ? 'text-xs' : 'text-[13px]',
              active
                ? 'bg-raised text-fg shadow-[0_0_0_1px_var(--line-strong),0_1px_2px_rgb(0_0_0/0.15)]'
                : 'text-fg-subtle hover:text-fg-muted'
            )}
          >
            {o.icon}
            {o.label}
          </button>
        )
      })}
    </div>
  )
}

/** Larger radio cards for choices that need a short explanation. */
export function ChoiceCards<T extends string>({
  value,
  onChange,
  options,
  columns = 2
}: {
  value: T
  onChange: (value: T) => void
  options: { value: T; title: ReactNode; description: ReactNode; icon?: ReactNode; badge?: ReactNode; disabled?: boolean }[]
  columns?: 2 | 3
}) {
  return (
    <div className={cn('grid gap-2', columns === 3 ? 'grid-cols-3' : 'grid-cols-2')}>
      {options.map((o) => {
        const active = o.value === value
        return (
          <button
            key={o.value}
            type="button"
            disabled={o.disabled}
            onClick={() => onChange(o.value)}
            className={cn(
              'group flex flex-col items-start rounded-[10px] p-3 text-left transition-[background-color,box-shadow] duration-100 disabled:opacity-40',
              active
                ? 'bg-raised shadow-[inset_0_0_0_1px_var(--fg-subtle)]'
                : 'shadow-[inset_0_0_0_1px_var(--line-strong)] hover:bg-hover'
            )}
          >
            <div className="flex w-full items-center gap-2">
              {o.icon && <span className={cn('flex', active ? 'text-fg' : 'text-fg-subtle')}>{o.icon}</span>}
              <span className="text-[13px] font-medium text-fg">{o.title}</span>
              {o.badge && <span className="ml-auto">{o.badge}</span>}
              <span
                className={cn(
                  'flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full shadow-[inset_0_0_0_1.5px_var(--fg-faint)]',
                  !o.badge && 'ml-auto',
                  active && 'shadow-[inset_0_0_0_4px_var(--fg)]'
                )}
              />
            </div>
            <div className="mt-1 text-xs leading-[18px] text-fg-subtle">{o.description}</div>
          </button>
        )
      })}
    </div>
  )
}
