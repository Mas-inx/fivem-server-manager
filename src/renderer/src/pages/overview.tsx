import { ArrowRight, Database, FolderInput, Plus, Server } from 'lucide-react'
import type { ReactNode } from 'react'
import { useNavigate } from 'react-router'
import { formatBytes, formatDuration } from '@shared/format'
import { Page, PageHeader, Panel } from '@/components/layout/page'
import { PowerButton, ServerMenu, isLive } from '@/components/server-actions'
import { StatusDot, statusLabel } from '@/components/status'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/misc'
import { useNow } from '@/lib/hooks'
import { cn } from '@/lib/utils'
import { useApp } from '@/store/app'
import { useUi } from '@/store/ui'

function Metric({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <div className="flex-1 px-5 py-4">
      <div className="text-xs text-fg-subtle">{label}</div>
      <div className="mt-1.5 flex items-baseline gap-1.5">
        <span className="text-[20px] leading-6 font-semibold tracking-[-0.02em] text-fg tabular">{value}</span>
        {sub && <span className="text-xs text-fg-subtle tabular">{sub}</span>}
      </div>
    </div>
  )
}

function GettingStarted() {
  const navigate = useNavigate()
  const open = useUi((s) => s.open)
  const db = useApp((s) => s.db)
  const dbReady = !!db && (db.mode === 'external' ? db.reachable : db.installed)
  const steps = [
    {
      icon: <Database size={15} strokeWidth={1.75} />,
      title: 'Set up a database',
      description: dbReady
        ? `${db?.mode === 'external' ? 'External server' : 'MariaDB'} is ready to use.`
        : 'Install a private MariaDB in one click, or connect to one you already run.',
      done: dbReady,
      action: () => navigate('/database')
    },
    {
      icon: <Server size={15} strokeWidth={1.75} />,
      title: 'Create your first server',
      description: 'Pick a build, choose txAdmin or a plain server, and the manager sets up the rest.',
      done: false,
      action: () => open('newServer')
    },
    {
      icon: <FolderInput size={15} strokeWidth={1.75} />,
      title: 'Or import an existing one',
      description: 'Point at a folder with a server.cfg or txData and keep working where you left off.',
      done: false,
      action: () => open('importServer')
    }
  ]
  return (
    <div className="mx-auto max-w-[560px] pt-10">
      <EmptyState
        className="py-0 pb-8"
        icon={<Server size={18} strokeWidth={1.75} />}
        title="No servers yet"
        description="Everything you need to run FiveM servers side by side on this PC."
      />
      <Panel>
        {steps.map((s, i) => (
          <button
            key={s.title}
            onClick={s.action}
            className={cn(
              'group flex w-full items-center gap-3.5 px-4 py-3.5 text-left transition-colors hover:bg-hover',
              i > 0 && 'border-t border-line'
            )}
          >
            <span
              className={cn(
                'flex h-8 w-8 shrink-0 items-center justify-center rounded-[8px] shadow-[inset_0_0_0_1px_var(--line-strong)]',
                s.done ? 'text-ok' : 'text-fg-muted'
              )}
            >
              {s.icon}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[13px] font-medium text-fg">{s.title}</span>
              <span className="block text-xs leading-[18px] text-fg-subtle">{s.description}</span>
            </span>
            <ArrowRight size={14} className="text-fg-faint transition-transform group-hover:translate-x-0.5 group-hover:text-fg-muted" />
          </button>
        ))}
      </Panel>
    </div>
  )
}

