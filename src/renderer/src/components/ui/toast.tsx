import { CircleAlert, CircleCheck, Info, X } from 'lucide-react'
import { useEffect } from 'react'
import { create } from 'zustand'
import type { ToastEvent } from '@shared/types'
import { api, cn } from '@/lib/utils'

interface ToastItem extends ToastEvent {
  id: number
}

const useToasts = create<{ items: ToastItem[] }>(() => ({ items: [] }))
let seq = 0

export function toast(t: ToastEvent): void {
  const id = ++seq
  useToasts.setState((s) => ({ items: [...s.items.slice(-3), { ...t, id }] }))
  setTimeout(() => dismiss(id), t.kind === 'error' ? 7000 : 4000)
}

function dismiss(id: number): void {
  useToasts.setState((s) => ({ items: s.items.filter((x) => x.id !== id) }))
}

/** Runs an action and reports failures as a toast; returns whether it succeeded. */
export async function attempt(fn: () => Promise<unknown>, errorTitle = 'Something went wrong'): Promise<boolean> {
  try {
    await fn()
    return true
  } catch (err) {
    toast({ kind: 'error', title: errorTitle, description: err instanceof Error ? err.message : String(err) })
    return false
  }
}

const icons = {
  info: <Info size={15} strokeWidth={1.75} className="text-fg-muted" />,
  success: <CircleCheck size={15} strokeWidth={1.75} className="text-ok" />,
  error: <CircleAlert size={15} strokeWidth={1.75} className="text-err" />
}

export function Toaster() {
  const items = useToasts((s) => s.items)
  useEffect(() => api.on.toast((t) => toast(t)), [])
  return (
    <div className="pointer-events-none fixed right-4 bottom-4 z-[60] flex w-[340px] flex-col gap-2">
      {items.map((t) => (
        <div
          key={t.id}
          className={cn(
            'pointer-events-auto flex animate-slide-up items-start gap-2.5 rounded-[10px] bg-overlay px-3 py-2.5 shadow-pop'
          )}
        >
          <span className="mt-0.5">{icons[t.kind]}</span>
          <div className="min-w-0 flex-1">
            <div className="text-[13px] font-medium text-fg">{t.title}</div>
            {t.description && <div className="mt-0.5 text-xs leading-[18px] break-words text-fg-subtle">{t.description}</div>}
          </div>
          <button
            onClick={() => dismiss(t.id)}
            className="-mr-1 flex h-5 w-5 items-center justify-center rounded-[4px] text-fg-faint hover:bg-hover hover:text-fg"
          >
            <X size={12} />
          </button>
        </div>
      ))}
    </div>
  )
}
