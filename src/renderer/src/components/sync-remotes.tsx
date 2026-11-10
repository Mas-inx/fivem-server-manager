import { ClipboardPaste, Cloud, FolderOpen, HardDrive, KeyRound, Plus, Server, Trash2 } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import type { SyncRemote, SyncRemoteInput, SyncRemoteKind } from '@shared/types'
import { Button } from '@/components/ui/button'
import { Dialog, DialogBody, DialogFooter, DialogHeader } from '@/components/ui/dialog'
import { Field, Input, SecretInput, Textarea } from '@/components/ui/input'
import { Badge } from '@/components/ui/misc'
import { Segmented } from '@/components/ui/segmented'
import { SettingRow } from '@/components/ui/switch'
import { attempt, toast } from '@/components/ui/toast'
import { Tooltip } from '@/components/ui/tooltip'
import { useAsync } from '@/lib/hooks'
import { api } from '@/lib/utils'
import { useApp } from '@/store/app'
import { HubPanel } from './sync-hub'

const KIND_LABEL: Record<SyncRemoteKind, string> = { rest: 'Hub', r2: 'Cloudflare R2', s3: 'S3', sftp: 'SFTP', local: 'Folder' }

function where(r: SyncRemote): string {
  switch (r.kind) {
    case 'rest':
      return r.endpoint
    case 'r2':
    case 's3':
      return `${r.bucket}${r.prefix ? `/${r.prefix.replace(/^\/+/, '')}` : ''}`
    case 'sftp':
      return `${r.user}@${r.host}:${r.path}`
    case 'local':
      return r.path
  }
}

const blank = (kind: SyncRemoteKind): SyncRemoteInput => ({
  name: kind === 'rest' ? 'VPS hub' : kind === 'r2' ? 'Cloudflare R2' : kind === 'local' ? 'Shared folder' : kind === 'sftp' ? 'VPS over SFTP' : 'S3 bucket',
  kind,
  endpoint: '',
  bucket: '',
  prefix: 'fivem-servers',
  region: '',
  host: '',
  port: 22,
  user: '',
  path: '',
  keyFile: '',
  certPem: '',
  restPassword: '',
  accessKeyId: '',
  secretAccessKey: '',
  repoPassword: ''
})

