import { Copy, ExternalLink, FolderOpen, MoreHorizontal, Play, RotateCw, Square, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { useNavigate } from 'react-router'
import type { ServerConfig, ServerRuntime } from '@shared/types'
import { Button } from '@/components/ui/button'
import { Menu, MenuItem, MenuSeparator } from '@/components/ui/menu'
import { attempt, toast } from '@/components/ui/toast'
import { Tooltip } from '@/components/ui/tooltip'
import { api } from '@/lib/utils'
import { useUi } from '@/store/ui'

export function isLive(r: ServerRuntime | undefined): boolean {
  return !!r && (r.status === 'running' || r.status === 'starting' || r.status === 'stopping')
}

export function useServerControl(server: ServerConfig) {
  const [busy, setBusy] = useState<null | 'start' | 'stop' | 'restart'>(null)
  const run = async (kind: 'start' | 'stop' | 'restart'): Promise<void> => {
    setBusy(kind)
    const verb = kind === 'start' ? 'start' : kind === 'stop' ? 'stop' : 'restart'
    await attempt(() => api.servers[kind](server.id), `Could not ${verb} ${server.name}`)
    setBusy(null)
  }
  return {
    busy,
    start: () => run('start'),
    stop: () => run('stop'),
    restart: () => run('restart')
  }
}

export function connectUrl(server: ServerConfig): string {
  return `fivem://connect/127.0.0.1:${server.gamePort}`
}

export function PowerButton({
  server,
  runtime,
  size = 'md',
  compact
}: {
  server: ServerConfig
  runtime: ServerRuntime | undefined
  size?: 'sm' | 'md'
  compact?: boolean
}) {
  const ctl = useServerControl(server)
  const live = isLive(runtime)
  if (compact) {
    return (
      <Tooltip content={live ? 'Stop' : 'Start'}>
        <Button
          variant="ghost"
          size={size}
          square
          loading={!!ctl.busy || runtime?.status === 'stopping'}
          onClick={(e) => {
            e.stopPropagation()
            void (live ? ctl.stop() : ctl.start())
          }}
          icon={live ? <Square size={13} strokeWidth={2} /> : <Play size={14} strokeWidth={2} />}
        />
      </Tooltip>
    )
  }
  return live ? (
    <Button
      variant="secondary"
      size={size}
      loading={ctl.busy === 'stop' || runtime?.status === 'stopping'}
      onClick={() => void ctl.stop()}
      icon={<Square size={12} strokeWidth={2.25} />}
    >
      Stop
    </Button>
  ) : (
    <Button
      variant="primary"
      size={size}
      loading={ctl.busy === 'start'}
      onClick={() => void ctl.start()}
      icon={<Play size={13} strokeWidth={2.25} />}
    >
      Start
    </Button>
  )
}

export function ServerMenu({
  server,
  runtime,
  showOpen,
  trigger
}: {
  server: ServerConfig
  runtime: ServerRuntime | undefined
  showOpen?: boolean
  trigger?: React.ReactNode
}) {
  const navigate = useNavigate()
  const ctl = useServerControl(server)
  const setDuplicate = useUi((s) => s.setDuplicate)
  const setDelete = useUi((s) => s.setDelete)
  const live = isLive(runtime)
  return (
    <Menu
      width={210}
      trigger={
        trigger ?? (
          <Button variant="ghost" square size="sm" onClick={(e) => e.stopPropagation()} icon={<MoreHorizontal size={15} />} />
        )
      }
    >
      {showOpen && <MenuItem onSelect={() => navigate(`/servers/${server.id}`)}>Open</MenuItem>}
      {live ? (
        <>
          <MenuItem icon={<RotateCw size={14} />} onSelect={() => void ctl.restart()}>
            Restart
          </MenuItem>
          <MenuItem icon={<Square size={13} />} onSelect={() => void ctl.stop()}>
            Stop
          </MenuItem>
        </>
      ) : (
        <MenuItem icon={<Play size={14} />} onSelect={() => void ctl.start()}>
          Start
        </MenuItem>
      )}
      <MenuSeparator />
      <MenuItem
        icon={<ExternalLink size={14} />}
        disabled={!runtime?.gameOnline}
        onSelect={() => void attempt(() => api.app.openExternal(connectUrl(server)))}
      >
        Connect in FiveM
      </MenuItem>
      <MenuItem icon={<FolderOpen size={14} />} onSelect={() => void attempt(() => api.app.openPath(server.root))}>
        Open folder
      </MenuItem>
      <MenuItem
        icon={<Copy size={14} />}
        onSelect={() => {
          if (live) toast({ kind: 'info', title: 'Stop the server first', description: 'Servers are duplicated while stopped so no files are mid-write.' })
          else setDuplicate(server.id)
        }}
      >
        Duplicate
      </MenuItem>
      <MenuSeparator />
      <MenuItem icon={<Trash2 size={14} />} danger onSelect={() => setDelete(server.id)}>
        Delete server
      </MenuItem>
    </Menu>
  )
}