export function OverviewPage() {
  const navigate = useNavigate()
  const servers = useApp((s) => s.servers)
  const runtime = useApp((s) => s.runtime)
  const open = useUi((s) => s.open)
  const now = useNow(1000)

  const live = servers.filter((s) => isLive(runtime[s.id]))
  const players = live.reduce((n, s) => n + (runtime[s.id]?.players ?? 0), 0)
  const cpu = live.reduce((n, s) => n + (runtime[s.id]?.cpu ?? 0), 0)
  const memory = live.reduce((n, s) => n + (runtime[s.id]?.memory ?? 0), 0)

  if (!servers.length) {
    return (
      <Page>
        <GettingStarted />
      </Page>
    )
  }

  return (
    <Page>
      <PageHeader
        title="Overview"
        description={`${servers.length} server${servers.length === 1 ? '' : 's'} on this machine`}
        actions={
          <>
            <Button icon={<FolderInput size={14} strokeWidth={1.75} />} onClick={() => open('importServer')}>
              Import
            </Button>
            <Button variant="primary" icon={<Plus size={15} strokeWidth={2} />} onClick={() => open('newServer')}>
              New server
            </Button>
          </>
        }
      />

      <Panel className="mb-6 flex divide-x divide-line">
        <Metric label="Running" value={live.length} sub={`of ${servers.length}`} />
        <Metric label="Players online" value={live.length ? players : '–'} />
        <Metric label="CPU" value={live.length ? `${cpu.toFixed(1)}%` : '–'} />
        <Metric label="Memory" value={live.length ? formatBytes(memory) : '–'} />
      </Panel>

      <Panel>
        <div className="grid grid-cols-[minmax(0,1fr)_88px_72px_88px_80px_84px_72px] items-center gap-3 border-b border-line px-4 py-2 text-2xs font-medium text-fg-subtle">
          <span>Server</span>
          <span>Players</span>
          <span>CPU</span>
          <span>Memory</span>
          <span>Port</span>
          <span>Uptime</span>
          <span />
        </div>
        {servers.map((s, i) => {
          const r = runtime[s.id]
          const on = isLive(r)
          return (
            <div
              key={s.id}
              role="button"
              tabIndex={0}
              onClick={() => navigate(`/servers/${s.id}`)}
              onKeyDown={(e) => e.key === 'Enter' && navigate(`/servers/${s.id}`)}
              className={cn(
                'group grid h-[60px] grid-cols-[minmax(0,1fr)_88px_72px_88px_80px_84px_72px] items-center gap-3 px-4 transition-colors hover:bg-hover',
                i > 0 && 'border-t border-line'
              )}
            >
              <div className="flex min-w-0 items-center gap-3">
                <StatusDot status={r?.status} />
                <div className="min-w-0">
                  <div className="truncate text-[13px] font-medium text-fg">{s.name}</div>
                  <div className="truncate text-xs text-fg-subtle">
                    {r && r.status !== 'stopped' ? statusLabel[r.status] : s.mode === 'txadmin' ? 'txAdmin' : 'Standalone'}
                    <span className="mx-1.5 text-fg-faint">·</span>
                    {s.platform === 'enhanced' ? 'Enhanced ' : ''}build {s.build}
                  </div>
                </div>
              </div>
              <span className="text-[13px] text-fg-muted tabular">
                {on && r?.gameOnline ? (
                  <>
                    <span className="text-fg">{r.players}</span>
                    <span className="text-fg-subtle"> / {r.maxPlayers || s.maxClients}</span>
                  </>
                ) : (
                  <span className="text-fg-faint">–</span>
                )}
              </span>
              <span className="text-[13px] text-fg-muted tabular">{on ? `${r!.cpu.toFixed(1)}%` : <span className="text-fg-faint">–</span>}</span>
              <span className="text-[13px] text-fg-muted tabular">{on ? formatBytes(r!.memory) : <span className="text-fg-faint">–</span>}</span>
              <span className="font-mono text-xs text-fg-muted">{s.gamePort}</span>
              <span className="text-[13px] text-fg-muted tabular">
                {on && r?.startedAt ? formatDuration(now - r.startedAt) : <span className="text-fg-faint">–</span>}
              </span>
              <div className="flex items-center justify-end gap-0.5" onClick={(e) => e.stopPropagation()}>
                <PowerButton server={s} runtime={r} compact size="sm" />
                <ServerMenu server={s} runtime={r} />
              </div>
            </div>
          )
        })}
      </Panel>
    </Page>
  )
}