function AddRemoteDialog({ open, onClose, onAdded, onPaste }: { open: boolean; onClose: () => void; onAdded: () => void; onPaste: () => void }) {
  const [draft, setDraft] = useState<SyncRemoteInput>(blank('rest'))
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (open) setDraft(blank('rest'))
  }, [open])
  const set = <K extends keyof SyncRemoteInput>(k: K, v: SyncRemoteInput[K]): void => setDraft((d) => ({ ...d, [k]: v }))
  const kind = draft.kind

  const submit = async (): Promise<void> => {
    setBusy(true)
    const ok = await attempt(() => api.sync.addRemote(draft), 'Could not connect the remote')
    setBusy(false)
    if (ok) {
      toast({ kind: 'success', title: `${draft.name} connected`, description: 'Copy its connection code to connect your other machines.' })
      onAdded()
      onClose()
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && !busy && onClose()} width={560} dismissable={!busy}>
      <DialogHeader
        title="Add a sync remote"
        description="Where this machine pushes server snapshots. An empty location gets a new encrypted repository; an existing one opens with its password."
        onClose={busy ? undefined : onClose}
      />
      <DialogBody className="flex flex-col gap-4">
        <Segmented<SyncRemoteKind>
          value={kind}
          onChange={(k) => setDraft((d) => ({ ...blank(k), repoPassword: d.repoPassword }))}
          options={[
            { value: 'rest', label: 'Your VPS', icon: <Server size={13} strokeWidth={1.75} /> },
            { value: 'sftp', label: 'SFTP', icon: <Server size={13} strokeWidth={1.75} /> },
            { value: 'r2', label: 'R2', icon: <Cloud size={13} strokeWidth={1.75} /> },
            { value: 's3', label: 'S3', icon: <Cloud size={13} strokeWidth={1.75} /> },
            { value: 'local', label: 'Folder', icon: <HardDrive size={13} strokeWidth={1.75} /> }
          ]}
        />
        {kind === 'rest' && (
          <div className="flex items-center justify-between gap-4 rounded-[10px] bg-sunken px-3.5 py-3 text-xs leading-[18px] text-fg-subtle shadow-[inset_0_0_0_1px_var(--line)]">
            <span>
              Set up the hub on the VPS first (Settings → Sync → Hub on this machine, on the VPS). Then paste its connection code here, which fills in everything below.
            </span>
            <Button
              size="sm"
              className="shrink-0"
              icon={<ClipboardPaste size={13} strokeWidth={1.75} />}
              onClick={() => {
                onClose()
                onPaste()
              }}
            >
              Paste code
            </Button>
          </div>
        )}
        <Field label="Name">
          <Input value={draft.name} onChange={(e) => set('name', e.target.value)} />
        </Field>
        {kind === 'rest' && (
          <>
            <Field label="Hub address" hint="The VPS's IP or DNS name, with the hub's port.">
              <Input mono value={draft.endpoint} placeholder="203.0.113.7:8000" onChange={(e) => set('endpoint', e.target.value)} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="User">
                <Input mono value={draft.user} placeholder="fsm" onChange={(e) => set('user', e.target.value)} />
              </Field>
              <Field label="Hub password">
                <SecretInput value={draft.restPassword} onChange={(e) => set('restPassword', e.target.value)} />
              </Field>
            </div>
            <Field label="Hub certificate" hint="Only a hub holding this certificate's key is trusted.">
              <Textarea className="min-h-[72px] font-mono text-[11px]" spellCheck={false} placeholder="-----BEGIN CERTIFICATE-----" value={draft.certPem} onChange={(e) => set('certPem', e.target.value)} />
            </Field>
          </>
        )}
        {(kind === 'r2' || kind === 's3') && (
          <>
            <div className="grid grid-cols-2 gap-3">
              <Field label={kind === 'r2' ? 'Account id or S3 endpoint' : 'Endpoint'} hint={kind === 'r2' ? 'R2 → Overview → Account details.' : 'Empty for AWS.'}>
                <Input mono value={draft.endpoint} placeholder={kind === 'r2' ? 'a1b2c3…' : 'https://s3.example.com'} onChange={(e) => set('endpoint', e.target.value)} />
              </Field>
              <Field label="Bucket">
                <Input mono value={draft.bucket} placeholder="fivem-sync" onChange={(e) => set('bucket', e.target.value)} />
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Folder in the bucket">
                <Input mono value={draft.prefix} onChange={(e) => set('prefix', e.target.value)} />
              </Field>
              {kind === 's3' && (
                <Field label="Region">
                  <Input mono value={draft.region} placeholder="us-east-1" onChange={(e) => set('region', e.target.value)} />
                </Field>
              )}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Access key id">
                <SecretInput value={draft.accessKeyId} onChange={(e) => set('accessKeyId', e.target.value)} />
              </Field>
              <Field label="Secret access key">
                <SecretInput value={draft.secretAccessKey} onChange={(e) => set('secretAccessKey', e.target.value)} />
              </Field>
            </div>
          </>
        )}
        {kind === 'sftp' && (
          <>
            <div className="grid grid-cols-[minmax(0,1fr)_90px] gap-3">
              <Field label="Host">
                <Input mono value={draft.host} placeholder="vps.example.com" onChange={(e) => set('host', e.target.value)} />
              </Field>
              <Field label="Port">
                <Input mono type="number" value={draft.port} onChange={(e) => set('port', Number(e.target.value) || 22)} />
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="User">
                <Input mono value={draft.user} onChange={(e) => set('user', e.target.value)} />
              </Field>
              <Field label="Folder on the host">
                <Input mono value={draft.path} placeholder="/srv/fivem-sync" onChange={(e) => set('path', e.target.value)} />
              </Field>
            </div>
            <Field label="Private key file" hint="Optional. Without one, ssh uses ssh-agent or ~/.ssh. Password logins are not supported.">
              <Input mono value={draft.keyFile} placeholder="C:\Users\you\.ssh\id_ed25519" onChange={(e) => set('keyFile', e.target.value)} />
            </Field>
          </>
        )}
        {kind === 'local' && (
          <Field label="Folder" hint="A drive, a network share (\\NAS\share) or any folder another machine can reach.">
            <div className="flex gap-1.5">
              <Input mono className="flex-1" value={draft.path} onChange={(e) => set('path', e.target.value)} />
              <Button
                icon={<FolderOpen size={14} strokeWidth={1.75} />}
                onClick={async () => {
                  const p = await api.app.pickFolder('Choose the sync folder', draft.path || undefined)
                  if (p) set('path', p)
                }}
              >
                Browse
              </Button>
            </div>
          </Field>
        )}
        <Field label="Repository password" hint="Encrypts everything on the remote. Leave empty to create a strong one. Needed to open an existing repository.">
          <SecretInput value={draft.repoPassword} placeholder="Generate one" onChange={(e) => set('repoPassword', e.target.value)} />
        </Field>
      </DialogBody>
      <DialogFooter>
        <Button variant="ghost" disabled={busy} onClick={onClose}>
          Cancel
        </Button>
        <Button variant="primary" loading={busy} onClick={() => void submit()}>
          Connect
        </Button>
      </DialogFooter>
    </Dialog>
  )
}

function PasteCodeDialog({ open, onClose, onAdded }: { open: boolean; onClose: () => void; onAdded: () => void }) {
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (open) setCode('')
  }, [open])
  return (
    <Dialog open={open} onOpenChange={(o) => !o && !busy && onClose()} width={520} dismissable={!busy}>
      <DialogHeader title="Paste a connection code" description="Copied from Settings on a machine that already uses the remote. It brings the location, keys and repository password." onClose={busy ? undefined : onClose} />
      <DialogBody>
        <Textarea autoFocus className="min-h-[110px] font-mono text-[12px] break-all" spellCheck={false} placeholder="fsmsync1.…" value={code} onChange={(e) => setCode(e.target.value)} />
      </DialogBody>
      <DialogFooter>
        <Button variant="ghost" disabled={busy} onClick={onClose}>
          Cancel
        </Button>
        <Button
          variant="primary"
          loading={busy}
          disabled={!code.trim()}
          onClick={async () => {
            setBusy(true)
            const ok = await attempt(() => api.sync.importCode(code), 'Could not connect the remote')
            setBusy(false)
            if (ok) {
              toast({ kind: 'success', title: 'Remote connected' })
              onAdded()
              onClose()
            }
          }}
        >
          Connect
        </Button>
      </DialogFooter>
    </Dialog>
  )
}

