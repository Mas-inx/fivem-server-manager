import { FolderOpen, KeyRound, Play, ShieldAlert, Square, TriangleAlert } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { HubSetupInput, HubStatus } from '@shared/types'
import { formatBytes } from '@shared/format'
import { Button } from '@/components/ui/button'
import { Dialog, DialogBody, DialogFooter, DialogHeader } from '@/components/ui/dialog'
import { Field, Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/misc'
import { SettingRow, Switch } from '@/components/ui/switch'
import { attempt, toast } from '@/components/ui/toast'
import { api, cn } from '@/lib/utils'

function HubSetupDialog({ open, status, onClose, onDone }: { open: boolean; status: HubStatus | null; onClose: () => void; onDone: (s: HubStatus) => void }) {
  const [draft, setDraft] = useState<HubSetupInput | null>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (open) void api.hub.suggest().then(setDraft)
  }, [open])
  const set = <K extends keyof HubSetupInput>(k: K, v: HubSetupInput[K]): void => setDraft((d) => (d ? { ...d, [k]: v } : d))
  const editing = !!status?.configured

  return (
    <Dialog open={open} onOpenChange={(o) => !o && !busy && onClose()} width={560} dismissable={!busy}>
      <DialogHeader
        title={editing ? 'Hub settings' : 'Make this machine the sync hub'}
        description="The hub stores the snapshots every machine pushes. It runs restic's rest-server over HTTPS with its own certificate and a generated login. Other machines connect with its connection code."
        onClose={busy ? undefined : onClose}
      />
      {draft && (
        <DialogBody className="flex flex-col gap-4">
          <Field
            label="Address other machines use"
            hint={editing ? 'Changing it issues a new server certificate; existing connection codes keep working.' : "This VPS's public IP or a DNS name pointing at it."}
          >
            <Input mono value={draft.publicAddress} onChange={(e) => set('publicAddress', e.target.value)} />
            {!!status?.addresses.length && (
              <div className="flex flex-wrap gap-1">
                {status.addresses.map((a) => (
                  <button
                    key={a}
                    type="button"
                    onClick={() => set('publicAddress', a)}
                    className={cn('rounded-[5px] px-1.5 py-0.5 font-mono text-[11px] shadow-[inset_0_0_0_1px_var(--line-strong)] hover:bg-hover', draft.publicAddress === a ? 'text-fg' : 'text-fg-subtle')}
                  >
                    {a}
                  </button>
                ))}
              </div>
            )}
          </Field>
          <div className="grid grid-cols-[110px_minmax(0,1fr)] gap-3">
            <Field label="Port">
              <Input mono type="number" value={draft.port} onChange={(e) => set('port', Number(e.target.value))} />
            </Field>
            <Field label="Data folder" hint="Every machine's history ends up here. Pick a disk with room to grow.">
              <div className="flex gap-1.5">
                <Input mono className="flex-1" value={draft.dataPath} onChange={(e) => set('dataPath', e.target.value)} />
                <Button
                  square
                  icon={<FolderOpen size={14} strokeWidth={1.75} />}
                  onClick={async () => {
                    const p = await api.app.pickFolder('Choose where the hub stores snapshots', draft.dataPath || undefined)
                    if (p) set('dataPath', p)
                  }}
                />
              </div>
            </Field>
          </div>
          <SettingRow
            className="py-0"
            title="Append-only"
            description="Machines can add snapshots but never delete or change existing ones, so a broken or compromised machine cannot wipe the history."
          >
            <Switch checked={draft.appendOnly} onChange={(v) => set('appendOnly', v)} />
          </SettingRow>
          <SettingRow className="py-0" title="Start with the app" description="The hub runs while FiveM Server Manager runs, including in the tray.">
            <Switch checked={draft.autoStart} onChange={(v) => set('autoStart', v)} />
          </SettingRow>
        </DialogBody>
      )}
      <DialogFooter>
        <Button variant="ghost" disabled={busy} onClick={onClose}>
          Cancel
        </Button>
        <Button
          variant="primary"
          loading={busy}
          disabled={!draft}
          onClick={async () => {
            if (!draft) return
            setBusy(true)
            let next: HubStatus | null = null
            await attempt(async () => {
              next = await api.hub.setup(draft)
            }, 'Could not set up the hub')
            setBusy(false)
            if (next) {
              onDone(next)
              onClose()
              toast({ kind: 'success', title: editing ? 'Hub updated' : 'Hub is running', description: 'Copy its connection code and paste it on your other machines.' })
            }
          }}
        >
          {editing ? 'Save and restart' : 'Set up hub'}
        </Button>
      </DialogFooter>
    </Dialog>
  )
}

function FirewallDialog({ port, open, onClose, onDone }: { port: number; open: boolean; onClose: () => void; onDone: (s: HubStatus) => void }) {
  const [busy, setBusy] = useState(false)
  return (
    <Dialog open={open} onOpenChange={(o) => !o && !busy && onClose()} width={480} dismissable={!busy}>
      <DialogHeader
        title={`Open port ${port} in Windows Firewall?`}
        description={`Adds an inbound rule named FiveM-Server-Manager-Sync-Hub that allows TCP ${port}, replacing any earlier one. Windows asks for administrator approval. If your VPS provider has its own firewall, open the port there too.`}
        onClose={busy ? undefined : onClose}
      />
      <DialogFooter>
        <Button variant="ghost" disabled={busy} onClick={onClose}>
          Cancel
        </Button>
        <Button
          variant="primary"
          loading={busy}
          onClick={async () => {
            setBusy(true)
            let next: HubStatus | null = null
            await attempt(async () => {
              next = await api.hub.openFirewall()
            }, 'The port was not opened')
            setBusy(false)
            if (next) {
              onDone(next)
              onClose()
            }
          }}
        >
          Open port
        </Button>
      </DialogFooter>
    </Dialog>
  )
}

