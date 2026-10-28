import { Database as DatabaseIcon, ExternalLink, FolderOpen, MoreHorizontal, Plus, ScrollText, Trash2 } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import type { DatabaseInfo, DbConnection, DbMode, LogLine } from '@shared/types'
import { formatBytes } from '@shared/format'
import { Page, PageHeader, Panel } from '@/components/layout/page'
import { StatusDot } from '@/components/status'
import { Button } from '@/components/ui/button'
import { Dialog, DialogBody, DialogFooter, DialogHeader } from '@/components/ui/dialog'
import { Field, Input, SecretInput } from '@/components/ui/input'
import { Menu, MenuItem, MenuSeparator } from '@/components/ui/menu'
import { CopyButton, Progress, SectionTitle, Spinner } from '@/components/ui/misc'
import { Segmented } from '@/components/ui/segmented'
import { attempt, toast } from '@/components/ui/toast'
import { useAsync } from '@/lib/hooks'
import { api, cn, shortPath } from '@/lib/utils'
import { useApp } from '@/store/app'

function KV({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="text-xs text-fg-subtle">{label}</div>
      <div className="mt-1 flex h-6 items-center gap-1 text-[13px] text-fg">{children}</div>
    </div>
  )
}

function connectionString(c: DbConnection, db: string): string {
  const auth = c.password ? `${encodeURIComponent(c.user)}:${encodeURIComponent(c.password)}` : encodeURIComponent(c.user)
  return `mysql://${auth}@${c.host}:${c.port}/${db}?charset=utf8mb4`
}

function Logs() {
  const [lines, setLines] = useState<LogLine[]>([])
  useEffect(() => {
    const load = (): void => void api.db.logs().then(setLines)
    load()
    const t = setInterval(load, 2000)
    return () => clearInterval(t)
  }, [])
  return (
    <div className="max-h-[220px] overflow-y-auto border-t border-line bg-sunken/60 px-5 py-3 font-mono text-[11.5px] leading-[18px] text-fg-muted selectable">
      {lines.length ? lines.slice(-200).map((l, i) => <div key={i} className="whitespace-pre-wrap">{l.text}</div>) : <span className="text-fg-faint">No output yet</span>}
    </div>
  )
}

