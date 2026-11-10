import { ArrowDownToLine, ArrowUpFromLine, Database, RefreshCw, TriangleAlert, X } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router'
import type { FileChange, ServerConfig, ServerRuntime, SyncCheck, SyncCheckState, SyncProgress, SyncResult, SyncSnapshot } from '@shared/types'
import { formatBytes, formatDuration } from '@shared/format'
import { needsConfirmation, overlappingChanges } from '@shared/sync'
import { isLive } from '@/components/server-actions'
import { Button } from '@/components/ui/button'
import { Dialog, DialogBody, DialogFooter, DialogHeader } from '@/components/ui/dialog'
import { Field, Input, Textarea } from '@/components/ui/input'
import { Badge, CopyButton, EmptyState, Progress, Spinner } from '@/components/ui/misc'
import { Select } from '@/components/ui/select'
import { SettingRow, Switch } from '@/components/ui/switch'
import { attempt, toast } from '@/components/ui/toast'
import { useAsync } from '@/lib/hooks'
import { api, cn, relativeTime } from '@/lib/utils'
import { useApp } from '@/store/app'

function Section({ title, description, children }: { title: string; description?: ReactNode; children: ReactNode }) {
  return (
    <section className="grid grid-cols-[220px_minmax(0,1fr)] gap-10 border-t border-line py-7 first:border-0 first:pt-0">
      <div>
        <h3 className="text-[13px] font-medium text-fg">{title}</h3>
        {description && <p className="mt-1 text-xs leading-[18px] text-fg-subtle">{description}</p>}
      </div>
      <div className="flex min-w-0 flex-col gap-4">{children}</div>
    </section>
  )
}

const STATE: Record<SyncCheckState, { tone: 'ok' | 'warn' | 'err' | 'neutral'; label: string }> = {
  'no-remote-copy': { tone: 'neutral', label: 'Not pushed yet' },
  'never-synced': { tone: 'warn', label: 'Never synced here' },
  'in-sync': { tone: 'ok', label: 'Up to date' },
  'local-changed': { tone: 'neutral', label: 'Local changes' },
  'remote-changed': { tone: 'warn', label: 'Remote is newer' },
  diverged: { tone: 'err', label: 'Both changed' }
}

function describe(check: SyncCheck): string {
  const latest = check.latest
  const from = latest ? `${latest.machine}, ${relativeTime(latest.time).toLowerCase()}` : ''
  switch (check.state) {
    case 'no-remote-copy':
      return 'Nothing has been pushed for this server. Push to upload the first copy.'
    case 'never-synced':
      return `The remote has a copy from ${from}. Pull to replace this copy with it, or push to make this one the latest.`
    case 'in-sync':
      return `This copy matches the latest push (${from}).`
    case 'local-changed':
      return `${check.local.length} file${check.local.length === 1 ? '' : 's'} changed here since the last sync.`
    case 'remote-changed':
      return `A newer push from ${from} is waiting to be pulled.`
    case 'diverged':
      return `This copy and the remote both changed since the last sync. Newest push: ${from}.`
  }
}

const CHANGE_MARK: Record<FileChange['change'], string> = { added: '+', removed: '−', modified: '~' }

function ChangeList({ title, changes, overlap }: { title: string; changes: FileChange[]; overlap: Set<string> }) {
  const shown = changes.slice(0, 300)
  return (
    <div className="min-w-0 flex-1">
      <div className="mb-1.5 text-xs font-medium text-fg-muted">
        {title} <span className="text-fg-subtle tabular">({changes.length})</span>
      </div>
      <div className="max-h-[220px] overflow-y-auto rounded-[8px] bg-sunken py-1 font-mono text-[11.5px] shadow-[inset_0_0_0_1px_var(--line)] selectable">
        {shown.length === 0 && <div className="px-2.5 py-1 text-fg-subtle">No changes</div>}
        {shown.map((c) => (
          <div key={c.path} className={cn('flex gap-2 px-2.5 py-[1px]', overlap.has(c.path.toLowerCase()) && 'bg-err/10 text-err')}>
            <span className={cn('w-2 shrink-0', c.change === 'added' ? 'text-ok' : c.change === 'removed' ? 'text-err' : 'text-warn')}>{CHANGE_MARK[c.change]}</span>
            <span className="truncate">{c.path}</span>
          </div>
        ))}
        {changes.length > shown.length && <div className="px-2.5 py-1 text-fg-subtle">and {changes.length - shown.length} more</div>}
      </div>
    </div>
  )
}

