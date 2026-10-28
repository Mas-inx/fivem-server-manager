import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router'
import type { DuplicateServerInput } from '@shared/types'
import { Button } from '@/components/ui/button'
import { Dialog, DialogBody, DialogFooter, DialogHeader } from '@/components/ui/dialog'
import { Field, Input } from '@/components/ui/input'
import { Progress } from '@/components/ui/misc'
import { ChoiceCards } from '@/components/ui/segmented'
import { attempt, toast } from '@/components/ui/toast'
import { api } from '@/lib/utils'
import { useApp, useServer } from '@/store/app'
import { useUi } from '@/store/ui'

type DbOption = DuplicateServerInput['database']

export function DuplicateServerDialog() {
  const id = useUi((s) => s.duplicateId)
  const setId = useUi((s) => s.setDuplicate)
  const server = useServer(id ?? undefined)
  const db = useApp((s) => s.db)
  const tasks = useApp((s) => s.tasks)
  const navigate = useNavigate()
  const [name, setName] = useState('')
  const [dbOption, setDbOption] = useState<DbOption>('clone')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!server) return
    setName(`${server.name} copy`)
    setDbOption(server.database ? 'clone' : 'none')
    setBusy(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  const task = tasks.find((t) => t.state === 'running' && server && t.title === `Duplicating ${server.name}`)

  const submit = async (): Promise<void> => {
    if (!server) return
    setBusy(true)
    let newId: string | null = null
    const ok = await attempt(async () => {
      const s = await api.servers.duplicate({ sourceId: server.id, name, database: dbOption })
      newId = s.id
    }, 'Could not duplicate')
    setBusy(false)
    if (ok && newId) {
      setId(null)
      toast({ kind: 'success', title: `${name} created`, description: 'New ports were assigned automatically.' })
      navigate(`/servers/${newId}`)
    }
  }

  const dbUsable = !!db?.reachable
  return (
    <Dialog open={!!server} onOpenChange={(o) => !o && !busy && setId(null)} width={540} dismissable={!busy}>
      <DialogHeader
        title={`Duplicate ${server?.name ?? ''}`}
        description="Copies resources, config and txAdmin data. Caches and logs are left behind, and new ports are assigned."
        onClose={busy ? undefined : () => setId(null)}
      />
      <DialogBody className="flex flex-col gap-5">
        <Field label="Name">
          <Input autoFocus value={name} disabled={busy} onChange={(e) => setName(e.target.value)} />
        </Field>
        {server?.database && (
          <Field label={`Database (${server.database})`}>
            <ChoiceCards<DbOption>
              value={dbOption}
              onChange={setDbOption}
              options={[
                { value: 'clone', title: 'Clone', description: 'Copy every table and row into a new database.', disabled: !dbUsable || busy },
                { value: 'empty', title: 'New empty', description: 'Start with a blank database.', disabled: !dbUsable || busy },
                { value: 'share', title: 'Share', description: 'Both servers use the same database.', disabled: busy },
                { value: 'none', title: 'None', description: 'No database for the copy.', disabled: busy }
              ]}
            />
          </Field>
        )}
        {busy && task && (
          <div>
            <div className="mb-1.5 flex justify-between text-xs text-fg-subtle">
              <span>{task.detail ?? 'Working'}</span>
              {task.progress !== null && <span className="tabular">{Math.round(task.progress * 100)}%</span>}
            </div>
            <Progress value={task.progress} />
          </div>
        )}
      </DialogBody>
      <DialogFooter>
        <Button variant="ghost" disabled={busy} onClick={() => setId(null)}>
          Cancel
        </Button>
        <Button variant="primary" disabled={!name.trim()} loading={busy} onClick={() => void submit()}>
          Duplicate
        </Button>
      </DialogFooter>
    </Dialog>
  )
}
