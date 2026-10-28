import { Boxes, FolderOpen, RefreshCw, Search } from 'lucide-react'
import { useMemo, useState } from 'react'
import type { ResourceInfo, ServerConfig, ServerRuntime } from '@shared/types'
import { Panel } from '@/components/layout/page'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { EmptyState } from '@/components/ui/misc'
import { Segmented } from '@/components/ui/segmented'
import { Switch } from '@/components/ui/switch'
import { attempt, toast } from '@/components/ui/toast'
import { Tooltip } from '@/components/ui/tooltip'
import { useAsync } from '@/lib/hooks'
import { api } from '@/lib/utils'

type Filter = 'all' | 'on' | 'off'

export function ResourcesTab({ server, runtime }: { server: ServerConfig; runtime: ServerRuntime | undefined }) {
  const res = useAsync(() => api.servers.resources(server.id), [server.id])
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [pending, setPending] = useState<Record<string, boolean>>({})

  const list = res.data ?? []
  const shown = useMemo(() => {
    const q = query.toLowerCase()
    return list.filter(
      (r) =>
        (!q || r.name.toLowerCase().includes(q) || (r.category ?? '').toLowerCase().includes(q)) &&
        (filter === 'all' || (filter === 'on' ? r.ensured : !r.ensured))
    )
  }, [list, query, filter])

  const groups = useMemo(() => {
    const map = new Map<string, ResourceInfo[]>()
    for (const r of shown) {
      const key = r.category ?? ''
      map.set(key, [...(map.get(key) ?? []), r])
    }
    return [...map.entries()]
  }, [shown])

  const toggle = async (r: ResourceInfo, on: boolean): Promise<void> => {
    setPending((p) => ({ ...p, [r.name]: true }))
    const ok = await attempt(() => api.servers.setResourceEnsured(server.id, r.name, on), 'Could not update server.cfg')
    if (ok) {
      // Standalone servers take the change immediately; txAdmin servers pick it up on restart.
      const live = runtime?.status === 'running' && server.mode === 'standalone'
      if (live) await api.servers.command(server.id, on ? `ensure ${r.name}` : `stop ${r.name}`).catch(() => undefined)
      else if (runtime?.status === 'running') {
        toast({ kind: 'info', title: `${r.name} ${on ? 'enabled' : 'disabled'}`, description: 'Restart the server to apply it.' })
      }
      res.reload()
    }
    setPending((p) => ({ ...p, [r.name]: false }))
  }

  if (!res.loading && !list.length) {
    return (
      <EmptyState
        className="h-full"
        icon={<Boxes size={18} strokeWidth={1.75} />}
        title="No resources found"
        description={
          server.mode === 'txadmin'
            ? 'Resources appear once txAdmin has deployed the server.'
            : 'Drop resource folders into server-data/resources and they will show up here.'
        }
      />
    )
  }

  const enabled = list.filter((r) => r.ensured).length
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-[1180px] px-8 py-6">
        <div className="mb-4 flex items-center gap-2">
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search resources"
            leading={<Search size={13} />}
            className="w-[280px]"
          />
          <Segmented<Filter>
            value={filter}
            onChange={setFilter}
            options={[
              { value: 'all', label: 'All' },
              { value: 'on', label: 'Enabled' },
              { value: 'off', label: 'Disabled' }
            ]}
          />
          <div className="flex-1" />
          <span className="mr-2 text-xs text-fg-subtle tabular">
            {enabled} of {list.length} enabled
          </span>
          <Tooltip content="Rescan">
            <Button variant="ghost" square onClick={() => res.reload()} icon={<RefreshCw size={14} strokeWidth={1.75} />} />
          </Tooltip>
        </div>

        <div className="flex flex-col gap-4">
          {groups.map(([category, items]) => (
            <Panel key={category || '_'}>
              <div className="flex h-10 items-center justify-between border-b border-line px-4">
                <span className="font-mono text-xs text-fg-muted">{category || 'resources'}</span>
                <span className="text-xs text-fg-subtle tabular">{items.length}</span>
              </div>
              {items.map((r) => (
                <div key={r.path} className="group flex h-11 items-center gap-3 border-b border-line px-4 last:border-0 hover:bg-hover">
                  <span className="min-w-0 flex-1 truncate font-mono text-[12.5px] text-fg">{r.name}</span>
                  {r.viaCategory && <span className="text-xs text-fg-subtle">Started by {r.viaCategory}</span>}
                  <Tooltip content="Open folder">
                    <button
                      onClick={() => void api.app.openPath(r.path)}
                      className="flex h-6 w-6 items-center justify-center rounded-[5px] text-fg-faint opacity-0 group-hover:opacity-100 hover:bg-hover hover:text-fg"
                    >
                      <FolderOpen size={13} strokeWidth={1.75} />
                    </button>
                  </Tooltip>
                  <Switch
                    checked={r.ensured}
                    disabled={!!r.viaCategory || pending[r.name]}
                    onChange={(on) => void toggle(r, on)}
                  />
                </div>
              ))}
            </Panel>
          ))}
          {!groups.length && <div className="py-10 text-center text-[13px] text-fg-subtle">No resources match</div>}
        </div>
      </div>
    </div>
  )
}
