import { Database, LayoutGrid, Package, Plus, Settings } from 'lucide-react'
import type { ReactNode } from 'react'
import { NavLink } from 'react-router'
import { StatusDot } from '@/components/status'
import { Tooltip } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { useApp } from '@/store/app'
import { useUi } from '@/store/ui'

function Item({
  to,
  icon,
  children,
  end,
  trailing
}: {
  to: string
  icon: ReactNode
  children: ReactNode
  end?: boolean
  trailing?: ReactNode
}) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        cn(
          'flex h-8 items-center gap-2.5 rounded-[7px] px-2.5 text-[13px] transition-colors duration-100',
          isActive ? 'bg-active font-medium text-fg' : 'text-fg-muted hover:bg-hover hover:text-fg'
        )
      }
    >
      <span className="flex w-4 justify-center opacity-90">{icon}</span>
      <span className="flex-1 truncate">{children}</span>
      {trailing}
    </NavLink>
  )
}

export function Sidebar() {
  const servers = useApp((s) => s.servers)
  const runtime = useApp((s) => s.runtime)
  const db = useApp((s) => s.db)
  const openDialog = useUi((s) => s.open)
  const dbState = db?.running ? 'running' : db?.starting ? 'starting' : 'stopped'

  return (
    <aside className="flex w-[232px] shrink-0 flex-col px-2 pb-2">
      <nav className="flex flex-col gap-px pt-1">
        <Item to="/" end icon={<LayoutGrid size={15} strokeWidth={1.75} />}>
          Overview
        </Item>
        <Item to="/artifacts" icon={<Package size={15} strokeWidth={1.75} />}>
          Artifacts
        </Item>
        <Item
          to="/database"
          icon={<Database size={15} strokeWidth={1.75} />}
          trailing={db && (db.installed || db.mode === 'external') ? <StatusDot status={dbState} className="mr-0.5" /> : null}
        >
          Database
        </Item>
      </nav>

      <div className="mt-6 mb-1 flex h-6 items-center justify-between pr-1 pl-2.5">
        <span className="text-2xs font-medium tracking-[0.02em] text-fg-subtle">Servers</span>
        <Tooltip content="New server" side="right">
          <button
            onClick={() => openDialog('newServer')}
            className="flex h-5 w-5 items-center justify-center rounded-[5px] text-fg-subtle hover:bg-hover hover:text-fg"
          >
            <Plus size={14} strokeWidth={1.75} />
          </button>
        </Tooltip>
      </div>

      <div className="-mx-2 min-h-0 flex-1 overflow-y-auto px-2">
        <div className="flex flex-col gap-px">
          {servers.map((s) => {
            const r = runtime[s.id]
            return (
              <NavLink
                key={s.id}
                to={`/servers/${s.id}`}
                className={({ isActive }) =>
                  cn(
                    'group flex h-8 items-center gap-2.5 rounded-[7px] px-2.5 text-[13px] transition-colors duration-100',
                    isActive ? 'bg-active text-fg' : 'text-fg-muted hover:bg-hover hover:text-fg'
                  )
                }
              >
                <span className="flex w-4 justify-center">
                  <StatusDot status={r?.status} />
                </span>
                <span className="flex-1 truncate">{s.name}</span>
                {r?.status === 'running' && r.gameOnline && (
                  <span className="text-2xs text-fg-subtle tabular">{r.players}</span>
                )}
              </NavLink>
            )
          })}
          {!servers.length && (
            <button
              onClick={() => openDialog('newServer')}
              className="flex h-8 items-center gap-2.5 rounded-[7px] px-2.5 text-left text-[13px] text-fg-subtle hover:bg-hover hover:text-fg-muted"
            >
              <span className="flex w-4 justify-center">
                <Plus size={14} strokeWidth={1.75} />
              </span>
              Create a server
            </button>
          )}
        </div>
      </div>

      <div className="pt-2">
        <Item to="/settings" icon={<Settings size={15} strokeWidth={1.75} />}>
          Settings
        </Item>
      </div>
    </aside>
  )
}
