import type { ServerStatus } from '@shared/types'
import { cn } from '@/lib/utils'

export const statusLabel: Record<ServerStatus, string> = {
  running: 'Running',
  starting: 'Starting',
  stopping: 'Stopping',
  crashed: 'Crashed',
  stopped: 'Stopped'
}

export function StatusDot({ status, className }: { status: ServerStatus | undefined; className?: string }) {
  const s = status ?? 'stopped'
  return (
    <span className={cn('relative inline-flex h-2 w-2 shrink-0', className)}>
      {s === 'running' && <span className="absolute -inset-[3px] rounded-full bg-ok/20" />}
      <span
        className={cn(
          'relative h-2 w-2 rounded-full',
          s === 'running' && 'bg-ok',
          (s === 'starting' || s === 'stopping') && 'breathe bg-warn',
          s === 'crashed' && 'bg-err',
          s === 'stopped' && 'bg-fg-faint'
        )}
      />
    </span>
  )
}

export function StatusText({ status, className }: { status: ServerStatus | undefined; className?: string }) {
  const s = status ?? 'stopped'
  return (
    <span className={cn('inline-flex items-center gap-2 text-[13px]', className)}>
      <StatusDot status={s} />
      <span className={cn(s === 'stopped' ? 'text-fg-subtle' : s === 'crashed' ? 'text-err' : 'text-fg')}>
        {statusLabel[s]}
      </span>
    </span>
  )
}
