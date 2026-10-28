import { useEffect, useMemo, useState } from 'react'
import { IDENTIFIER_PATTERN, TXADMIN_NAME_PATTERN, type PlayerInfo, type UniversalAdmin } from '@shared/types'
import { isLive } from '@/components/server-actions'
import { Button } from '@/components/ui/button'
import { Dialog, DialogBody, DialogFooter, DialogHeader } from '@/components/ui/dialog'
import { Field, Input, Textarea } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { SettingRow, Switch } from '@/components/ui/switch'
import { attempt, toast } from '@/components/ui/toast'
import { api } from '@/lib/utils'
import { useApp } from '@/store/app'
import { useUi } from '@/store/ui'

interface OnlinePlayer extends PlayerInfo {
  server: string
}

const toUsername = (name: string): string =>
  name
    .replace(/[^A-Za-z0-9._-]/g, '')
    .replace(/^[._-]+|[._-]+$/g, '')
    .slice(0, 20)

/** Keeps the identifiers admins are matched by; ip: and session-specific ones are dropped. */
export const usefulIdentifiers = (ids: string[]): string[] => ids.filter((i) => IDENTIFIER_PATTERN.test(i))

export function AdminDialog() {
  const draft = useUi((s) => s.adminDraft)
  const close = useUi((s) => s.editAdmin)
  const settings = useApp((s) => s.settings)
  const updateSettings = useApp((s) => s.updateSettings)
  const servers = useApp((s) => s.servers)
  const runtime = useApp((s) => s.runtime)
  const [name, setName] = useState('')
  const [ids, setIds] = useState('')
  const [ace, setAce] = useState(true)
  const [panel, setPanel] = useState(true)
  const [online, setOnline] = useState<OnlinePlayer[]>([])
  const [saving, setSaving] = useState(false)
  const editing = !!draft?.id

  useEffect(() => {
    if (!draft) return
    setName(draft.name ?? '')
    setIds((draft.identifiers ?? []).join('\n'))
    setAce(draft.ace ?? true)
    setPanel(draft.panel ?? true)
    // Offer the people playing right now, so nobody has to dig for identifiers.
    const live = servers.filter((s) => isLive(runtime[s.id]) && runtime[s.id]?.gameOnline)
    void Promise.all(live.map((s) => api.servers.players(s.id).then((list) => list.map((p) => ({ ...p, server: s.name }))).catch(() => [])))
      .then((all) => setOnline(all.flat()))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft])

  const lines = ids.split(/[\s,]+/).map((l) => l.trim()).filter(Boolean)
  const invalid = lines.filter((l) => !IDENTIFIER_PATTERN.test(l))
  const canPanel = lines.some((l) => l.startsWith('fivem:') || l.startsWith('discord:'))
  const nameError = !name.trim()
    ? null
    : panel && !TXADMIN_NAME_PATTERN.test(name.trim())
      ? 'For txAdmin, use 3 to 20 letters, numbers, dots, dashes or underscores'
      : settings?.admins.some((a) => a.id !== draft?.id && a.name.toLowerCase() === name.trim().toLowerCase())
        ? 'Someone with this name is already an admin'
        : null

  const playerOptions = useMemo(
    () =>
      online.map((p, i) => ({
        value: String(i),
        label: p.name,
        hint: p.server
      })),
    [online]
  )

  const save = async (): Promise<void> => {
    if (!settings) return
    setSaving(true)
    const admin: UniversalAdmin = {
      id: draft?.id ?? crypto.randomUUID(),
      name: name.trim(),
      identifiers: [...new Set(lines)],
      ace,
      panel: panel && canPanel
    }
    const admins = editing ? settings.admins.map((a) => (a.id === admin.id ? admin : a)) : [...settings.admins, admin]
    const ok = await attempt(() => updateSettings({ admins }), 'Could not save the admin')
    setSaving(false)
    if (ok) {
      close(null)
      toast({
        kind: 'success',
        title: editing ? `${admin.name} updated` : `${admin.name} is now an admin`,
        description: 'Running servers pick up removals and txAdmin accounts after a restart.'
      })
    }
  }

  return (
    <Dialog open={!!draft} onOpenChange={(o) => !o && close(null)} width={520}>
      <DialogHeader
        title={editing ? `Edit ${draft?.name}` : 'Add an admin'}
        description="They become an admin on every server that uses the shared settings."
        onClose={() => close(null)}
      />
      <DialogBody className="flex flex-col gap-5">
        {!editing && playerOptions.length > 0 && (
          <Field label="Pick someone who is online" hint="Fills in their name and identifiers.">
            <Select
              value={undefined}
              placeholder="Choose a player"
              options={playerOptions}
              onChange={(v) => {
                const p = online[Number(v)]
                if (!p) return
                setName(toUsername(p.name) || p.name)
                setIds(usefulIdentifiers(p.identifiers).join('\n'))
              }}
            />
          </Field>
        )}
        <Field label="Name" error={nameError}>
          <Input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Franklin" />
        </Field>
        <Field
          label="Identifiers"
          error={invalid.length ? `Not recognised: ${invalid.join(', ')}` : null}
          hint="One per line. fivem: lets them sign in to txAdmin with Cfx.re; license:, discord: and steam: work in game."
        >
          <Textarea
            value={ids}
            onChange={(e) => setIds(e.target.value)}
            spellCheck={false}
            className="min-h-[96px] font-mono text-[12.5px]"
            placeholder={'fivem:1234567\nlicense:0123456789abcdef0123456789abcdef01234567\ndiscord:123456789012345678'}
          />
        </Field>
        <div className="divide-y divide-line rounded-[10px] px-4 shadow-[inset_0_0_0_1px_var(--line)]">
          <SettingRow title="In-game admin" description={`Added to ${settings?.adminPrincipals || 'group.admin'} on every server.`}>
            <Switch checked={ace} onChange={setAce} />
          </SettingRow>
          <SettingRow
            title="txAdmin panel access"
            description={canPanel ? 'A txAdmin account with all permissions on txAdmin servers.' : 'Needs a fivem: or discord: identifier.'}
          >
            <Switch checked={panel && canPanel} disabled={!canPanel} onChange={setPanel} />
          </SettingRow>
        </div>
      </DialogBody>
      <DialogFooter>
        <Button variant="ghost" onClick={() => close(null)}>
          Cancel
        </Button>
        <Button
          variant="primary"
          loading={saving}
          disabled={!name.trim() || !lines.length || invalid.length > 0 || !!nameError || (!ace && !(panel && canPanel))}
          onClick={() => void save()}
        >
          {editing ? 'Save' : 'Add admin'}
        </Button>
      </DialogFooter>
    </Dialog>
  )
}
