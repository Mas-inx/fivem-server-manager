import { MoreHorizontal, Pencil, Plus, ShieldCheck, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { CfgEditor } from '@/components/cfg-editor'
import { Page, PageHeader, Panel } from '@/components/layout/page'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Menu, MenuItem, MenuSeparator } from '@/components/ui/menu'
import { Badge, EmptyState, Kbd, SectionTitle } from '@/components/ui/misc'
import { attempt, toast } from '@/components/ui/toast'
import { cn } from '@/lib/utils'
import { useApp } from '@/store/app'
import { useUi } from '@/store/ui'

export function AdminsPage() {
  const settings = useApp((s) => s.settings)!
  const servers = useApp((s) => s.servers)
  const updateSettings = useApp((s) => s.updateSettings)
  const editAdmin = useUi((s) => s.editAdmin)
  const [groups, setGroups] = useState(settings.adminPrincipals)
  const [shared, setShared] = useState(settings.sharedConfig)
  const [savingShared, setSavingShared] = useState(false)

  useEffect(() => setGroups(settings.adminPrincipals), [settings.adminPrincipals])
  useEffect(() => setShared(settings.sharedConfig), [settings.sharedConfig])

  const using = servers.filter((s) => s.shared).length
  const sharedDirty = shared !== settings.sharedConfig

  const saveShared = async (): Promise<void> => {
    setSavingShared(true)
    const ok = await attempt(() => updateSettings({ sharedConfig: shared }), 'Could not save shared config')
    setSavingShared(false)
    if (ok) toast({ kind: 'success', title: 'Shared config saved', description: 'Servers pick it up on their next start.' })
  }

  return (
    <Page>
      <PageHeader
        title="Admins"
        description={`People with admin rights on every server, plus config every server shares. Used by ${using} of ${servers.length} server${servers.length === 1 ? '' : 's'}.`}
        actions={
          <Button variant="primary" icon={<Plus size={15} strokeWidth={2} />} onClick={() => editAdmin({})}>
            Add admin
          </Button>
        }
      />

      <Panel className="mb-8">
        {settings.admins.length === 0 ? (
          <EmptyState
            className="py-12"
            icon={<ShieldCheck size={18} strokeWidth={1.75} />}
            title="No universal admins yet"
            description="Add someone once and they are an admin in game and in txAdmin on every server."
          >
            <Button icon={<Plus size={14} strokeWidth={1.75} />} onClick={() => editAdmin({})}>
              Add admin
            </Button>
          </EmptyState>
        ) : (
          settings.admins.map((a, i) => (
            <div key={a.id} className={cn('group flex items-center gap-4 px-4 py-3', i > 0 && 'border-t border-line')}>
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-active text-[13px] font-medium text-fg-muted uppercase">
                {a.name.slice(0, 1)}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-[13px] font-medium text-fg">{a.name}</span>
                  {a.ace && <Badge>In game</Badge>}
                  {a.panel && a.identifiers.some((id) => id.startsWith('fivem:') || id.startsWith('discord:')) && <Badge>txAdmin</Badge>}
                </div>
                <div className="mt-0.5 truncate font-mono text-[11.5px] text-fg-subtle selectable">{a.identifiers.join('  ·  ')}</div>
              </div>
              <Menu trigger={<Button variant="ghost" square size="sm" icon={<MoreHorizontal size={15} />} />}>
                <MenuItem icon={<Pencil size={13} />} onSelect={() => editAdmin(a)}>
                  Edit
                </MenuItem>
                <MenuSeparator />
                <MenuItem
                  danger
                  icon={<Trash2 size={14} />}
                  onSelect={() =>
                    void attempt(async () => {
                      await updateSettings({ admins: settings.admins.filter((x) => x.id !== a.id) })
                      toast({ kind: 'success', title: `${a.name} removed`, description: 'Running servers drop them after a restart.' })
                    })
                  }
                >
                  Remove
                </MenuItem>
              </Menu>
            </div>
          ))
        )}
      </Panel>

      <SectionTitle>Permission group</SectionTitle>
      <Panel className="mb-8 flex items-center gap-6 px-4 py-3.5">
        <div className="min-w-0 flex-1 text-xs leading-[18px] text-fg-subtle">
          Universal admins are added to these principals with <span className="font-mono text-fg-muted">add_principal</span>. Most servers
          use <span className="font-mono text-fg-muted">group.admin</span>; QBCore uses{' '}
          <span className="font-mono text-fg-muted">qbcore.god</span>. Separate several with spaces.
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <Input mono value={groups} onChange={(e) => setGroups(e.target.value)} className="w-[220px]" />
          <Button
            disabled={groups.trim() === settings.adminPrincipals || !groups.trim()}
            onClick={() => void attempt(() => updateSettings({ adminPrincipals: groups.trim() }))}
          >
            Save
          </Button>
        </div>
      </Panel>

      <SectionTitle
        action={
          <Button
            size="sm"
            variant={sharedDirty ? 'primary' : 'secondary'}
            disabled={!sharedDirty}
            loading={savingShared}
            onClick={() => void saveShared()}
            iconRight={<Kbd className={cn('ml-0.5 h-4 shadow-none', sharedDirty && 'text-inverse-fg/60')}>Ctrl S</Kbd>}
          >
            Save
          </Button>
        }
      >
        Shared config
      </SectionTitle>
      <p className="-mt-1 mb-3 text-xs leading-[18px] text-fg-subtle">
        Lines every server runs after its own server.cfg, from a managed <span className="font-mono text-fg-muted">server-manager.cfg</span>.
        Handy for a Steam Web API key, extra ace rules, tags or convars you want everywhere.
      </p>
      <Panel className="h-[280px] bg-sunken/60">
        <CfgEditor
          value={shared}
          docKey="shared-config"
          onChange={setShared}
          onSave={() => void saveShared()}
        />
      </Panel>
    </Page>
  )
}