function Changes({ check }: { check: SyncCheck }) {
  const overlap = new Set(overlappingChanges(check.local, check.remote).map((p) => p.toLowerCase()))
  return (
    <div className="flex gap-3">
      <ChangeList title="Changed here" changes={check.local} overlap={overlap} />
      {check.remoteUnknown ? (
        <div className="flex-1 text-xs text-fg-subtle">The remote's changes could not be listed; the snapshot this machine last synced is gone.</div>
      ) : (
        <ChangeList title="Changed on the remote" changes={check.remote} overlap={overlap} />
      )}
    </div>
  )
}

function ProgressBlock({ progress, onCancel }: { progress: SyncProgress; onCancel: () => void }) {
  const parts: string[] = []
  if (progress.bytesTotal) parts.push(`${formatBytes(progress.bytesDone)} of ${formatBytes(progress.bytesTotal)}`)
  if (progress.speed > 0) parts.push(`${formatBytes(progress.speed)}/s`)
  if (progress.eta !== null && progress.fraction !== null && progress.fraction < 1) parts.push(`${formatDuration(progress.eta * 1000)} left`)
  return (
    <div className="rounded-[10px] bg-sunken p-3.5 shadow-[inset_0_0_0_1px_var(--line)]">
      <div className="mb-2 flex items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-2 text-[13px] text-fg">
          <Spinner size={13} />
          <span className="truncate">{progress.phase}</span>
        </div>
        <Button size="sm" variant="ghost" icon={<X size={13} strokeWidth={2} />} onClick={onCancel}>
          Cancel
        </Button>
      </div>
      <Progress value={progress.fraction} />
      <div className="mt-2 flex justify-between text-xs text-fg-subtle tabular">
        <span>{parts.join(' · ') || ' '}</span>
        {progress.fraction !== null && <span>{Math.round(progress.fraction * 100)}%</span>}
      </div>
    </div>
  )
}

type Pending =
  | { kind: 'push'; check: SyncCheck | null }
  | { kind: 'pull'; check: SyncCheck | null }
  | { kind: 'restore'; snapshot: SyncSnapshot }

