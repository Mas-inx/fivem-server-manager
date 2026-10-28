import { Copy, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import type { Platform, ServerConfig, ServerPatch, ServerRuntime } from '@shared/types'
import { isLive } from '@/components/server-actions'
import { Button } from '@/components/ui/button'
import { Field, Input, SecretInput, Textarea } from '@/components/ui/input'
import { CopyButton } from '@/components/ui/misc'
import { Segmented } from '@/components/ui/segmented'
import { Select } from '@/components/ui/select'
import { SettingRow, Switch } from '@/components/ui/switch'
import { attempt, toast } from '@/components/ui/toast'
import { useAsync } from '@/lib/hooks'
import { api } from '@/lib/utils'
import { useApp } from '@/store/app'
import { useUi } from '@/store/ui'

function Section({ title, description, children }: { title: string; description?: ReactNode; children: ReactNode }) {
  return (
    <section className="grid grid-cols-[240px_minmax(0,1fr)] gap-10 border-t border-line py-7 first:border-0 first:pt-0">
      <div>
        <h3 className="text-[13px] font-medium text-fg">{title}</h3>
        {description && <p className="mt-1 text-xs leading-[18px] text-fg-subtle">{description}</p>}
      </div>
      <div className="flex min-w-0 flex-col gap-4">{children}</div>
    </section>
  )
}

type Draft = Required<Omit<ServerPatch, 'txAdmin'>> & { txUser: string; txPass: string }

function toDraft(s: ServerConfig): Draft {
  return {
    name: s.name,
    notes: s.notes,
    platform: s.platform,
    build: s.build,
    gamePort: s.gamePort,
    txAdminPort: s.txAdminPort,
    maxClients: s.maxClients,
    licenseKey: s.licenseKey,
    database: s.database,
    autoStart: s.autoStart,
    autoRestart: s.autoRestart,
    launchArgs: s.launchArgs,
    shared: s.shared,
    txUser: s.txAdmin?.username ?? '',
    txPass: s.txAdmin?.password ?? ''
  }
}

export function BuildSelect({ platform, value, onChange }: { platform: Platform; value: string; onChange: (v: string) => void }) {
  const catalog = useAsync(() => api.artifacts.catalog(platform), [platform])
  const installed = useAsync(() => api.artifacts.installed(), [platform])
  const options = useMemo(() => {
    const c = catalog.data
    const have = new Set((installed.data ?? []).filter((a) => a.platform === platform).map((a) => a.build))
    const builds = new Set<string>([value, ...(c?.builds.map((b) => b.build) ?? []), ...have])
    return [...builds]
      .filter(Boolean)
      .sort((a, b) => Number(b) - Number(a))
      .map((b) => ({
        value: b,
        label: b,
        hint: [b === c?.recommended && 'Recommended', b === c?.latest && 'Latest', have.has(b) && 'Downloaded']
          .filter(Boolean)
          .join(' · ')
      }))
  }, [catalog.data, installed.data, platform, value])
  return <Select mono value={value} onChange={onChange} options={options} placeholder={catalog.loading ? 'Loading builds' : 'Choose a build'} />
}

export function SettingsTab({ server, runtime }: { server: ServerConfig; runtime: ServerRuntime | undefined }) {
  const [draft, setDraft] = useState<Draft>(() => toDraft(server))
  const [saving, setSaving] = useState(false)
  const db = useApp((s) => s.db)
  const databases = useAsync(() => (db?.reachable ? api.db.list() : Promise.resolve([])), [db?.reachable])
  const connection = useAsync(() => api.servers.connectionString(server.id), [server.id, server.database])
  const setDuplicate = useUi((s) => s.setDuplicate)
  const setDelete = useUi((s) => s.setDelete)

  useEffect(() => setDraft(toDraft(server)), [server])

  const base = toDraft(server)
  const dirty = (Object.keys(draft) as (keyof Draft)[]).some((k) => draft[k] !== base[k])
  const set = <K extends keyof Draft>(key: K, value: Draft[K]): void => setDraft((d) => ({ ...d, [key]: value }))

  const save = async (): Promise<void> => {
    setSaving(true)
    const { txUser, txPass, ...rest } = draft
    const patch: ServerPatch = {
      ...rest,
      txAdmin: server.mode === 'txadmin' && txUser ? { username: txUser, password: txPass } : server.txAdmin
    }
    const ok = await attempt(() => api.servers.update(server.id, patch), 'Could not save settings')
    setSaving(false)
    if (ok && isLive(runtime)) toast({ kind: 'info', title: 'Saved', description: 'Restart the server to apply these changes.' })
  }

  const dbOptions = [
    { value: '__none', label: 'No database' },
    ...(databases.data ?? []).map((d) => ({ value: d.name, label: d.name, hint: `${d.tables} tables` }))
  ]
  if (draft.database && !dbOptions.some((o) => o.value === draft.database)) {
    dbOptions.push({ value: draft.database, label: draft.database, hint: 'Not reachable' })
  }

  return (
    <div className="relative h-full">
      <div className="h-full overflow-y-auto">
        <div className="mx-auto max-w-[920px] px-8 pt-7 pb-28">
          <Section title="General">
            <Field label="Name">
              <Input value={draft.name} onChange={(e) => set('name', e.target.value)} />
            </Field>
            <Field label="Notes" hint="Only visible here.">
              <Textarea value={draft.notes} onChange={(e) => set('notes', e.target.value)} placeholder="Anything worth remembering about this server" />
            </Field>
          </Section>

          <Section title="Server build" description="Builds are shared between servers and downloaded once. Switching takes effect on the next start.">
            <Field label="Platform">
              <Segmented<Platform>
                value={draft.platform}
                onChange={(v) => set('platform', v)}
                options={[
                  { value: 'legacy', label: 'FiveM' },
                  { value: 'enhanced', label: 'FiveM Enhanced' }
                ]}
                className="w-[280px]"
              />
            </Field>
            <Field label="Build">
              <BuildSelect platform={draft.platform} value={draft.build} onChange={(v) => set('build', v)} />
            </Field>
          </Section>

          <Section
            title="Network"
            description={server.mode === 'txadmin' ? 'txAdmin is told to bind the game server to this port.' : 'Written to server.cfg on every start.'}
          >
            <div className="grid grid-cols-2 gap-3">
              <Field label="Game port">
                <Input mono type="number" value={draft.gamePort} onChange={(e) => set('gamePort', Number(e.target.value))} />
              </Field>
              {server.mode === 'txadmin' ? (
                <Field label="txAdmin port">
                  <Input mono type="number" value={draft.txAdminPort} onChange={(e) => set('txAdminPort', Number(e.target.value))} />
                </Field>
              ) : (
                <Field label="Max players">
                  <Input mono type="number" value={draft.maxClients} onChange={(e) => set('maxClients', Number(e.target.value))} />
                </Field>
              )}
            </div>
          </Section>

          <Section
            title="License key"
            description={
              <>
                Free from{' '}
                <button className="text-fg-muted underline-offset-2 hover:underline" onClick={() => void api.app.openExternal('https://portal.cfx.re/servers/registration-keys')}>
                  portal.cfx.re
                </button>
                . Each running server needs its own key.
              </>
            }
          >
            <SecretInput value={draft.licenseKey} onChange={(e) => set('licenseKey', e.target.value)} placeholder="cfxk_…" />
          </Section>

          <Section title="Database" description="Used for mysql_connection_string and prefilled in txAdmin's recipe deployer.">
            <Field label="Database">
              <Select
                mono
                value={draft.database ?? '__none'}
                onChange={(v) => set('database', v === '__none' ? null : v)}
                options={dbOptions}
              />
            </Field>
            {connection.data && (
              <Field label="Connection string">
                <Input
                  mono
                  readOnly
                  value={connection.data}
                  className="text-fg-muted"
                  trailing={<CopyButton value={connection.data} className="mr-0.5" />}
                />
              </Field>
            )}
          </Section>

          <Section title="Behaviour">
            <div className="-my-3.5 divide-y divide-line">
              <SettingRow title="Start with the app" description="Starts this server when Server Manager opens.">
                <Switch checked={draft.autoStart} onChange={(v) => set('autoStart', v)} />
              </SettingRow>
              <SettingRow title="Restart on crash" description="Restarts after 5 seconds. Pauses if it crashes more than 4 times in 10 minutes.">
                <Switch checked={draft.autoRestart} onChange={(v) => set('autoRestart', v)} />
              </SettingRow>
              <SettingRow title="Universal admins and shared config" description="Adds the admins and config from the Admins page through server-manager.cfg.">
                <Switch checked={draft.shared} onChange={(v) => set('shared', v)} />
              </SettingRow>
            </div>
            <Field label="Extra launch arguments" hint="Appended to the FXServer command line, for example +set sv_enforceGameBuild 3258">
              <Input mono value={draft.launchArgs} onChange={(e) => set('launchArgs', e.target.value)} placeholder="+set …" />
            </Field>
          </Section>

          {server.mode === 'txadmin' && (
            <Section title="txAdmin account" description="Seeded on first start and used to sign you in automatically. Update it here if you change it inside txAdmin.">
              <div className="grid grid-cols-2 gap-3">
                <Field label="Username">
                  <Input mono value={draft.txUser} onChange={(e) => set('txUser', e.target.value)} />
                </Field>
                <Field label="Password">
                  <SecretInput value={draft.txPass} onChange={(e) => set('txPass', e.target.value)} />
                </Field>
              </div>
            </Section>
          )}

          <Section title="Manage">
            <div className="flex flex-col divide-y divide-line rounded-[10px] shadow-[inset_0_0_0_1px_var(--line)]">
              <div className="flex items-center justify-between gap-6 px-4 py-3.5">
                <div>
                  <div className="text-[13px] text-fg">Duplicate server</div>
                  <div className="mt-0.5 text-xs text-fg-subtle">Copies files, txAdmin data and optionally the database, with new ports.</div>
                </div>
                <Button
                  icon={<Copy size={13} strokeWidth={1.75} />}
                  disabled={isLive(runtime)}
                  onClick={() => setDuplicate(server.id)}
                >
                  Duplicate
                </Button>
              </div>
              <div className="flex items-center justify-between gap-6 px-4 py-3.5">
                <div>
                  <div className="text-[13px] text-fg">Delete server</div>
                  <div className="mt-0.5 text-xs text-fg-subtle">Removes it from the manager. Files can be moved to the Recycle Bin.</div>
                </div>
                <Button variant="danger" icon={<Trash2 size={13} strokeWidth={1.75} />} onClick={() => setDelete(server.id)}>
                  Delete
                </Button>
              </div>
            </div>
          </Section>
        </div>
      </div>

      {dirty && (
        <div className="pointer-events-none absolute inset-x-0 bottom-5 flex justify-center">
          <div className="pointer-events-auto flex animate-slide-up items-center gap-4 rounded-[12px] bg-overlay py-2 pr-2 pl-4 shadow-pop">
            <span className="text-[13px] text-fg-muted">You have unsaved changes</span>
            <div className="flex gap-1.5">
              <Button variant="ghost" size="sm" onClick={() => setDraft(base)}>
                Discard
              </Button>
              <Button variant="primary" size="sm" loading={saving} onClick={() => void save()}>
                Save changes
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
