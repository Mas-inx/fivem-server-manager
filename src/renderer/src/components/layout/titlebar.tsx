import * as Popover from '@radix-ui/react-popover'
import { CircleAlert, Search, X } from 'lucide-react'
import { Logo } from '@/components/logo'
import { UpdatePill } from '@/components/update-pill'
import { Kbd, Progress, Spinner } from '@/components/ui/misc'
import { api, cn } from '@/lib/utils'
import { useApp } from '@/store/app'

function Tasks() {
  const tasks = useApp((s) => s.tasks)
  if (!tasks.length) return null
  const running = tasks.filter((t) => t.state === 'running')
  const failed = tasks.filter((t) => t.state === 'error')
  const lead = running[0] ?? tasks[0]
  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button className="no-drag flex h-7 max-w-[260px] items-center gap-2 rounded-[7px] px-2.5 text-xs text-fg-muted transition-colors hover:bg-hover hover:text-fg">
          {running.length ? (
            <Spinner size={12} />
          ) : failed.length ? (
            <CircleAlert size={13} className="text-err" />
          ) : (
            <span className="h-1.5 w-1.5 rounded-full bg-ok" />
          )}
          <span className="truncate">{lead.title}</span>
          {lead.state === 'running' && lead.progress !== null && (
            <span className="tabular text-fg-subtle">{Math.round(lead.progress * 100)}%</span>
          )}
          {running.length > 1 && <span className="text-fg-subtle">+{running.length - 1}</span>}
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="end"
          sideOffset={6}
          className="z-50 w-[340px] animate-pop-in rounded-[12px] bg-overlay p-1.5 shadow-pop"
        >
          <div className="px-2 pt-1 pb-2 text-xs font-medium text-fg-subtle">Activity</div>
          <div className="flex flex-col">
            {tasks.map((t) => (
              <div key={t.id} className="group rounded-[8px] px-2 py-2 hover:bg-hover">
                <div className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate text-[13px] text-fg">{t.title}</span>
                  {t.state === 'done' && <span className="text-xs text-ok">Done</span>}
                  {t.state === 'error' && <span className="text-xs text-err">Failed</span>}
                  {t.state !== 'running' && (
                    <button
                      onClick={() => void api.tasks.dismiss(t.id)}
                      className="flex h-5 w-5 items-center justify-center rounded-[4px] text-fg-faint opacity-0 group-hover:opacity-100 hover:text-fg"
                    >
                      <X size={12} />
                    </button>
                  )}
                </div>
                {t.state === 'running' && <Progress value={t.progress} className="mt-2" />}
                {(t.detail || t.error) && (
                  <div className={cn('mt-1.5 truncate text-xs tabular', t.error ? 'text-err' : 'text-fg-subtle')}>
                    {t.error ?? t.detail}
                  </div>
                )}
              </div>
            ))}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}

export function TitleBar() {
  const setPaletteOpen = useApp((s) => s.setPaletteOpen)
  return (
    <header className="drag relative flex h-11 shrink-0 items-center">
      <div className="flex w-[232px] shrink-0 items-center gap-2.5 pl-4">
        <Logo size={18} />
        <span className="text-[13px] font-semibold tracking-[-0.01em] text-fg">Server Manager</span>
      </div>
      <div className="flex min-w-0 flex-1 items-center pr-[146px] pl-2">
        <div className="min-w-0 flex-1" />
        <button
          onClick={() => setPaletteOpen(true)}
          className="no-drag flex h-7 w-[360px] shrink items-center gap-2 rounded-[7px] bg-hover px-2.5 text-xs text-fg-subtle shadow-[inset_0_0_0_1px_var(--line)] transition-colors hover:bg-active hover:text-fg-muted"
        >
          <Search size={13} strokeWidth={1.75} />
          <span className="flex-1 truncate text-left">Search servers and actions</span>
          <Kbd>Ctrl K</Kbd>
        </button>
        <div className="flex min-w-0 flex-1 items-center justify-end gap-1.5 pl-3">
          <Tasks />
          <UpdatePill />
        </div>
      </div>
    </header>
  )
}