function ManagedCard() {
  const db = useApp((s) => s.db)!
  const settings = useApp((s) => s.settings)!
  const updateSettings = useApp((s) => s.updateSettings)
  const task = useApp((s) => s.tasks.find((t) => t.title === 'MariaDB' && t.state === 'running'))
  const [busy, setBusy] = useState(false)
  const [showLogs, setShowLogs] = useState(false)
  const [port, setPort] = useState(settings.db.managedPort)

  if (!db.installed) {
    return (
      <Panel className="px-6 py-6">
        <div className="flex items-start gap-4">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[10px] bg-raised text-fg-muted shadow-[inset_0_0_0_1px_var(--line-strong)]">
            <DatabaseIcon size={17} strokeWidth={1.75} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[14px] font-medium text-fg">Install MariaDB</div>
            <p className="mt-1 max-w-[560px] text-[13px] leading-5 text-fg-subtle">
              Downloads MariaDB 11.8 LTS into your library and runs it privately on 127.0.0.1. Nothing is installed system wide and no
              Windows service is created. Works with oxmysql, mysql-async and ghmattimysql.
            </p>
            {task ? (
              <div className="mt-5 max-w-[420px]">
                <div className="mb-1.5 flex justify-between text-xs text-fg-subtle tabular">
                  <span>{task.detail ?? 'Starting'}</span>
                  {task.progress !== null && <span>{Math.round(task.progress * 100)}%</span>}
                </div>
                <Progress value={task.progress} />
              </div>
            ) : (
              <div className="mt-5 flex items-end gap-3">
                <Field label="Port" className="w-[120px]">
                  <Input mono type="number" value={port} onChange={(e) => setPort(Number(e.target.value))} />
                </Field>
                <Button
                  variant="primary"
                  loading={busy}
                  onClick={async () => {
                    setBusy(true)
                    if (port !== settings.db.managedPort) await updateSettings({ db: { ...settings.db, managedPort: port } })
                    await attempt(() => api.db.install(), 'MariaDB setup failed')
                    setBusy(false)
                  }}
                >
                  Install MariaDB
                </Button>
              </div>
            )}
          </div>
        </div>
      </Panel>
    )
  }

  const state = db.running ? 'running' : db.starting ? 'starting' : 'stopped'
  return (
    <Panel>
      <div className="flex items-center justify-between gap-4 px-5 py-4">
        <div className="flex items-center gap-3">
          <StatusDot status={state} />
          <div>
            <div className="text-[14px] font-medium text-fg">MariaDB {db.version}</div>
            <div className="text-xs text-fg-subtle">
              {db.running ? 'Running on this PC' : db.starting ? 'Starting' : 'Stopped'}
              {db.serverVersion && db.running && <span className="text-fg-faint"> · {db.serverVersion}</span>}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <Button variant="ghost" size="sm" icon={<ScrollText size={13} strokeWidth={1.75} />} onClick={() => setShowLogs((v) => !v)}>
            {showLogs ? 'Hide log' : 'Log'}
          </Button>
          {db.running || db.starting ? (
            <Button loading={busy} onClick={async () => {
              setBusy(true)
              await attempt(() => api.db.stop(), 'Could not stop MariaDB')
              setBusy(false)
            }}>
              Stop
            </Button>
          ) : (
            <Button variant="primary" loading={busy} onClick={async () => {
              setBusy(true)
              await attempt(() => api.db.start(), 'Could not start MariaDB')
              setBusy(false)
            }}>
              Start
            </Button>
          )}
        </div>
      </div>
      {db.error && (
        <div className="flex items-center gap-4 border-t border-line px-5 py-3">
          <span className="min-w-0 flex-1 text-xs leading-[18px] text-err">{db.error}</span>
          {/already in use/.test(db.error) && !db.running && (
            <div className="flex shrink-0 gap-1.5">
              <Button
                size="sm"
                variant="ghost"
                onClick={() =>
                  void updateSettings({
                    db: { ...settings.db, mode: 'external', external: { ...settings.db.external, host: '127.0.0.1', port: db.port } }
                  })
                }
              >
                Connect to it instead
              </Button>
              <Button
                size="sm"
                loading={busy}
                onClick={async () => {
                  setBusy(true)
                  await attempt(() => api.db.startOnFreePort(), 'Could not start MariaDB')
                  setBusy(false)
                }}
              >
                Use a free port
              </Button>
            </div>
          )}
        </div>
      )}
      <div className="grid grid-cols-4 gap-6 border-t border-line px-5 py-4">
        <KV label="Host">
          <span className="font-mono text-xs">127.0.0.1</span>
        </KV>
        <KV label="Port">
          <span className="font-mono text-xs">{db.port}</span>
        </KV>
        <KV label="User">
          <span className="font-mono text-xs">root</span>
        </KV>
        <KV label="Password">
          <span className="font-mono text-xs tracking-wider text-fg-muted">••••••••••</span>
          <CopyButton value={settings.db.managedPassword} label="Copy password" />
        </KV>
      </div>
      {db.dataDir && (
        <div className="flex items-center justify-between border-t border-line px-5 py-3">
          <span className="text-xs text-fg-subtle">
            Data folder <span className="ml-1 font-mono text-fg-muted">{shortPath(db.dataDir)}</span>
          </span>
          <Button variant="ghost" size="sm" icon={<FolderOpen size={13} strokeWidth={1.75} />} onClick={() => void api.app.openPath(db.dataDir!)}>
            Open
          </Button>
        </div>
      )}
      {showLogs && <Logs />}
    </Panel>
  )
}

