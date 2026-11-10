import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router'
import type { PortCheck, RemoteServerEntry } from '@shared/types'
import { formatBytes, formatDuration } from '@shared/format'
import { Button } from '@/components/ui/button'
import { Dialog, DialogBody, DialogFooter, DialogHeader } from '@/components/ui/dialog'
import { Field, Input } from '@/components/ui/input'
import { Badge, Progress, Spinner } from '@/components/ui/misc'
import { Select } from '@/components/ui/select'
import { SettingRow, Switch } from '@/components/ui/switch'
import { attempt } from '@/components/ui/toast'
import { useAsync } from '@/lib/hooks'
import { api, cn, relativeTime } from '@/lib/utils'
import { useApp } from '@/store/app'
import { useUi } from '@/store/ui'
import { PortStatus } from './new-server'

/** Creates a server on this machine from the newest push of a server synced from another one. */
export function CloneRemoteDialog() {
  const open = useUi((s) => s.cloneRemote)
  const close = useUi((s) => s.close)
  const navigate = useNavigate()
  const remotes = useAsync(() => (open ? api.sync.remotes() : Promise.resolve([])), [open])
  const [remoteId, setRemoteId] = useState('')
  const [picked, setPicked] = useState<RemoteServerEntry | null>(null)
  const [name, setName] = useState('')
  const [gamePort, setGamePort] = useState(30120)
  const [txAdminPort, setTxAdminPort] = useState(40120)
  const [importDb, setImportDb] = useState(true)
  const [ports, setPorts] = useState<PortCheck[]>([])
  const [busy, setBusy] = useState(false)
  const servers = useAsync(() => (open && remoteId ? api.sync.remoteServers(remoteId) : Promise.resolve([])), [open, remoteId])
  const progress = useApp((s) => (picked ? s.sync[`clone:${picked.syncId}`] : undefined))

  useEffect(() => {
    if (!open) return
    setPicked(null)
    setBusy(false)
    void api.servers.suggestPorts().then((p) => {
      setGamePort(p.gamePort)
      setTxAdminPort(p.txAdminPort)
    })
  }, [open])

  useEffect(() => {
    if (open && !remoteId && remotes.data?.length) setRemoteId(remotes.data[0].id)
  }, [open, remotes.data, remoteId])

  useEffect(() => {
    if (!picked) return
    const t = setTimeout(() => {
      void api.servers.checkPorts(picked.latest.mode === 'txadmin' ? [gamePort, txAdminPort] : [gamePort]).then(setPorts)
    }, 250)
    return () => clearTimeout(t)
  }, [picked, gamePort, txAdminPort])

  const submit = async (): Promise<void> => {
    if (!picked) return
    setBusy(true)
    let id: string | null = null
    const ok = await attempt(async () => {
      const s = await api.sync.clone({ remoteId, syncId: picked.syncId, name, gamePort, txAdminPort, importDatabase: importDb && picked.latest.hasDatabase })
      id = s.id
    }, 'Could not clone')
    setBusy(false)
    if (ok && id) {
      close('cloneRemote')
      navigate(`/servers/${id}/sync`)
    }
  }

  const portFor = (port: number): PortCheck | undefined => ports.find((p) => p.port === port)

  return (
    <Dialog open={open} onOpenChange={(o) => !o && !busy && close('cloneRemote')} width={600} dismissable={!busy}>
      <DialogHeader
        title="Clone from remote"
        description="Creates a server on this machine from the newest push of a synced server. It gets its own ports, license key and database, and stays linked for push and pull."
        onClose={busy ? undefined : () => close('cloneRemote')}
      />
      <DialogBody className="flex flex-col gap-4">
        {remotes.data && remotes.data.length === 0 ? (
          <div className="text-[13px] text-fg-subtle">Connect a remote in Settings → Sync first, or paste a connection code there.</div>
        ) : (
          <>
            <Field label="Remote">
              <Select
                value={remoteId}
                disabled={busy}
                onChange={(v) => {
                  setRemoteId(v)
                  setPicked(null)
                }}
                options={(remotes.data ?? []).map((r) => ({ value: r.id, label: r.name, hint: r.kind.toUpperCase() }))}
              />
            </Field>
            <Field label="Server">
              <div className="max-h-[220px] overflow-y-auto rounded-[10px] shadow-[inset_0_0_0_1px_var(--line-strong)]">
                {servers.loading && (
                  <div className="flex items-center gap-2 px-3 py-3 text-xs text-fg-subtle">
                    <Spinner size={12} /> Reading the remote
                  </div>
                )}
                {servers.error && <div className="px-3 py-3 text-xs text-err">{servers.error}</div>}
                {!servers.loading && !servers.error && servers.data?.length === 0 && <div className="px-3 py-3 text-xs text-fg-subtle">Nothing has been pushed to this remote yet.</div>}
                {servers.data?.map((s) => (
                  <button
                    key={s.syncId}
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      setPicked(s)
                      setName(s.name)
                      setImportDb(s.latest.hasDatabase)
                    }}
                    className={cn(
                      'flex w-full items-center justify-between gap-4 border-b border-line px-3 py-2.5 text-left last:border-0 transition-colors',
                      picked?.syncId === s.syncId ? 'bg-active' : 'hover:bg-hover'
                    )}
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 text-[13px] text-fg">
                        <span className="truncate">{s.name}</span>
                        <Badge tone="outline">{s.latest.mode === 'txadmin' ? 'txAdmin' : 'Standalone'}</Badge>
                      </div>
                      <div className="mt-0.5 font-mono text-[11px] text-fg-subtle">{s.syncId}</div>
                    </div>
                    <div className="shrink-0 text-right text-xs text-fg-subtle">
                      <div>
                        {s.latest.machine} · {relativeTime(s.latest.time)}
                      </div>
                      <div className="tabular">
                        {formatBytes(s.latest.bytes)} · build {s.latest.build ?? '?'}
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            </Field>
            {picked && (
              <>
                <Field label="Name on this machine">
                  <Input value={name} disabled={busy} onChange={(e) => setName(e.target.value)} />
                </Field>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Game port" aside={<PortStatus check={portFor(gamePort)} />}>
                    <Input mono type="number" disabled={busy} value={gamePort} onChange={(e) => setGamePort(Number(e.target.value))} />
                  </Field>
                  {picked.latest.mode === 'txadmin' && (
                    <Field label="txAdmin port" aside={<PortStatus check={portFor(txAdminPort)} />}>
                      <Input mono type="number" disabled={busy} value={txAdminPort} onChange={(e) => setTxAdminPort(Number(e.target.value))} />
                    </Field>
                  )}
                </div>
                <SettingRow
                  className="py-0"
                  title="Import the database"
                  description={picked.latest.hasDatabase ? 'Creates a new database on this machine from the dump in the snapshot.' : 'This snapshot has no database dump.'}
                >
                  <Switch checked={importDb && picked.latest.hasDatabase} disabled={!picked.latest.hasDatabase || busy} onChange={setImportDb} />
                </SettingRow>
              </>
            )}
            {busy && progress && (
              <div>
                <div className="mb-1.5 flex justify-between text-xs text-fg-subtle tabular">
                  <span>
                    {progress.phase}
                    {progress.bytesTotal ? ` · ${formatBytes(progress.bytesDone)} of ${formatBytes(progress.bytesTotal)}` : ''}
                    {progress.speed > 0 ? ` · ${formatBytes(progress.speed)}/s` : ''}
                    {progress.eta !== null && progress.fraction !== null ? ` · ${formatDuration(progress.eta * 1000)} left` : ''}
                  </span>
                  {progress.fraction !== null && <span>{Math.round(progress.fraction * 100)}%</span>}
                </div>
                <Progress value={progress.fraction} />
              </div>
            )}
          </>
        )}
      </DialogBody>
      <DialogFooter>
        <Button variant="ghost" disabled={busy} onClick={() => close('cloneRemote')}>
          Cancel
        </Button>
        {busy && picked && (
          <Button variant="ghost" onClick={() => void api.sync.cancel(`clone:${picked.syncId}`)}>
            Stop
          </Button>
        )}
        <Button variant="primary" loading={busy} disabled={!picked || !name.trim()} onClick={() => void submit()}>
          Clone
        </Button>
      </DialogFooter>
    </Dialog>
  )
}