/** Settings → Sync: this machine as the hub every other machine pushes to. */
export function HubPanel({ onChanged }: { onChanged: () => void }) {
  const [status, setStatus] = useState<HubStatus | null>(null)
  const [setupOpen, setSetupOpen] = useState(false)
  const [firewallOpen, setFirewallOpen] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    void api.hub.status().then(setStatus)
    return api.on.hub(setStatus)
  }, [])

  const done = (s: HubStatus): void => {
    setStatus(s)
    onChanged()
  }

  if (!status) return null
  const s = status.settings
  const state = status.starting ? { tone: 'neutral' as const, label: 'Starting' } : status.running ? { tone: 'ok' as const, label: 'Running' } : { tone: 'err' as const, label: 'Stopped' }

  return (
    <div className="py-3.5">
      {!status.configured ? (
        <div className="flex items-center justify-between gap-8">
          <div className="min-w-0">
            <div className="text-[13px] text-fg">Hub on this machine</div>
            <div className="mt-0.5 text-xs leading-[18px] text-fg-subtle">
              Make this machine the storage your other machines push to and pull from. Do this on the VPS that should hold the history; the other machines then paste its connection code.
            </div>
          </div>
          <Button className="shrink-0" onClick={() => setSetupOpen(true)}>
            Set up hub
          </Button>
        </div>
      ) : (
        <div className="rounded-[10px] p-3.5 shadow-[inset_0_0_0_1px_var(--line)]">
          <div className="flex items-start justify-between gap-6">
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-[13px] text-fg">
                Hub on this machine
                <Badge tone={state.tone}>{state.label}</Badge>
                {s.appendOnly && <Badge tone="outline">Append-only</Badge>}
              </div>
              <div className="mt-1 font-mono text-[11.5px] text-fg-muted selectable">
                https://{s.publicAddress}:{s.port}
              </div>
              <div className="mt-0.5 text-xs text-fg-subtle tabular">
                {[status.repoBytes !== null && `${formatBytes(status.repoBytes)} stored`, status.diskFree !== null && `${formatBytes(status.diskFree)} free`, `rest-server ${status.version}`]
                  .filter(Boolean)
                  .join(' · ')}
              </div>
              <div className="mt-0.5 truncate font-mono text-[11px] text-fg-faint" title={s.dataPath}>
                {s.dataPath}
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <Button
                size="sm"
                icon={<KeyRound size={13} strokeWidth={1.75} />}
                onClick={() =>
                  void attempt(async () => {
                    await navigator.clipboard.writeText(await api.hub.connectionCode())
                    toast({ kind: 'info', title: 'Connection code copied', description: "Paste it in Settings → Sync on your other machines. It contains the hub's login and the repository password." })
                  })
                }
              >
                Connection code
              </Button>
              <Button
                size="sm"
                variant="ghost"
                loading={busy || status.starting}
                icon={status.running ? <Square size={12} strokeWidth={2} /> : <Play size={13} strokeWidth={2} />}
                onClick={async () => {
                  setBusy(true)
                  await attempt(() => (status.running ? api.hub.stop() : api.hub.start()), status.running ? 'Could not stop the hub' : 'Could not start the hub')
                  setStatus(await api.hub.status())
                  setBusy(false)
                }}
              >
                {status.running ? 'Stop' : 'Start'}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setSetupOpen(true)}>
                Settings
              </Button>
            </div>
          </div>
          {status.error && !status.running && <div className="mt-2 text-xs text-err">{status.error}</div>}
          {status.firewallOpen === false && (
            <div className="mt-3 flex items-center justify-between gap-4 rounded-[8px] bg-warn/10 px-3 py-2 text-xs text-warn">
              <span className="flex items-center gap-2">
                <ShieldAlert size={14} strokeWidth={1.75} />
                Windows Firewall does not allow port {s.port} in yet, so other machines cannot reach the hub.
              </span>
              <Button size="sm" onClick={() => setFirewallOpen(true)}>
                Open port…
              </Button>
            </div>
          )}
          <div className="mt-3 flex items-start gap-2 text-xs leading-[18px] text-fg-subtle">
            <TriangleAlert size={13} strokeWidth={1.75} className="mt-0.5 shrink-0" />
            Every machine's history lives on this disk only. Keep a second copy somewhere else, for example a scheduled copy of the data folder to another drive or cloud storage.
          </div>
          <div className="mt-2">
            <Button
              size="sm"
              variant="danger"
              onClick={() =>
                void attempt(async () => {
                  done(await api.hub.disable())
                }, 'Could not turn off the hub')
              }
            >
              Turn off hub
            </Button>
          </div>
        </div>
      )}
      <HubSetupDialog open={setupOpen} status={status} onClose={() => setSetupOpen(false)} onDone={done} />
      <FirewallDialog port={s.port} open={firewallOpen} onClose={() => setFirewallOpen(false)} onDone={setStatus} />
    </div>
  )
}