function ExternalCard() {
  const settings = useApp((s) => s.settings)!
  const db = useApp((s) => s.db)!
  const updateSettings = useApp((s) => s.updateSettings)
  const [conn, setConn] = useState<DbConnection>(settings.db.external)
  const [testing, setTesting] = useState(false)
  const [result, setResult] = useState<{ ok: boolean; version?: string; error?: string } | null>(null)
  const dirty = JSON.stringify(conn) !== JSON.stringify(settings.db.external)
  const set = <K extends keyof DbConnection>(k: K, v: DbConnection[K]): void => {
    setConn((c) => ({ ...c, [k]: v }))
    setResult(null)
  }
  return (
    <Panel>
      <div className="flex items-center gap-3 px-5 py-4">
        <StatusDot status={db.reachable ? 'running' : 'stopped'} />
        <div>
          <div className="text-[14px] font-medium text-fg">External server</div>
          <div className="text-xs text-fg-subtle">
            {db.reachable ? `Connected · ${db.serverVersion ?? ''}` : 'XAMPP, Laragon, a standalone MySQL or a remote host'}
          </div>
        </div>
      </div>
      <div className="grid grid-cols-[1fr_120px] gap-3 border-t border-line px-5 pt-4">
        <Field label="Host">
          <Input mono value={conn.host} onChange={(e) => set('host', e.target.value)} />
        </Field>
        <Field label="Port">
          <Input mono type="number" value={conn.port} onChange={(e) => set('port', Number(e.target.value))} />
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3 px-5 pt-3 pb-4">
        <Field label="User">
          <Input mono value={conn.user} onChange={(e) => set('user', e.target.value)} />
        </Field>
        <Field label="Password">
          <SecretInput value={conn.password} onChange={(e) => set('password', e.target.value)} placeholder="Empty for none" />
        </Field>
      </div>
      <div className="flex items-center justify-between border-t border-line px-5 py-3">
        <span className={cn('text-xs', result ? (result.ok ? 'text-ok' : 'text-err') : 'text-fg-subtle')}>
          {result ? (result.ok ? `Connected to ${result.version}` : result.error) : db.error && !dirty ? db.error : ''}
        </span>
        <div className="flex gap-2">
          <Button
            loading={testing}
            onClick={async () => {
              setTesting(true)
              setResult(await api.db.test(conn))
              setTesting(false)
            }}
          >
            Test connection
          </Button>
          <Button variant="primary" disabled={!dirty} onClick={() => void updateSettings({ db: { ...settings.db, external: conn } })}>
            Save
          </Button>
        </div>
      </div>
    </Panel>
  )
}

function CreateDialog({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: () => void }) {
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => setName(''), [open])
  const valid = /^[A-Za-z0-9_]{1,64}$/.test(name)
  const submit = async (): Promise<void> => {
    setBusy(true)
    const ok = await attempt(() => api.db.create(name), 'Could not create database')
    setBusy(false)
    if (ok) {
      onCreated()
      onClose()
    }
  }
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()} width={420}>
      <DialogHeader title="New database" description="Created with utf8mb4, ready for oxmysql." />
      <DialogBody>
        <Field label="Name" hint="Letters, numbers and underscores.">
          <Input autoFocus mono value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && valid && void submit()} />
        </Field>
      </DialogBody>
      <DialogFooter>
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button variant="primary" disabled={!valid} loading={busy} onClick={() => void submit()}>
          Create
        </Button>
      </DialogFooter>
    </Dialog>
  )
}

function DropDialog({ target, onClose, onDropped }: { target: DatabaseInfo | null; onClose: () => void; onDropped: () => void }) {
  const [typed, setTyped] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => setTyped(''), [target])
  return (
    <Dialog open={!!target} onOpenChange={(o) => !o && onClose()} width={440}>
      <DialogHeader
        title={`Drop ${target?.name ?? ''}?`}
        description={`This permanently deletes ${target?.tables ?? 0} tables and all of their data. It cannot be undone.`}
      />
      <DialogBody>
        <Field label={<>Type <span className="font-mono text-fg">{target?.name}</span> to confirm</>}>
          <Input autoFocus mono value={typed} onChange={(e) => setTyped(e.target.value)} />
        </Field>
      </DialogBody>
      <DialogFooter>
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button
          variant="danger-solid"
          disabled={typed !== target?.name}
          loading={busy}
          onClick={async () => {
            if (!target) return
            setBusy(true)
            const ok = await attempt(() => api.db.drop(target.name), 'Could not drop database')
            setBusy(false)
            if (ok) {
              onDropped()
              onClose()
            }
          }}
        >
          Drop database
        </Button>
      </DialogFooter>
    </Dialog>
  )
}

