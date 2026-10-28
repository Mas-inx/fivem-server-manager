import { forwardRef, useState, type InputHTMLAttributes, type ReactNode, type TextareaHTMLAttributes } from 'react'
import { Eye, EyeOff } from 'lucide-react'
import { cn } from '@/lib/utils'

const field =
  'w-full rounded-[7px] bg-sunken text-[13px] text-fg placeholder:text-fg-faint shadow-[inset_0_0_0_1px_var(--line-strong)] transition-shadow duration-100 hover:shadow-[inset_0_0_0_1px_var(--fg-faint)] focus:shadow-[inset_0_0_0_1px_var(--fg-subtle),0_0_0_3px_var(--active)] focus-visible:outline-none disabled:opacity-50'

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  leading?: ReactNode
  trailing?: ReactNode
  mono?: boolean
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { className, leading, trailing, mono, ...props },
  ref
) {
  if (!leading && !trailing) {
    return <input ref={ref} className={cn(field, 'h-8 px-2.5', mono && 'font-mono text-[12.5px]', className)} {...props} />
  }
  return (
    <div className={cn('relative flex items-center', className)}>
      {leading && <div className="pointer-events-none absolute left-2.5 flex text-fg-subtle">{leading}</div>}
      <input
        ref={ref}
        className={cn(field, 'h-8', leading ? 'pl-8' : 'pl-2.5', trailing ? 'pr-9' : 'pr-2.5', mono && 'font-mono text-[12.5px]')}
        {...props}
      />
      {trailing && <div className="absolute right-1 flex items-center">{trailing}</div>}
    </div>
  )
})

export const SecretInput = forwardRef<HTMLInputElement, InputProps>(function SecretInput(props, ref) {
  const [shown, setShown] = useState(false)
  return (
    <Input
      ref={ref}
      type={shown ? 'text' : 'password'}
      mono
      spellCheck={false}
      autoComplete="off"
      trailing={
        <button
          type="button"
          tabIndex={-1}
          onClick={() => setShown((v) => !v)}
          className="flex h-6 w-7 items-center justify-center rounded-[5px] text-fg-subtle hover:bg-hover hover:text-fg"
        >
          {shown ? <EyeOff size={14} strokeWidth={1.75} /> : <Eye size={14} strokeWidth={1.75} />}
        </button>
      }
      {...props}
    />
  )
})

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea(
  { className, ...props },
  ref
) {
  return <textarea ref={ref} className={cn(field, 'min-h-[72px] resize-none px-2.5 py-2 leading-5', className)} {...props} />
})

export function Field({
  label,
  hint,
  error,
  children,
  className,
  aside
}: {
  label?: ReactNode
  hint?: ReactNode
  error?: ReactNode
  children: ReactNode
  className?: string
  aside?: ReactNode
}) {
  return (
    <label className={cn('flex flex-col gap-1.5', className)}>
      {(label || aside) && (
        <span className="flex items-center justify-between text-xs font-medium text-fg-muted">
          {label}
          {aside}
        </span>
      )}
      {children}
      {error ? (
        <span className="text-xs text-err">{error}</span>
      ) : hint ? (
        <span className="text-xs leading-[18px] text-fg-subtle">{hint}</span>
      ) : null}
    </label>
  )
}
