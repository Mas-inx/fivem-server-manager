import { ArrowRight, CircleAlert, KeyRound, ShieldPlus } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router'
import type { PlayerInfo, ServerConfig, ServerRuntime } from '@shared/types'
import { formatBytes, formatDuration } from '@shared/format'
import { usefulIdentifiers } from '@/components/dialogs/admin'
import { Panel } from '@/components/layout/page'
import { isLive, useServerControl } from '@/components/server-actions'
import { Sparkline } from '@/components/sparkline'
import { Button } from '@/components/ui/button'
import { Badge, CopyButton } from '@/components/ui/misc'
import { Tooltip } from '@/components/ui/tooltip'
import { useUi } from '@/store/ui'
import { useAsync, useNow } from '@/lib/hooks'
import { parseAnsi } from '@/lib/ansi'
import { api, cn, shortPath } from '@/lib/utils'
import { useApp, useLogs } from '@/store/app'

function Stat({ label, value, sub, series, max }: { label: string; value: ReactNode; sub?: ReactNode; series?: number[]; max?: number }) {
  return (
    <div className="flex min-w-0 flex-1 flex-col px-5 pt-4">
      <div className="text-xs text-fg-subtle">{label}</div>
      <div className="mt-1.5 flex items-baseline gap-1.5">
        <span className="text-[20px] leading-6 font-semibold tracking-[-0.02em] text-fg tabular">{value}</span>
        {sub && <span className="truncate text-xs text-fg-subtle tabular">{sub}</span>}
      </div>
      <div className="mt-3 -mx-5">{series ? <Sparkline values={series} max={max} height={34} /> : <div className="h-[34px]" />}</div>
    </div>
  )
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 px-4 py-2.5">
      <span className="shrink-0 text-[13px] text-fg-subtle">{label}</span>
      <span className="min-w-0 truncate text-right text-[13px] text-fg">{children}</span>
    </div>
  )
}

function SetupCallout({ server, runtime }: { server: ServerConfig; runtime: ServerRuntime | undefined }) {
  const navigate = useNavigate()
  const ctl = useServerControl(server)
  const live = isLive(runtime)
  return (
    <Panel className="mb-6 flex items-center gap-5 px-5 py-4">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[9px] text-fg-muted shadow-[inset_0_0_0_1px_var(--line-strong)]">
        <KeyRound size={16} strokeWidth={1.75} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-[13px] font-medium text-fg">Finish setup in txAdmin</div>
        <div className="mt-0.5 text-xs leading-[18px] text-fg-subtle">
          Pick a recipe like QBCore, ESX or a blank server. Database and license key are filled in for you.
          {server.txAdmin && (
            <span className="ml-1 inline-flex items-center gap-1 align-middle">
              Login <span className="font-mono text-fg-muted selectable">{server.txAdmin.username}</span>
              <span className="text-fg-faint">/</span>
              <span className="font-mono text-fg-muted selectable">{server.txAdmin.password}</span>
              <CopyButton value={server.txAdmin.password} label="Copy password" className="h-5 w-5" />
            </span>
          )}
        </div>
      </div>
      {live ? (
        <Button variant="primary" iconRight={<ArrowRight size={14} />} onClick={() => navigate(`/servers/${server.id}/txadmin`)}>
          Open txAdmin
        </Button>
      ) : (
        <Button
          variant="primary"
          loading={ctl.busy === 'start'}
          onClick={() => void ctl.start().then(() => navigate(`/servers/${server.id}/txadmin`))}
        >
          Start and open txAdmin
        </Button>
      )}
    </Panel>
  )
}

function ProblemCallout({ server, message }: { server: ServerConfig; message: string }) {
  const navigate = useNavigate()
  return (
    <Panel className="mb-6 flex items-center gap-4 px-5 py-3.5">
      <CircleAlert size={16} strokeWidth={1.75} className="shrink-0 text-err" />
      <div className="min-w-0 flex-1 text-[13px] text-fg">{message}</div>
      <Button size="sm" onClick={() => navigate(`/servers/${server.id}/settings`)}>
        Open settings
      </Button>
    </Panel>
  )
}

function RecentOutput({ server }: { server: ServerConfig }) {
  const navigate = useNavigate()
  const logs = useLogs((s) => s.logs[server.id])
  const load = useLogs((s) => s.load)
  useEffect(() => {
    void load(server.id)
  }, [server.id, load])
  const lines = (logs ?? []).slice(-16)
  return (
    <Panel>
      <div className="flex h-11 items-center justify-between border-b border-line px-4">
        <span className="text-[13px] font-medium text-fg">Recent output</span>
        <button
          onClick={() => navigate(`/servers/${server.id}/console`)}
          className="flex items-center gap-1 text-xs text-fg-subtle hover:text-fg"
        >
          Open console <ArrowRight size={12} />
        </button>
      </div>
      <div className="h-[296px] overflow-hidden px-4 py-3 font-mono text-[11.5px] leading-[17px] selectable">
        {lines.length ? (
          lines.map((l, i) => (
            <div key={`${l.t}-${i}`} className={cn('truncate whitespace-pre', l.stream === 'sys' ? 'text-fg-subtle' : 'text-fg-muted')}>
              {parseAnsi(l.text).map((s, j) => (
                <span key={j} style={s.color ? { color: s.color } : undefined}>
                  {s.text}
                </span>
              ))}
            </div>
          ))
        ) : (
          <div className="flex h-full items-center justify-center font-sans text-xs text-fg-faint">No output yet</div>
        )}
      </div>
    </Panel>
  )
}