function ConfirmDialog({
  pending,
  server,
  running,
  onClose,
  onConfirm
}: {
  pending: Pending | null
  server: ServerConfig
  running: boolean
  onClose: () => void
  onConfirm: (importDatabase: boolean) => void
}) {
  const [importDb, setImportDb] = useState(true)
  useEffect(() => setImportDb(true), [pending])
  if (!pending) return null
  const check = pending.kind === 'restore' ? null : pending.check
  const conflict = !!check && needsConfirmation(pending.kind === 'push' ? 'push' : 'pull', check.state)
  const snapshot = pending.kind === 'restore' ? pending.snapshot : check?.latest
  const hasDb = !!snapshot?.hasDatabase

  let title = ''
  let description: ReactNode = null
  let action = ''
  if (pending.kind === 'push') {
    title = check?.state === 'diverged' ? 'Both copies changed' : 'The remote has a newer push'
    description =
      check?.state === 'diverged'
        ? 'Files changed here and on the remote since this machine last synced. Pushing makes this copy the latest; the other push stays in History.'
        : `${check?.latest?.machine ?? 'Another machine'} pushed after this machine last synced. Pushing now makes this older copy the latest; theirs stays in History.`
    action = 'Push anyway'
  } else {
    const verb = pending.kind === 'restore' ? 'Restore' : 'Pull'
    title = pending.kind === 'restore' ? `Restore ${pending.snapshot.shortId}?` : conflict ? (check?.state === 'diverged' ? 'Both copies changed' : 'Pull over local changes?') : `Pull ${server.name}?`
    description = (
      <>
        {running && 'The server is stopped first and started again afterwards. '}
        This copy is saved as a restore point, then made to match{' '}
        {pending.kind === 'restore' ? `the snapshot from ${pending.snapshot.machine}, ${new Date(pending.snapshot.time).toLocaleString()}` : `the latest push${snapshot ? ` from ${snapshot.machine}` : ''}`}. Files that are not in it are deleted unless the ignore list leaves them out. This machine keeps its own ports, license key and database
        settings.
      </>
    )
    action = conflict ? `${verb} anyway` : verb
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} width={check && (check.local.length || check.remote.length) ? 720 : 520}>
      <DialogHeader title={title} description={description} onClose={onClose} />
      <DialogBody className="flex flex-col gap-4">
        {check && (check.local.length > 0 || check.remote.length > 0 || check.remoteUnknown) && <Changes check={check} />}
        {pending.kind !== 'push' && (
          <SettingRow
            className="py-1"
            title="Import the database"
            description={
              hasDb
                ? `Replaces ${server.database ? `database ${server.database}` : 'a new database'} with the dump in the snapshot.`
                : 'This snapshot has no database dump.'
            }
          >
            <Switch checked={hasDb && importDb} disabled={!hasDb} onChange={setImportDb} />
          </SettingRow>
        )}
      </DialogBody>
      <DialogFooter>
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button variant={conflict ? 'danger-solid' : 'primary'} onClick={() => onConfirm(hasDb && importDb)}>
          {action}
        </Button>
      </DialogFooter>
    </Dialog>
  )
}

function EnableSync({ server }: { server: ServerConfig }) {
  const navigate = useNavigate()
  const remotes = useAsync(() => api.sync.remotes(), [])
  const [remoteId, setRemoteId] = useState('')
  const [syncId, setSyncId] = useState('')
  const [includeDb, setIncludeDb] = useState(!!server.database)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!remoteId && remotes.data?.length) setRemoteId(remotes.data[0].id)
  }, [remotes.data, remoteId])

  if (remotes.data && remotes.data.length === 0) {
    return (
      <EmptyState
        title="Connect a storage remote first"
        description="Sync pushes snapshots of this server to a bucket, an SFTP host or a folder, and pulls them on your other machines."
      >
        <Button variant="primary" onClick={() => navigate('/settings')}>
          Open Settings
        </Button>
      </EmptyState>
    )
  }

  return (
    <Section title="Sync this server" description="Push snapshots to a remote and pull them on your other machines. Only changed data is uploaded after the first push.">
      <Field label="Remote">
        <Select value={remoteId} onChange={setRemoteId} options={(remotes.data ?? []).map((r) => ({ value: r.id, label: r.name, hint: r.kind.toUpperCase() }))} />
      </Field>
      <Field label="Sync id" hint="Leave empty to start a new one. To link this server with a copy on another machine, paste that copy's id; or use Clone from remote on the Overview page.">
        <Input mono value={syncId} placeholder="New id" onChange={(e) => setSyncId(e.target.value)} />
      </Field>
      <SettingRow className="py-1" title="Include the database" description={server.database ? `Dumps ${server.database} with every push.` : 'This server has no database.'}>
        <Switch checked={includeDb && !!server.database} disabled={!server.database} onChange={setIncludeDb} />
      </SettingRow>
      <div>
        <Button
          variant="primary"
          loading={busy}
          disabled={!remoteId}
          onClick={async () => {
            setBusy(true)
            await attempt(() => api.sync.enable(server.id, { remoteId, syncId: syncId.trim() || undefined, includeDatabase: includeDb && !!server.database }), 'Could not turn on sync')
            setBusy(false)
          }}
        >
          Turn on sync
        </Button>
      </div>
    </Section>
  )
}

