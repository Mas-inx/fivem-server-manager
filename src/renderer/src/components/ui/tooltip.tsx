import * as T from '@radix-ui/react-tooltip'
import type { ReactNode } from 'react'
import { Kbd } from './misc'

export const TooltipProvider = T.Provider

export function Tooltip({
  content,
  children,
  side = 'top',
  shortcut
}: {
  content: ReactNode
  children: ReactNode
  side?: 'top' | 'bottom' | 'left' | 'right'
  shortcut?: string
}) {
  if (!content) return <>{children}</>
  return (
    <T.Root>
      <T.Trigger asChild>{children}</T.Trigger>
      <T.Portal>
        <T.Content
          side={side}
          sideOffset={6}
          className="z-50 flex animate-fade-in items-center gap-2 rounded-[6px] bg-overlay px-2 py-1 text-xs text-fg shadow-pop select-none"
        >
          {content}
          {shortcut && <Kbd>{shortcut}</Kbd>}
        </T.Content>
      </T.Portal>
    </T.Root>
  )
}