function Players({ server, runtime }: { server: ServerConfig; runtime: ServerRuntime | undefined }) {
  const [players, setPlayers] = useState<PlayerInfo[]>([])
  const admins = useApp((s) => s.settings?.admins ?? [])
  const editAdmin = useUi((s) => s.editAdmin)
  const isAdmin = (p: PlayerInfo): boolean => admins.some((a) => a.identifiers.some((id) => p.identifiers.includes(id)))
  const online = runtime?.gameOnline
  useEffect(() => {
    if (!online) {
      setPlayers([])
      return
    }
    const load = (): void => void api.servers.players(server.id).then(setPlayers).catch(() => undefined)
    load()
    const t = setInterval(load, 8000)
    return () => clearInterval(t)
  }, [server.id, online])
  if (!online) return null
  return (
    <Panel className="mt-4">
      <div className="flex h-11 items-center justify-between border-b border-line px-4">
        <span className="text-[13px] font-medium text-fg">Players</span>
        <span className="text-xs text-fg-subtle tabular">
          {players.length} / {runtime?.maxPlayers || server.maxClients}
        </span>
      </div>
      {players.length ? (
        <div className="max-h-[260px] overflow-y-auto">
          {players.map((p) => (
            <div key={p.id} className="group flex h-10 items-center gap-3 border-b border-line px-4 last:border-0">
              <span className="w-8 font-mono text-xs text-fg-subtle">{p.id}</span>
              <span className="flex-1 truncate text-[13px] text-fg">{p.name}</span>
              {isAdmin(p) ? (
                <Badge>Admin</Badge>
              ) : (
                <Tooltip content="Make admin on every server">
                  <button
                    onClick={() => editAdmin({ name: p.name.replace(/[^A-Za-z0-9._-]/g, '').slice(0, 20), identifiers: usefulIdentifiers(p.identifiers) })}
                    className="flex h-6 w-6 items-center justify-center rounded-[5px] text-fg-faint opacity-0 group-hover:opacity-100 hover:bg-hover hover:text-fg"
                  >
                    <ShieldPlus size={13} strokeWidth={1.75} />
                  </button>
                </Tooltip>
              )}
              <span className="w-12 text-right text-xs text-fg-subtle tabular">{p.ping} ms</span>
            </div>
          ))}
        </div>
      ) : (
        <div className="px-4 py-6 text-center text-xs text-fg-faint">Nobody is connected</div>
      )}
    </Panel>
  )
}

export function OverviewTab({ server, runtime }: { server: ServerConfig; runtime: ServerRuntime | undefined }) {
  const history = useApp((s) => s.history[server.id])
  const now = useNow(1000)
  const live = isLive(runtime)
  const files = useAsync(() => api.servers.files(server.id), [server.id, runtime?.status, runtime?.gameOnline])
  const needsSetup = server.mode === 'txadmin' && files.data && !files.data.dataPath

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-[1180px] px-8 py-6">
        {runtime?.message && runtime.status !== 'running' && <ProblemCallout server={server} message={runtime.message} />}
        {needsSetup && <SetupCallout server={server} runtime={runtime} />}

        <Panel className="mb-6 flex divide-x divide-line">
          <Stat
            label="Uptime"
            value={live && runtime?.startedAt ? formatDuration(now - runtime.startedAt) : '–'}
            sub={runtime?.crashes ? `${runtime.crashes} crash${runtime.crashes === 1 ? '' : 'es'}` : undefined}
          />
          <Stat
            label="Players"
            value={runtime?.gameOnline ? runtime.players : '–'}
            sub={runtime?.gameOnline ? `of ${runtime.maxPlayers || server.maxClients}` : undefined}
            series={history?.players}
            max={runtime?.maxPlayers || server.maxClients}
          />
          <Stat label="CPU" value={live ? `${(runtime?.cpu ?? 0).toFixed(1)}%` : '–'} series={history?.cpu} max={10} />
          <Stat label="Memory" value={live ? formatBytes(runtime?.memory ?? 0) : '–'} series={history?.memory} />
        </Panel>

        <div className="grid grid-cols-[minmax(0,1fr)_340px] gap-4">
          <div className="min-w-0">
            <RecentOutput server={server} />
            <Players server={server} runtime={runtime} />
          </div>
          <Panel className="self-start">
            <div className="flex h-11 items-center border-b border-line px-4 text-[13px] font-medium text-fg">Details</div>
            <div className="divide-y divide-line">
              <Row label="Platform">{server.platform === 'enhanced' ? 'FiveM Enhanced' : 'FiveM'}</Row>
              <Row label="Build">
                <span className="font-mono text-xs">{server.build}</span>
              </Row>
              <Row label="Mode">{server.mode === 'txadmin' ? 'txAdmin' : 'Standalone'}</Row>
              <Row label="Game port">
                <span className="font-mono text-xs">{server.gamePort}</span>
              </Row>
              {server.mode === 'txadmin' && (
                <Row label="txAdmin port">
                  <span className="font-mono text-xs">{server.txAdminPort}</span>
                </Row>
              )}
              <Row label="Database">
                {server.database ? <span className="font-mono text-xs">{server.database}</span> : <span className="text-fg-faint">None</span>}
              </Row>
              <Row label="Restart on crash">{server.autoRestart ? 'On' : 'Off'}</Row>
              <Row label="Folder">
                <button
                  className="font-mono text-xs text-fg-muted hover:text-fg"
                  onClick={() => void api.app.openPath(server.root)}
                  title={server.root}
                >
                  {shortPath(server.root)}
                </button>
              </Row>
              {runtime?.message && runtime.status !== 'running' && (
                <Row label="Last error">
                  <span className="text-err" title={runtime.message}>
                    {runtime.message}
                  </span>
                </Row>
              )}
            </div>
          </Panel>
        </div>
      </div>
    </div>
  )
}
