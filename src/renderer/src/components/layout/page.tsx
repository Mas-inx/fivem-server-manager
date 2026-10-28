import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

export function Page({ children, className, wide }: { children: ReactNode; className?: string; wide?: boolean }) {
  return (
    <div className="h-full overflow-y-auto">
      <div className={cn('mx-auto px-8 pt-7 pb-12', wide ? 'max-w-[1280px]' : 'max-w-[1040px]', className)}>
        {children}
      </div>
    </div>
  )
}

export function PageHeader({
  title,
  description,
  actions
}: {
  title: ReactNode
  description?: ReactNode
  actions?: ReactNode
}) {
  return (
    <div className="mb-7 flex items-end justify-between gap-6">
      <div className="min-w-0">
        <h1 className="text-[22px] leading-7 font-semibold tracking-[-0.02em] text-fg">{title}</h1>
        {description && <p className="mt-1 text-[13px] text-fg-subtle">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  )
}

/** A bordered surface used for lists and grouped content. */
export function Panel({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn('overflow-hidden rounded-[12px] bg-raised/40 shadow-[inset_0_0_0_1px_var(--line)]', className)}>
      {children}
    </div>
  )
}
