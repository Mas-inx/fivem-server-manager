import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { Spinner } from './misc'

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'danger-solid'
type Size = 'sm' | 'md' | 'lg'

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: Size
  icon?: ReactNode
  iconRight?: ReactNode
  loading?: boolean
  square?: boolean
}

const variants: Record<Variant, string> = {
  primary: 'bg-inverse text-inverse-fg hover:bg-inverse-hover',
  secondary: 'bg-raised text-fg shadow-[inset_0_0_0_1px_var(--line-strong)] hover:bg-raised-hover',
  ghost: 'text-fg-muted hover:text-fg hover:bg-hover',
  danger: 'text-err hover:bg-err/10',
  'danger-solid': 'bg-err text-white hover:brightness-110'
}

const sizes: Record<Size, string> = {
  sm: 'h-7 px-2.5 text-xs gap-1.5 rounded-[6px]',
  md: 'h-8 px-3 text-[13px] gap-1.5 rounded-[7px]',
  lg: 'h-9 px-4 text-[13px] gap-2 rounded-[8px]'
}

const squares: Record<Size, string> = {
  sm: 'h-7 w-7 rounded-[6px]',
  md: 'h-8 w-8 rounded-[7px]',
  lg: 'h-9 w-9 rounded-[8px]'
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', icon, iconRight, loading, square, className, children, disabled, ...props },
  ref
) {
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={cn(
        'relative inline-flex shrink-0 select-none items-center justify-center font-medium whitespace-nowrap transition-[background-color,color,box-shadow,filter] duration-100 disabled:pointer-events-none disabled:opacity-40',
        variants[variant],
        square ? squares[size] : sizes[size],
        className
      )}
      {...props}
    >
      {loading ? <Spinner size={size === 'sm' ? 12 : 14} /> : icon}
      {children}
      {iconRight}
    </button>
  )
})