function RemoteRow({ remote, onRemoved }: { remote: SyncRemote; onRemoved: () => void }) {
  const [testing, setTesting] = useState(false)
  return (
    <div className="flex items-center justify-between gap-6 py-3">
      <div className="min-w-0">
        <div className="flex items-center gap-2 text-[13px] text-fg">
          {remote.name}
          <Badge tone="outline">{KIND_LABEL[remote.kind]}</Badge>
        </div>
        <div className="mt-0.5 truncate font-mono text-[11.5px] text-fg-subtle">{where(remote)}</div>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <Button
          size="sm"
          variant="ghost"
          loading={testing}
          onClick={async () => {
            setTesting(true)
            await attempt(async () => {
              const r = await api.sync.testRemote(remote.id)
              toast({ kind: 'success', title: `${remote.name} works`, description: `${r.servers} server${r.servers === 1 ? '' : 's'}, ${r.snapshots} snapshot${r.snapshots === 1 ? '' : 's'}` })
            }, `${remote.name} did not answer`)
            setTesting(false)
          }}
        >
          Test
        </Button>
        <Tooltip content="Copy the connection code for another machine">
          <Button
            size="sm"
            variant="ghost"
            icon={<KeyRound size={13} strokeWidth={1.75} />}
            onClick={() =>
              void attempt(async () => {
                await navigator.clipboard.writeText(await api.sync.connectionCode(remote.id))
                toast({ kind: 'info', title: 'Connection code copied', description: 'It contains the keys and password. Paste it only on your own machines.' })
              })
            }
          >
            Connection code
          </Button>
        </Tooltip>
        <Tooltip content="Remove from this machine; the data on the remote stays">
          <Button
            size="sm"
            square
            variant="ghost"
            icon={<Trash2 size={13} strokeWidth={1.75} />}
            onClick={() => void attempt(() => api.sync.removeRemote(remote.id), 'Could not remove').then((ok) => ok && onRemoved())}
          />
        </Tooltip>
      </div>
    </div>
  )
}

export function SyncSettings({ group }: { group: (title: string, children: ReactNode) => ReactNode }) {
  const settings = useApp((s) => s.settings)!
  const update = useApp((s) => s.updateSettings)
  const list = useAsync(() => api.sync.remotes(), [])
  const engine = useAsync(() => api.sync.engine(), [])
  const [machine, setMachine] = useState(settings.syncMachineName)
  const [adding, setAdding] = useState(false)
  const [pasting, setPasting] = useState(false)
  useEffect(() => setMachine(settings.syncMachineName), [settings.syncMachineName])

  return group(
    'Sync',
    <>
      <HubPanel onChanged={list.reload} />
      <SettingRow title="Machine name" description="Shown on the snapshots this machine pushes, so History says where each one came from.">
        <div className="flex items-center gap-1.5">
          <Input value={machine} onChange={(e) => setMachine(e.target.value)} className="w-[200px]" />
          <Button disabled={!machine.trim() || machine === settings.syncMachineName} onClick={() => void update({ syncMachineName: machine.trim() })}>
            Save
          </Button>
        </div>
      </SettingRow>
      <div className="py-3.5">
        <div className="flex items-center justify-between gap-6">
          <div>
            <div className="text-[13px] text-fg">Remotes</div>
            <div className="mt-0.5 text-xs leading-[18px] text-fg-subtle">
              Storage shared by your machines. Keys and passwords are encrypted with your Windows account.
              {engine.data && ` Sync engine: restic ${engine.data.version}${engine.data.installed ? '' : ', downloaded on first use'}.`}
            </div>
          </div>
          <div className="flex shrink-0 gap-1.5">
            <Button icon={<ClipboardPaste size={14} strokeWidth={1.75} />} onClick={() => setPasting(true)}>
              Paste code
            </Button>
            <Button icon={<Plus size={14} strokeWidth={2} />} onClick={() => setAdding(true)}>
              Add remote
            </Button>
          </div>
        </div>
        {!!list.data?.length && (
          <div className="mt-3 divide-y divide-line rounded-[10px] px-3.5 shadow-[inset_0_0_0_1px_var(--line)]">
            {list.data.map((r) => (
              <RemoteRow key={r.id} remote={r} onRemoved={list.reload} />
            ))}
          </div>
        )}
      </div>
      <AddRemoteDialog open={adding} onClose={() => setAdding(false)} onAdded={list.reload} onPaste={() => setPasting(true)} />
      <PasteCodeDialog open={pasting} onClose={() => setPasting(false)} onAdded={list.reload} />
    </>
  )
}
