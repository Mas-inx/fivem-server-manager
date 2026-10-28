import * as D from '@radix-ui/react-dialog'
import { X } from 'lucide-react'
import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

export function Dialog({
  open,
  onOpenChange,
  children,
  className,
  width = 480,
  dismissable = true
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  children: ReactNode
  className?: string
  width?: number
  dismissable?: boolean
}) {
  return (
    <D.Root open={open} onOpenChange={(o) => (dismissable || o ? onOpenChange(o) : undefined)}>
      <D.Portal>
        <D.Overlay className="fixed inset-0 z-40 animate-fade-in bg-[var(--scrim)]" />
        <D.Content
          aria-describedby={undefined}
          onInteractOutside={(e) => !dismissable && e.preventDefault()}
          onEscapeKeyDown={(e) => !dismissable && e.preventDefault()}
          style={{ width }}
          className={cn(
            'fixed top-1/2 left-1/2 z-50 flex max-h-[calc(100vh-80px)] max-w-[calc(100vw-48px)] -translate-x-1/2 -translate-y-1/2 animate-pop-in flex-col overflow-hidden rounded-[14px] bg-panel shadow-pop focus:outline-none',
            className
          )}
        >
          {children}
        </D.Content>
      </D.Portal>
    </D.Root>
  )
}

export function DialogHeader({
  title,
  description,
  onClose
}: {
  title: ReactNode
  description?: ReactNode
  onClose?: () => void
}) {
  return (
    <div className="flex items-start justify-between gap-4 px-5 pt-5 pb-1">
      <div>
        <D.Title className="text-[15px] font-semibold tracking-[-0.01em] text-fg">{title}</D.Title>
        {description && <p className="mt-1 text-[13px] leading-5 text-fg-subtle">{description}</p>}
      </div>
      {onClose && (
        <button
          type="button"
          onClick={onClose}
          className="-mt-0.5 -mr-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-[6px] text-fg-subtle hover:bg-hover hover:text-fg"
        >
          <X size={15} strokeWidth={1.75} />
        </button>
      )}
    </div>
  )
}

export function DialogBody({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('min-h-0 flex-1 overflow-y-auto px-5 py-4', className)}>{children}</div>
}

export function DialogFooter({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn('flex items-center justify-end gap-2 border-t border-line bg-sunken/60 px-5 py-3', className)}>
      {children}
    </div>
  )
}
