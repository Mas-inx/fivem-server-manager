import * as S from '@radix-ui/react-select'
import { Check, ChevronsUpDown } from 'lucide-react'
import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

export interface SelectOption {
  value: string
  label: ReactNode
  hint?: ReactNode
  disabled?: boolean
}

export function Select({
  value,
  onChange,
  options,
  placeholder,
  className,
  disabled,
  mono
}: {
  value: string | undefined
  onChange: (value: string) => void
  options: SelectOption[]
  placeholder?: string
  className?: string
  disabled?: boolean
  mono?: boolean
}) {
  return (
    <S.Root value={value} onValueChange={onChange} disabled={disabled}>
      <S.Trigger
        className={cn(
          'flex h-8 w-full items-center justify-between gap-2 rounded-[7px] bg-sunken px-2.5 text-left text-[13px] text-fg shadow-[inset_0_0_0_1px_var(--line-strong)] transition-shadow hover:shadow-[inset_0_0_0_1px_var(--fg-faint)] focus-visible:outline-none data-[placeholder]:text-fg-faint data-[state=open]:shadow-[inset_0_0_0_1px_var(--fg-subtle),0_0_0_3px_var(--active)] disabled:opacity-50',
          mono && 'font-mono text-[12.5px]',
          className
        )}
      >
        <span className="truncate">
          <S.Value placeholder={placeholder} />
        </span>
        <S.Icon>
          <ChevronsUpDown size={13} className="text-fg-subtle" />
        </S.Icon>
      </S.Trigger>
      <S.Portal>
        <S.Content
          position="popper"
          sideOffset={4}
          className="z-50 max-h-[min(340px,var(--radix-select-content-available-height))] min-w-[var(--radix-select-trigger-width)] animate-pop-in overflow-hidden rounded-[9px] bg-overlay p-1 shadow-pop"
        >
          <S.Viewport>
            {options.map((o) => (
              <S.Item
                key={o.value}
                value={o.value}
                disabled={o.disabled}
                className="relative flex h-8 items-center gap-2 rounded-[6px] pr-8 pl-2.5 text-[13px] text-fg outline-none select-none data-[disabled]:opacity-40 data-[highlighted]:bg-active"
              >
                <S.ItemText>
                  <span className={cn(mono && 'font-mono text-[12.5px]')}>{o.label}</span>
                </S.ItemText>
                {o.hint && <span className="ml-auto text-xs text-fg-subtle">{o.hint}</span>}
                <S.ItemIndicator className="absolute right-2.5">
                  <Check size={13} strokeWidth={2} />
                </S.ItemIndicator>
              </S.Item>
            ))}
          </S.Viewport>
        </S.Content>
      </S.Portal>
    </S.Root>
  )
}
