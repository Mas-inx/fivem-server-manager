import * as M from '@radix-ui/react-dropdown-menu'
import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

export function Menu({
  trigger,
  children,
  align = 'end',
  width = 200
}: {
  trigger: ReactNode
  children: ReactNode
  align?: 'start' | 'end' | 'center'
  width?: number
}) {
  return (
    <M.Root modal={false}>
      <M.Trigger asChild>{trigger}</M.Trigger>
      <M.Portal>
        <M.Content
          align={align}
          sideOffset={6}
          style={{ minWidth: width }}
          onClick={(e) => e.stopPropagation()}
          className="z-50 animate-pop-in rounded-[10px] bg-overlay p-1 shadow-pop"
        >
          {children}
        </M.Content>
      </M.Portal>
    </M.Root>
  )
}

export function MenuItem({
  icon,
  children,
  onSelect,
  danger,
  disabled,
  shortcut
}: {
  icon?: ReactNode
  children: ReactNode
  onSelect?: () => void
  danger?: boolean
  disabled?: boolean
  shortcut?: ReactNode
}) {
  return (
    <M.Item
      disabled={disabled}
      onSelect={onSelect}
      className={cn(
        'flex h-8 items-center gap-2.5 rounded-[6px] px-2 text-[13px] outline-none select-none data-[disabled]:opacity-40 data-[highlighted]:bg-active',
        danger ? 'text-err' : 'text-fg'
      )}
    >
      {icon && <span className={cn('flex w-4 justify-center', danger ? 'text-err' : 'text-fg-subtle')}>{icon}</span>}
      <span className="flex-1">{children}</span>
      {shortcut && <span className="text-xs text-fg-subtle">{shortcut}</span>}
    </M.Item>
  )
}

export function MenuSeparator() {
  return <M.Separator className="mx-1 my-1 h-px bg-line" />
}

export function MenuLabel({ children }: { children: ReactNode }) {
  return <M.Label className="px-2 pt-1.5 pb-1 text-2xs font-medium text-fg-subtle">{children}</M.Label>
}
