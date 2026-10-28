import * as S from '@radix-ui/react-switch'
import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

export function Switch({
  checked,
  onChange,
  disabled,
  className
}: {
  checked: boolean
  onChange: (checked: boolean) => void
  disabled?: boolean
  className?: string
}) {
  return (
    <S.Root
      checked={checked}
      onCheckedChange={onChange}
      disabled={disabled}
      className={cn(
        'relative inline-flex h-[18px] w-[30px] shrink-0 items-center rounded-full bg-line-strong transition-colors duration-150 data-[state=checked]:bg-inverse disabled:opacity-40',
        className
      )}
    >
      <S.Thumb className="block h-[14px] w-[14px] translate-x-[2px] rounded-full bg-fg shadow-sm transition-transform duration-150 data-[state=checked]:translate-x-[14px] data-[state=checked]:bg-inverse-fg" />
    </S.Root>
  )
}

/** A settings row: title and description on the left, a control on the right. */
export function SettingRow({
  title,
  description,
  children,
  className
}: {
  title: ReactNode
  description?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <div className={cn('flex items-center justify-between gap-8 py-3.5', className)}>
      <div className="min-w-0">
        <div className="text-[13px] text-fg">{title}</div>
        {description && <div className="mt-0.5 text-xs leading-[18px] text-fg-subtle">{description}</div>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  )
}