function IgnoreEditor({ server }: { server: ServerConfig }) {
  const file = useAsync(() => api.sync.readIgnore(server.id), [server.id])
  const [text, setText] = useState('')
  const [saving, setSaving] = useState(false)
  useEffect(() => setText(file.data ?? ''), [file.data])
  const dirty = file.data !== undefined && text !== file.data
  return (
    <Field label="Ignore list" hint="Synced with the server as .fxsyncignore, so every machine uses the same list. Ignored files are never uploaded or deleted by a pull.">
      <Textarea className="min-h-[220px] overflow-x-auto font-mono text-[12px] leading-[18px] whitespace-pre" wrap="off" spellCheck={false} value={text} onChange={(e) => setText(e.target.value)} />
      <div className="flex gap-1.5">
        <Button
          size="sm"
          disabled={!dirty}
          loading={saving}
          onClick={async () => {
            setSaving(true)
            if (await attempt(() => api.sync.writeIgnore(server.id, text), 'Could not save the ignore list')) file.reload()
            setSaving(false)
          }}
        >
          Save
        </Button>
        <Button size="sm" variant="ghost" disabled={!dirty} onClick={() => setText(file.data ?? '')}>
          Discard
        </Button>
      </div>
    </Field>
  )
}

function History({ server, snapshots, loading, busy, onRestore }: { server: ServerConfig; snapshots: SyncSnapshot[] | undefined; loading: boolean; busy: boolean; onRestore: (s: SyncSnapshot) => void }) {
  const base = server.syncState?.base
  if (loading && !snapshots) return <div className="flex items-center gap-2 text-xs text-fg-subtle"><Spinner size={12} /> Loading history</div>
  if (!snapshots?.length) return <div className="text-xs text-fg-subtle">No snapshots yet.</div>
  return (
    <div className="overflow-hidden rounded-[10px] shadow-[inset_0_0_0_1px_var(--line)]">
      <div className="grid grid-cols-[150px_minmax(0,1fr)_120px_70px_80px_84px_84px] gap-3 border-b border-line px-3 py-2 text-2xs font-medium text-fg-subtle">
        <span>When</span>
        <span>Machine</span>
        <span>Kind</span>
        <span>Build</span>
        <span className="text-right">Size</span>
        <span className="text-right">Uploaded</span>
        <span />
      </div>
      <div className="max-h-[360px] overflow-y-auto">
        {snapshots.map((s) => {
          const current = !!base && (s.id.startsWith(base) || base.startsWith(s.id))
          return (
            <div key={s.id} className="grid grid-cols-[150px_minmax(0,1fr)_120px_70px_80px_84px_84px] items-center gap-3 border-b border-line px-3 py-2 text-xs last:border-0">
              <span className="text-fg tabular" title={new Date(s.time).toLocaleString()}>
                {new Date(s.time).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}{' '}
                {new Date(s.time).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
              </span>
              <span className="flex min-w-0 items-center gap-2 text-fg-muted" title={`Snapshot ${s.shortId}`}>
                <span className="truncate">{s.machine}</span>
                {current && (
                  <Badge tone="ok" className="shrink-0">
                    This copy
                  </Badge>
                )}
              </span>
              <span className="flex items-center gap-1">
                <Badge tone={s.kind === 'push' ? 'neutral' : 'outline'}>{s.kind === 'push' ? 'Push' : 'Before pull'}</Badge>
                {s.hasDatabase && <Database size={12} strokeWidth={1.75} className="text-fg-subtle" aria-label="Includes database" />}
              </span>
              <span className="font-mono text-fg-subtle">{s.build ?? '–'}</span>
              <span className="text-right text-fg-muted tabular">{formatBytes(s.bytes)}</span>
              <span className="text-right text-fg-subtle tabular">{formatBytes(s.added)}</span>
              <span className="text-right">
                <Button size="sm" variant="ghost" disabled={busy} onClick={() => onRestore(s)}>
                  Restore
                </Button>
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

export function SyncTab({ server, runtime }: { server: ServerConfig; runtime: ServerRuntime | undefined }) {
  const remotes = useAsync(() => api.sync.remotes(), [])
  const progress = useApp((s) => s.sync[server.id])
  const busy = !!progress
  const [check, setCheck] = useState<SyncCheck | null>(null)
  const [checking, setChecking] = useState(false)
  const [checkError, setCheckError] = useState<string | null>(null)
  const history = useAsync(() => (server.sync ? api.sync.history(server.id) : Promise.resolve([])), [server.id, server.sync?.id, server.syncState?.base])
  const [pending, setPending] = useState<Pending | null>(null)
  const [starting, setStarting] = useState<'push' | 'pull' | null>(null)

  const [checkSeq] = useState(() => ({ n: 0 }))
  const runCheck = async (): Promise<SyncCheck | null> => {
    const seq = ++checkSeq.n
    setChecking(true)
    try {
      const c = await api.sync.check(server.id)
      if (seq !== checkSeq.n) return c
      setCheck(c)
      setCheckError(null)
      return c
    } catch (e) {
      setCheckError(e instanceof Error ? e.message : String(e))
      return null
    } finally {
      setChecking(false)
    }
  }

  useEffect(() => {
    if (server.sync && !busy) void runCheck()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [server.id, server.sync?.id, server.syncState?.base, busy])

  if (!server.sync) {
    return (
      <div className="h-full overflow-y-auto">
        <div className="mx-auto max-w-[920px] px-8 pt-7 pb-16">
          <EnableSync server={server} />
        </div>
      </div>
    )
  }

  const sync = server.sync
  const remote = remotes.data?.find((r) => r.id === sync.remoteId)
  const finish = (res: SyncResult | null): void => {
    if (!res) return
    if (res.status === 'conflict') {
      setCheck(res.check)
      return
    }
    toast({ kind: 'success', title: 'Sync finished', description: res.message })
    history.reload()
  }

  const push = async (force: boolean): Promise<void> => {
    setStarting('push')
    let res: SyncResult | null = null
    await attempt(async () => {
      res = await api.sync.push(server.id, { includeDatabase: sync.includeDatabase, force })
    }, 'Push failed')
    setStarting(null)
    if (res && (res as SyncResult).status === 'conflict') setPending({ kind: 'push', check: (res as Extract<SyncResult, { status: 'conflict' }>).check })
    finish(res)
  }

  const pull = async (importDatabase: boolean, snapshotId?: string): Promise<void> => {
    setStarting('pull')
    let res: SyncResult | null = null
    await attempt(async () => {
      res = await api.sync.pull(server.id, { importDatabase, force: true, snapshotId })
    }, snapshotId ? 'Restore failed' : 'Pull failed')
    setStarting(null)
    finish(res)
  }

  const askPull = async (): Promise<void> => {
    // Always a fresh check: the pull dialog must list what is about to be overwritten now.
    const c = await runCheck()
    setPending({ kind: 'pull', check: c })
  }

  const askPush = async (): Promise<void> => {
    const c = await runCheck()
    if (c && needsConfirmation('push', c.state)) setPending({ kind: 'push', check: c })
    else void push(true)
  }

  const state = check ? STATE[check.state] : null
  const lastAt = server.syncState?.lastAt

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-[920px] px-8 pt-7 pb-16">
        <div className="mb-8 rounded-[12px] bg-raised/40 p-4 shadow-[inset_0_0_0_1px_var(--line)]">
          <div className="flex items-start justify-between gap-6">
            <div className="min-w-0">
              <div className="flex items-start gap-2">
                {checking && !check ? <Spinner size={13} className="mt-1" /> : state && <Badge tone={state.tone} className="mt-px shrink-0">{state.label}</Badge>}
                <span className="text-[13px] leading-5 text-fg">{checkError ? checkError : check ? describe(check) : 'Checking the remote'}</span>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-fg-subtle">
                <span className="flex items-center gap-0.5">
                  Sync id <span className="ml-1 font-mono text-fg-muted selectable">{sync.id}</span>
                  <CopyButton value={sync.id} label="Copy sync id" className="h-5 w-5" />
                </span>
                <span>Remote {remote ? <span className="text-fg-muted">{remote.name}</span> : <span className="text-err">missing on this machine</span>}</span>
                <span>
                  Last {server.syncState?.lastAction ?? 'sync'} {lastAt ? relativeTime(lastAt).toLowerCase() : 'never'}
                </span>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              <Button variant="ghost" square disabled={busy || checking} onClick={() => void runCheck()} icon={<RefreshCw size={14} strokeWidth={1.75} className={cn(checking && 'animate-spin')} />} aria-label="Check again" />
              <Button disabled={busy} loading={starting === 'pull'} icon={<ArrowDownToLine size={14} strokeWidth={1.75} />} onClick={() => void askPull()}>
                Pull
              </Button>
              <Button variant="primary" disabled={busy} loading={starting === 'push'} icon={<ArrowUpFromLine size={14} strokeWidth={1.75} />} onClick={() => void askPush()}>
                Push
              </Button>
            </div>
          </div>
          {progress && (
            <div className="mt-4">
              <ProgressBlock progress={progress} onCancel={() => void api.sync.cancel(server.id)} />
            </div>
          )}
          {!progress && server.syncState?.interrupted && (
            <div className="mt-4 flex items-center justify-between gap-4 rounded-[10px] bg-warn/10 px-3.5 py-2.5 text-[13px] text-warn">
              <span className="flex items-center gap-2">
                <TriangleAlert size={14} strokeWidth={1.75} />
                The last push was stopped before it finished. Push again to finish it; anything the remote already holds is skipped.
              </span>
              <Button size="sm" onClick={() => void push(true)}>
                Resume push
              </Button>
            </div>
          )}
          {!progress && check && (check.state === 'diverged' || check.state === 'local-changed' || check.state === 'remote-changed') && (check.local.length > 0 || check.remote.length > 0) && (
            <div className="mt-4">
              <Changes check={check} />
            </div>
          )}
        </div>

        <section className="mb-7">
          <div className="mb-3 flex items-end justify-between gap-6">
            <div>
              <h3 className="text-[13px] font-medium text-fg">History</h3>
              <p className="mt-1 text-xs leading-[18px] text-fg-subtle">Every push, and the restore point saved before each pull. Restoring one makes this copy match it; a new restore point is saved first.</p>
            </div>
          </div>
          <History server={server} snapshots={history.data} loading={history.loading} busy={busy} onRestore={(snapshot) => setPending({ kind: 'restore', snapshot })} />
        </section>

        <Section title="Options">
          <SettingRow
            className="py-0"
            title="Include the database"
            description={server.database ? `Dumps ${server.database} with mariadb-dump on every push. Pulls ask before importing it.` : 'This server has no database.'}
          >
            <Switch checked={sync.includeDatabase && !!server.database} disabled={!server.database || busy} onChange={(v) => void attempt(() => api.sync.setIncludeDatabase(server.id, v))} />
          </SettingRow>
          <IgnoreEditor server={server} />
        </Section>

        <Section title="Turn off sync" description="Stops syncing this server on this machine. Its snapshots stay on the remote.">
          <div>
            <Button variant="danger" disabled={busy} onClick={() => void attempt(() => api.sync.disable(server.id), 'Could not turn off sync')}>
              Turn off sync
            </Button>
          </div>
        </Section>
      </div>

      <ConfirmDialog
        pending={pending}
        server={server}
        running={isLive(runtime)}
        onClose={() => setPending(null)}
        onConfirm={(importDatabase) => {
          const p = pending
          setPending(null)
          if (!p) return
          if (p.kind === 'push') void push(true)
          else void pull(importDatabase, p.kind === 'restore' ? p.snapshot.id : undefined)
        }}
      />
    </div>
  )
}
