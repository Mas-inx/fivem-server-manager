import * as D from '@radix-ui/react-dialog'
import { ArrowRight, Database, FolderInput, LayoutGrid, Package, Play, Plus, RotateCw, Search, Settings, Square } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router'
import { isLive } from '@/components/server-actions'
import { StatusDot } from '@/components/status'
import { attempt } from '@/components/ui/toast'
import { api, cn } from '@/lib/utils'
import { useApp } from '@/store/app'
import { useUi } from '@/store/ui'

interface Command {
  id: string
  group: string
  label: string
  icon: ReactNode
  hint?: string
  run: () => void
}

export function CommandPalette() {
  const open = useApp((s) => s.paletteOpen)
  const setOpen = useApp((s) => s.setPaletteOpen)
  const servers = useApp((s) => s.servers)
  const runtime = useApp((s) => s.runtime)
  const openDialog = useUi((s) => s.open)
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const [index, setIndex] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (open) {
      setQuery('')
      setIndex(0)
    }
  }, [open])

  const commands = useMemo((): Command[] => {
    const icon = (n: ReactNode): ReactNode => n
    const list: Command[] = []
    for (const s of servers) {
      const r = runtime[s.id]
      list.push({ id: `open-${s.id}`, group: 'Servers', label: s.name, icon: <StatusDot status={r?.status} />, hint: 'Open', run: () => navigate(`/servers/${s.id}`) })
    }
    for (const s of servers) {
      const r = runtime[s.id]
      if (isLive(r)) {
        list.push({ id: `stop-${s.id}`, group: 'Actions', label: `Stop ${s.name}`, icon: icon(<Square size={13} />), run: () => void attempt(() => api.servers.stop(s.id)) })
        list.push({ id: `restart-${s.id}`, group: 'Actions', label: `Restart ${s.name}`, icon: icon(<RotateCw size={14} />), run: () => void attempt(() => api.servers.restart(s.id)) })
      } else {
        list.push({ id: `start-${s.id}`, group: 'Actions', label: `Start ${s.name}`, icon: icon(<Play size={14} />), run: () => void attempt(() => api.servers.start(s.id)) })
      }
    }
    list.push(
      { id: 'new', group: 'Actions', label: 'New server', icon: <Plus size={14} />, run: () => openDialog('newServer') },
      { id: 'import', group: 'Actions', label: 'Import server', icon: <FolderInput size={14} />, run: () => openDialog('importServer') },
      { id: 'start-all', group: 'Actions', label: 'Start all servers', icon: <Play size={14} />, run: () => void attempt(() => api.servers.startAll()) },
      { id: 'stop-all', group: 'Actions', label: 'Stop all servers', icon: <Square size={13} />, run: () => void attempt(() => api.servers.stopAll()) },
      { id: 'nav-overview', group: 'Go to', label: 'Overview', icon: <LayoutGrid size={14} />, run: () => navigate('/') },
      { id: 'nav-artifacts', group: 'Go to', label: 'Artifacts', icon: <Package size={14} />, run: () => navigate('/artifacts') },
      { id: 'nav-database', group: 'Go to', label: 'Database', icon: <Database size={14} />, run: () => navigate('/database') },
      { id: 'nav-settings', group: 'Go to', label: 'Settings', icon: <Settings size={14} />, run: () => navigate('/settings') }
    )
    return list
  }, [servers, runtime, navigate, openDialog])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return commands
    const words = q.split(/\s+/)
    return commands.filter((c) => words.every((w) => `${c.label} ${c.group}`.toLowerCase().includes(w)))
  }, [commands, query])

  useEffect(() => setIndex(0), [query])

  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${index}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [index])

  const run = (c: Command | undefined): void => {
    if (!c) return
    setOpen(false)
    c.run()
  }

  let lastGroup = ''
  return (
    <D.Root open={open} onOpenChange={setOpen}>
      <D.Portal>
        <D.Overlay className="fixed inset-0 z-40 animate-fade-in bg-[var(--scrim)]" />
        <D.Content
          aria-describedby={undefined}
          className="fixed top-[14vh] left-1/2 z-50 w-[560px] -translate-x-1/2 animate-pop-in overflow-hidden rounded-[14px] bg-panel shadow-pop focus:outline-none"
        >
          <D.Title className="sr-only">Command palette</D.Title>
          <div className="flex h-12 items-center gap-3 border-b border-line px-4">
            <Search size={15} className="text-fg-subtle" />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'ArrowDown') {
                  e.preventDefault()
                  setIndex((i) => Math.min(filtered.length - 1, i + 1))
                } else if (e.key === 'ArrowUp') {
                  e.preventDefault()
                  setIndex((i) => Math.max(0, i - 1))
                } else if (e.key === 'Enter') {
                  e.preventDefault()
                  run(filtered[index])
                }
              }}
              placeholder="Search servers and actions"
              className="flex-1 bg-transparent text-[14px] text-fg placeholder:text-fg-faint focus-visible:outline-none"
            />
          </div>
          <div ref={listRef} className="max-h-[360px] overflow-y-auto p-1.5">
            {filtered.length === 0 && <div className="py-10 text-center text-[13px] text-fg-subtle">No results</div>}
            {filtered.map((c, i) => {
              const header = c.group !== lastGroup ? c.group : null
              lastGroup = c.group
              return (
                <div key={c.id}>
                  {header && <div className="px-2.5 pt-2.5 pb-1 text-2xs font-medium text-fg-subtle">{header}</div>}
                  <button
                    data-index={i}
                    onMouseMove={() => setIndex(i)}
                    onClick={() => run(c)}
                    className={cn(
                      'flex h-9 w-full items-center gap-3 rounded-[8px] px-2.5 text-left text-[13px]',
                      i === index ? 'bg-active text-fg' : 'text-fg-muted'
                    )}
                  >
                    <span className="flex w-4 justify-center text-fg-subtle">{c.icon}</span>
                    <span className="flex-1 truncate">{c.label}</span>
                    {i === index && <ArrowRight size={13} className="text-fg-subtle" />}
                  </button>
                </div>
              )
            })}
          </div>
        </D.Content>
      </D.Portal>
    </D.Root>
  )
}
