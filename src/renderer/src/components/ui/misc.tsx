import { useState, type ReactNode } from 'react'
import { Check, Copy } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Tooltip } from './tooltip'

export function Spinner({ size = 14, className }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      className={cn('shrink-0 animate-[spin_0.7s_linear_infinite]', className)}
    >
      <circle cx="8" cy="8" r="6.25" stroke="currentColor" strokeOpacity="0.2" strokeWidth="1.75" />
      <path d="M14.25 8A6.25 6.25 0 0 0 8 1.75" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
    </svg>
  )
}

export function Badge({
  children,
  className,
  tone = 'neutral'
}: {
  children: ReactNode
  className?: string
  tone?: 'neutral' | 'ok' | 'warn' | 'err' | 'outline'
}) {
  const tones = {
    neutral: 'bg-active text-fg-muted',
    outline: 'shadow-[inset_0_0_0_1px_var(--line-strong)] text-fg-muted',
    ok: 'bg-ok/12 text-ok',
    warn: 'bg-warn/12 text-warn',
    err: 'bg-err/12 text-err'
  }
  return (
    <span
      className={cn(
        'inline-flex h-5 items-center gap-1 rounded-[5px] px-1.5 text-2xs font-medium whitespace-nowrap',
        tones[tone],
        className
      )}
    >
      {children}
    </span>
  )
}

export function Progress({ value, className }: { value: number | null; className?: string }) {
  return (
    <div className={cn('relative h-1 w-full overflow-hidden rounded-full bg-active', className)}>
      {value === null ? (
        <div className="absolute inset-y-0 w-2/5 animate-[indeterminate_1.2s_ease-in-out_infinite] rounded-full bg-fg-muted" />
      ) : (
        <div
          className="h-full rounded-full bg-fg transition-[width] duration-300 ease-out"
          style={{ width: `${Math.max(2, Math.min(100, value * 100))}%` }}
        />
      )}
    </div>
  )
}

export function Kbd({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <kbd
      className={cn(
        'inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-[4px] px-1 font-sans text-[10.5px] font-medium text-fg-subtle shadow-[inset_0_0_0_1px_var(--line-strong)]',
        className
      )}
    >
      {children}
    </kbd>
  )
}

export function EmptyState({
  icon,
  title,
  description,
  children,
  className
}: {
  icon?: ReactNode
  title: string
  description?: ReactNode
  children?: ReactNode
  className?: string
}) {
  return (
    <div className={cn('flex flex-col items-center justify-center px-6 py-16 text-center', className)}>
      {icon && (
        <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-[11px] bg-raised text-fg-muted shadow-[inset_0_0_0_1px_var(--line-strong)]">
          {icon}
        </div>
      )}
      <div className="text-[14px] font-medium text-fg">{title}</div>
      {description && <div className="mt-1 max-w-sm text-[13px] text-fg-subtle">{description}</div>}
      {children && <div className="mt-5 flex items-center gap-2">{children}</div>}
    </div>
  )
}

export function CopyButton({ value, label = 'Copy', className }: { value: string; label?: string; className?: string }) {
  const [done, setDone] = useState(false)
  return (
    <Tooltip content={done ? 'Copied' : label}>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          void navigator.clipboard.writeText(value)
          setDone(true)
          setTimeout(() => setDone(false), 1400)
        }}
        className={cn(
          'inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-[5px] text-fg-subtle transition-colors hover:bg-hover hover:text-fg',
          className
        )}
      >
        {done ? <Check size={13} strokeWidth={2} /> : <Copy size={13} strokeWidth={1.75} />}
      </button>
    </Tooltip>
  )
}

export function Separator({ className, vertical }: { className?: string; vertical?: boolean }) {
  return <div className={cn(vertical ? 'w-px self-stretch' : 'h-px w-full', 'bg-line', className)} />
}

export function SectionTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-2.5 flex h-7 items-center justify-between">
      <h3 className="text-[13px] font-medium text-fg">{children}</h3>
      {action}
    </div>
  )
}