export function DatabasePage() {
  const db = useApp((s) => s.db)
  const settings = useApp((s) => s.settings)
  const servers = useApp((s) => s.servers)
  const updateSettings = useApp((s) => s.updateSettings)
  const info = useAsync(() => api.app.info(), [])
  const list = useAsync(() => (db?.reachable ? api.db.list() : Promise.resolve(null)), [db?.reachable, db?.mode])
  const [creating, setCreating] = useState(false)
  const [dropping, setDropping] = useState<DatabaseInfo | null>(null)

  if (!db || !settings) return null
  const conn: DbConnection =
    db.mode === 'managed'
      ? { host: '127.0.0.1', port: settings.db.managedPort, user: 'root', password: settings.db.managedPassword }
      : settings.db.external
  const heidi = !!info.data?.heidiSqlPath

  return (
    <Page>
      <PageHeader
        title="Database"
        description="The MySQL compatible server your resources store their data in."
        actions={
          <Segmented<DbMode>
            value={db.mode}
            onChange={(mode) => void updateSettings({ db: { ...settings.db, mode } })}
            options={[
              { value: 'managed', label: 'Managed MariaDB' },
              { value: 'external', label: 'External server' }
            ]}
          />
        }
      />

      {db.mode === 'managed' ? <ManagedCard /> : <ExternalCard />}

      {db.reachable && (
        <div className="mt-8">
          <SectionTitle
            action={
              <div className="flex gap-1.5">
                {heidi && (
                  <Button size="sm" variant="ghost" icon={<ExternalLink size={13} strokeWidth={1.75} />} onClick={() => void attempt(() => api.db.openHeidi())}>
                    HeidiSQL
                  </Button>
                )}
                <Button size="sm" icon={<Plus size={14} strokeWidth={1.75} />} onClick={() => setCreating(true)}>
                  New database
                </Button>
              </div>
            }
          >
            Databases
          </SectionTitle>
          <Panel>
            {list.loading && !list.data ? (
              <div className="flex justify-center py-8 text-fg-subtle">
                <Spinner />
              </div>
            ) : !list.data?.length ? (
              <div className="px-4 py-8 text-center text-[13px] text-fg-subtle">No databases yet. Servers you create can make one automatically.</div>
            ) : (
              list.data.map((d, i) => {
                const users = servers.filter((s) => d.usedBy.includes(s.id))
                return (
                  <div key={d.name} className={cn('flex h-14 items-center gap-4 px-4', i > 0 && 'border-t border-line')}>
                    <span className="flex h-7 w-7 items-center justify-center rounded-[7px] text-fg-subtle shadow-[inset_0_0_0_1px_var(--line-strong)]">
                      <DatabaseIcon size={13} strokeWidth={1.75} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-mono text-[13px] text-fg">{d.name}</div>
                      <div className="truncate text-xs text-fg-subtle">
                        {users.length ? `Used by ${users.map((u) => u.name).join(', ')}` : 'Not linked to a server'}
                      </div>
                    </div>
                    <span className="w-[80px] text-right text-xs text-fg-subtle tabular">{d.tables} tables</span>
                    <span className="w-[72px] text-right text-xs text-fg-subtle tabular">{formatBytes(d.size)}</span>
                    <Menu
                      trigger={<Button variant="ghost" square size="sm" icon={<MoreHorizontal size={15} />} />}
                      width={220}
                    >
                      <MenuItem
                        onSelect={() => {
                          void navigator.clipboard.writeText(connectionString(conn, d.name))
                          toast({ kind: 'success', title: 'Connection string copied' })
                        }}
                      >
                        Copy connection string
                      </MenuItem>
                      {heidi && <MenuItem onSelect={() => void attempt(() => api.db.openHeidi(d.name))}>Open in HeidiSQL</MenuItem>}
                      <MenuSeparator />
                      <MenuItem danger icon={<Trash2 size={14} />} onSelect={() => setDropping(d)}>
                        Drop database
                      </MenuItem>
                    </Menu>
                  </div>
                )
              })
            )}
          </Panel>
        </div>
      )}

      <CreateDialog open={creating} onClose={() => setCreating(false)} onCreated={() => list.reload()} />
      <DropDialog target={dropping} onClose={() => setDropping(null)} onDropped={() => list.reload()} />
    </Page>
  )
}
