import { ExternalLink, FolderOpen, RotateCw } from 'lucide-react'
import { useNavigate, useParams } from 'react-router'
import type { ServerConfig, ServerRuntime } from '@shared/types'
import { PowerButton, ServerMenu, connectUrl, isLive, useServerControl } from '@/components/server-actions'
import { StatusDot, statusLabel } from '@/components/status'
import { Button } from '@/components/ui/button'
import { CopyButton, EmptyState } from '@/components/ui/misc'
import { attempt } from '@/components/ui/toast'
import { Tooltip } from '@/components/ui/tooltip'
import { api, cn } from '@/lib/utils'
import { useRuntime, useServer } from '@/store/app'
import { ConfigTab } from './config-tab'
import { ConsoleTab } from './console-tab'
import { OverviewTab } from './overview-tab'
import { ResourcesTab } from './resources-tab'
import { SettingsTab } from './settings-tab'
import { TxAdminTab } from './txadmin-tab'

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'console', label: 'Console' },
  { id: 'txadmin', label: 'txAdmin', txOnly: true },
  { id: 'config', label: 'Config' },
  { id: 'resources', label: 'Resources' },
  { id: 'settings', label: 'Settings' }
] as const

export type TabId = (typeof TABS)[number]['id']

function StatusPill({ server, runtime }: { server: ServerConfig; runtime: ServerRuntime | undefined }) {
  const status = runtime?.status ?? 'stopped'
  return (
    <div className="flex items-center gap-1.5">
      <span className="inline-flex h-6 items-center gap-2 rounded-full px-2.5 text-xs font-medium text-fg-muted shadow-[inset_0_0_0_1px_var(--line-strong)]">
        <StatusDot status={status} />
        {statusLabel[status]}
      </span>
      {server.mode === 'txadmin' && status === 'running' && (
        <span className="inline-flex h-6 items-center rounded-full px-2.5 text-xs text-fg-subtle shadow-[inset_0_0_0_1px_var(--line)]">
          {runtime?.gameOnline ? 'Game server online' : 'Game server offline'}
        </span>
      )}
    </div>
  )
}

function Header({ server, runtime, tab }: { server: ServerConfig; runtime: ServerRuntime | undefined; tab: TabId }) {
  const navigate = useNavigate()
  const ctl = useServerControl(server)
  const live = isLive(runtime)
  const address = `127.0.0.1:${server.gamePort}`
  return (
    <div className="shrink-0 border-b border-line px-8 pt-6">
      <div className="flex items-start justify-between gap-6">
        <div className="min-w-0">
          <div className="flex items-center gap-3">
            <h1 className="truncate text-[22px] leading-7 font-semibold tracking-[-0.02em] text-fg">{server.name}</h1>
            <StatusPill server={server} runtime={runtime} />
          </div>
          <div className="mt-1.5 flex items-center gap-2 text-[13px] text-fg-subtle">
            <span>{server.platform === 'enhanced' ? 'FiveM Enhanced' : 'FiveM'}</span>
            <span className="text-fg-faint">·</span>
            <span>Build {server.build}</span>
            <span className="text-fg-faint">·</span>
            <span>{server.mode === 'txadmin' ? 'txAdmin' : 'Standalone'}</span>
            <span className="text-fg-faint">·</span>
            <span className="flex items-center gap-0.5 font-mono text-xs text-fg-muted selectable">
              {address}
              <CopyButton value={address} label="Copy address" className="h-5 w-5" />
            </span>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <Tooltip content="Connect with FiveM">
            <Button
              variant="ghost"
              square
              disabled={!runtime?.gameOnline}
              onClick={() => void attempt(() => api.app.openExternal(connectUrl(server)))}
              icon={<ExternalLink size={15} strokeWidth={1.75} />}
            />
          </Tooltip>
          <Tooltip content="Open folder">
            <Button
              variant="ghost"
              square
              onClick={() => void attempt(() => api.app.openPath(server.root))}
              icon={<FolderOpen size={15} strokeWidth={1.75} />}
            />
          </Tooltip>
          <ServerMenu server={server} runtime={runtime} trigger={undefined} />
          <div className="mx-1 h-5 w-px bg-line" />
          {live && (
            <Button
              loading={ctl.busy === 'restart'}
              disabled={runtime?.status === 'stopping'}
              onClick={() => void ctl.restart()}
              icon={<RotateCw size={13} strokeWidth={2} />}
            >
              Restart
            </Button>
          )}
          <PowerButton server={server} runtime={runtime} />
        </div>
      </div>
      <nav className="mt-5 -mb-px flex gap-1 pb-2.5">
        {TABS.filter((t) => !('txOnly' in t) || server.mode === 'txadmin').map((t) => (
          <button
            key={t.id}
            onClick={() => navigate(`/servers/${server.id}/${t.id}`, { replace: true })}
            className={cn(
              'h-7 rounded-[7px] px-2.5 text-[13px] transition-colors duration-100',
              tab === t.id ? 'bg-active font-medium text-fg' : 'text-fg-subtle hover:bg-hover hover:text-fg-muted'
            )}
          >
            {t.label}
          </button>
        ))}
      </nav>
    </div>
  )
}

export function ServerPage() {
  const { id, tab: tabParam } = useParams()
  const server = useServer(id)
  const runtime = useRuntime(id)
  const navigate = useNavigate()

  if (!server) {
    return (
      <EmptyState className="h-full" title="Server not found" description="It may have been deleted.">
        <Button onClick={() => navigate('/')}>Back to overview</Button>
      </EmptyState>
    )
  }

  const tab: TabId = TABS.some((t) => t.id === tabParam) ? (tabParam as TabId) : 'overview'
  const effective = tab === 'txadmin' && server.mode !== 'txadmin' ? 'overview' : tab

  return (
    <div className="flex h-full flex-col">
      <Header server={server} runtime={runtime} tab={effective} />
      <div className="min-h-0 flex-1">
        {effective === 'overview' && <OverviewTab key={server.id} server={server} runtime={runtime} />}
        {effective === 'console' && <ConsoleTab key={server.id} server={server} runtime={runtime} />}
        {effective === 'txadmin' && <TxAdminTab key={server.id} server={server} runtime={runtime} />}
        {effective === 'config' && <ConfigTab key={server.id} server={server} runtime={runtime} />}
        {effective === 'resources' && <ResourcesTab key={server.id} server={server} runtime={runtime} />}
        {effective === 'settings' && <SettingsTab key={server.id} server={server} runtime={runtime} />}
      </div>
    </div>
  )
}
