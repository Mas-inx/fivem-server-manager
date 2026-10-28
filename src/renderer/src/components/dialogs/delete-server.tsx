import { useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router'
import { Button } from '@/components/ui/button'
import { Dialog, DialogBody, DialogFooter, DialogHeader } from '@/components/ui/dialog'
import { SettingRow, Switch } from '@/components/ui/switch'
import { attempt, toast } from '@/components/ui/toast'
import { api, shortPath } from '@/lib/utils'
import { useServer } from '@/store/app'
import { useUi } from '@/store/ui'

export function DeleteServerDialog() {
  const id = useUi((s) => s.deleteId)
  const setId = useUi((s) => s.setDelete)
  const server = useServer(id ?? undefined)
  const navigate = useNavigate()
  const location = useLocation()
  const [deleteFiles, setDeleteFiles] = useState(true)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    setDeleteFiles(true)
    setBusy(false)
  }, [id])

  const submit = async (): Promise<void> => {
    if (!server) return
    setBusy(true)
    const name = server.name
    const ok = await attempt(() => api.servers.remove(server.id, deleteFiles), 'Could not delete')
    setBusy(false)
    if (ok) {
      setId(null)
      if (location.pathname.startsWith(`/servers/${server.id}`)) navigate('/')
      toast({ kind: 'success', title: `${name} deleted`, description: deleteFiles ? 'Its folder is in the Recycle Bin.' : undefined })
    }
  }

  return (
    <Dialog open={!!server} onOpenChange={(o) => !o && !busy && setId(null)} width={460}>
      <DialogHeader title={`Delete ${server?.name ?? ''}?`} description="The server is stopped and removed from the manager." />
      <DialogBody>
        <div className="rounded-[10px] px-4 shadow-[inset_0_0_0_1px_var(--line)]">
          <SettingRow
            title="Move its folder to the Recycle Bin"
            description={server ? <span className="font-mono">{shortPath(server.root)}</span> : null}
          >
            <Switch checked={deleteFiles} onChange={setDeleteFiles} />
          </SettingRow>
        </div>
        {server?.database && (
          <p className="mt-3 text-xs leading-[18px] text-fg-subtle">
            The database <span className="font-mono text-fg-muted">{server.database}</span> is kept. Drop it from the Database page if you no longer need it.
          </p>
        )}
      </DialogBody>
      <DialogFooter>
        <Button variant="ghost" onClick={() => setId(null)}>
          Cancel
        </Button>
        <Button variant="danger-solid" loading={busy} onClick={() => void submit()}>
          Delete server
        </Button>
      </DialogFooter>
    </Dialog>
  )
}
