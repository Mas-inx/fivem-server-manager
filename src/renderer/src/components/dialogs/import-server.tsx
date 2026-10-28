import { FolderSearch } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router'
import type { ImportProbe, Platform, PortCheck } from '@shared/types'
import { BuildSelect } from '@/pages/server/settings-tab'
import { Button } from '@/components/ui/button'
import { Dialog, DialogBody, DialogFooter, DialogHeader } from '@/components/ui/dialog'
import { Field, Input } from '@/components/ui/input'
import { Segmented } from '@/components/ui/segmented'
import { SettingRow, Switch } from '@/components/ui/switch'
import { attempt, toast } from '@/components/ui/toast'
import { api } from '@/lib/utils'
import { useUi } from '@/store/ui'
import { PortStatus } from './new-server'

export function ImportServerDialog() {
  const open = useUi((s) => s.importServer)
  const close = useUi((s) => s.close)
  const navigate = useNavigate()
  const [probe, setProbe] = useState<ImportProbe | null>(null)
  const [name, setName] = useState('')
  const [platform, setPlatform] = useState<Platform>('legacy')
  const [build, setBuild] = useState('')
  const [gamePort, setGamePort] = useState(30120)
  const [txAdminPort, setTxAdminPort] = useState(40120)
  const [copy, setCopy] = useState(false)
  const [ports, setPorts] = useState<PortCheck[]>([])
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!open) return
    setProbe(null)
    setCopy(false)
    setBuild('')
    void api.servers.suggestPorts().then((p) => {
      setGamePort(p.gamePort)
      setTxAdminPort(p.txAdminPort)
    })
    void api.artifacts.catalog('legacy').then((c) => setBuild((b) => b || c.recommended || ''))
  }, [open])

  useEffect(() => {
    if (!open || !probe?.mode) return
    const t = setTimeout(() => {
      void api.servers.checkPorts(probe.mode === 'txadmin' ? [gamePort, txAdminPort] : [gamePort]).then(setPorts)
    }, 250)
    return () => clearTimeout(t)
  }, [open, probe, gamePort, txAdminPort])

  const pick = async (): Promise<void> => {
    const path = await api.app.pickFolder('Choose a server-data or txData folder')
    if (!path) return
    const p = await api.servers.probeImport(path)
    setProbe(p)
    setName(p.suggestedName)
  }

  const submit = async (): Promise<void> => {
    if (!probe) return
    setBusy(true)
    let id: string | null = null
    const ok = await attempt(async () => {
      const s = await api.servers.import({ name, path: probe.path, platform, build, gamePort, txAdminPort, copy })
      id = s.id
    }, 'Import failed')
    setBusy(false)
    if (ok && id) {
      close('importServer')
      toast({ kind: 'success', title: `${name} imported` })
      navigate(`/servers/${id}`)
    }
  }

  const invalid = !probe?.mode || !name.trim() || !build || ports.some((p) => !p.free)

  return (
    <Dialog open={open} onOpenChange={(o) => !o && !busy && close('importServer')} width={560}>
      <DialogHeader
        title="Import a server"
        description="Bring an existing server under the manager. Works with a folder that has a server.cfg, or a txData folder."
        onClose={() => close('importServer')}
      />
      <DialogBody className="flex flex-col gap-5">
        <button
          onClick={() => void pick()}
          className="flex items-center gap-3.5 rounded-[10px] px-4 py-3.5 text-left shadow-[inset_0_0_0_1px_var(--line-strong)] transition-colors hover:bg-hover"
        >
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[9px] bg-raised text-fg-muted shadow-[inset_0_0_0_1px_var(--line)]">
            <FolderSearch size={16} strokeWidth={1.75} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13px] text-fg">{probe ? probe.path : 'Choose folder'}</span>
            <span className="block text-xs text-fg-subtle">
              {!probe
                ? 'server-data, a folder containing it, or txData'
                : probe.mode === 'txadmin'
                  ? 'txAdmin data found'
                  : probe.mode === 'standalone'
                    ? 'server.cfg found'
                    : 'Nothing importable here'}
            </span>
          </span>
          <span className="text-xs text-fg-subtle">{probe ? 'Change' : 'Browse'}</span>
        </button>

        {probe?.mode && (
          <>
            <Field label="Name">
              <Input value={name} onChange={(e) => setName(e.target.value)} />
            </Field>
            <div className="grid grid-cols-[auto_1fr] gap-3">
              <Field label="Platform">
                <Segmented<Platform>
                  value={platform}
                  onChange={(p) => {
                    setPlatform(p)
                    setBuild('')
                  }}
                  options={[
                    { value: 'legacy', label: 'FiveM' },
                    { value: 'enhanced', label: 'Enhanced' }
                  ]}
                />
              </Field>
              <Field label="Build">
                <BuildSelect platform={platform} value={build} onChange={setBuild} />
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Game port" aside={<PortStatus check={ports.find((p) => p.port === gamePort)} />}>
                <Input mono type="number" value={gamePort} onChange={(e) => setGamePort(Number(e.target.value))} />
              </Field>
              {probe.mode === 'txadmin' && (
                <Field label="txAdmin port" aside={<PortStatus check={ports.find((p) => p.port === txAdminPort)} />}>
                  <Input mono type="number" value={txAdminPort} onChange={(e) => setTxAdminPort(Number(e.target.value))} />
                </Field>
              )}
            </div>
            <div className="rounded-[10px] px-4 shadow-[inset_0_0_0_1px_var(--line)]">
              <SettingRow title="Copy into the library" description="Leave off to run the server from where it is now.">
                <Switch checked={copy} onChange={setCopy} />
              </SettingRow>
            </div>
          </>
        )}
      </DialogBody>
      <DialogFooter>
        <Button variant="ghost" onClick={() => close('importServer')}>
          Cancel
        </Button>
        <Button variant="primary" disabled={invalid} loading={busy} onClick={() => void submit()}>
          Import
        </Button>
      </DialogFooter>
    </Dialog>
  )
}
