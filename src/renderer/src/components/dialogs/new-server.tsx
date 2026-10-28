import { Check, LayoutPanelLeft, Terminal } from 'lucide-react'
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router'
import type { CreateServerInput, DatabaseChoice, Platform, PortCheck, ServerMode } from '@shared/types'
import { BuildSelect } from '@/pages/server/settings-tab'
import { Button } from '@/components/ui/button'
import { Dialog, DialogHeader } from '@/components/ui/dialog'
import { Field, Input, SecretInput } from '@/components/ui/input'
import { Badge, Progress, Spinner } from '@/components/ui/misc'
import { ChoiceCards } from '@/components/ui/segmented'
import { Select } from '@/components/ui/select'
import { SettingRow, Switch } from '@/components/ui/switch'
import { toast } from '@/components/ui/toast'
import { useAsync } from '@/lib/hooks'
import { api, cn } from '@/lib/utils'
import { useApp } from '@/store/app'
import { useUi } from '@/store/ui'

const STEPS = ['Server', 'Build', 'Network', 'Database', 'Review'] as const

export function toDbName(name: string): string {
  const s = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40)
  return !s ? 'fivem' : /^[0-9]/.test(s) ? `fx_${s}` : s
}

export function PortStatus({ check }: { check: PortCheck | undefined }) {
  if (!check) return null
  return check.free ? (
    <span className="flex items-center gap-1.5 text-xs text-fg-subtle">
      <span className="h-1.5 w-1.5 rounded-full bg-ok" /> Available
    </span>
  ) : (
    <span className="flex items-center gap-1.5 text-xs text-err">
      <span className="h-1.5 w-1.5 rounded-full bg-err" /> {check.usedBy ? `Used by ${check.usedBy}` : 'In use'}
    </span>
  )
}

function ReviewRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 py-2.5">
      <span className="text-[13px] text-fg-subtle">{label}</span>
      <span className="min-w-0 truncate text-right text-[13px] text-fg">{children}</span>
    </div>
  )
}

type BuildChoice = 'recommended' | 'latest' | 'specific'

export function NewServerDialog() {
  const open = useUi((s) => s.newServer)
  const close = useUi((s) => s.close)
  const settings = useApp((s) => s.settings)
  const db = useApp((s) => s.db)
  const tasks = useApp((s) => s.tasks)
  const navigate = useNavigate()

  const [step, setStep] = useState(0)
  const [name, setName] = useState('')
  const [mode, setMode] = useState<ServerMode>('txadmin')
  const [platform, setPlatform] = useState<Platform>('legacy')
  const [buildChoice, setBuildChoice] = useState<BuildChoice>('recommended')
  const [specific, setSpecific] = useState('')
  const [gamePort, setGamePort] = useState(30120)
  const [txAdminPort, setTxAdminPort] = useState(40120)
  const [maxClients, setMaxClients] = useState(48)
  const [licenseKey, setLicenseKey] = useState('')
  const [dbKind, setDbKind] = useState<DatabaseChoice['kind']>('create')
  const [dbNew, setDbNew] = useState('')
  const [dbExisting, setDbExisting] = useState('')
  const [dbTouched, setDbTouched] = useState(false)
  const [autoRestart, setAutoRestart] = useState(true)
  const [ports, setPorts] = useState<PortCheck[]>([])
  const [creating, setCreating] = useState(false)
  const [startedAt, setStartedAt] = useState(0)

  const catalog = useAsync(() => (open ? api.artifacts.catalog(platform) : Promise.resolve(null)), [open, platform])
  const installed = useAsync(() => (open ? api.artifacts.installed() : Promise.resolve([])), [open])
  const dbReady = !!db && (db.mode === 'external' ? db.reachable : db.installed && db.running)
  const databases = useAsync(() => (open && db?.reachable ? api.db.list() : Promise.resolve([])), [open, db?.reachable])

  useEffect(() => {
    if (!open) return
    setStep(0)
    setName('')
    setMode('txadmin')
    setPlatform('legacy')
    setBuildChoice('recommended')
    setSpecific('')
    setLicenseKey(settings?.defaultLicenseKey ?? '')
    setDbTouched(false)
    setDbKind(dbReady ? 'create' : 'none')
    setCreating(false)
    void api.servers.suggestPorts().then((p) => {
      setGamePort(p.gamePort)
      setTxAdminPort(p.txAdminPort)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  useEffect(() => {
    if (!dbTouched) setDbNew(toDbName(name))
  }, [name, dbTouched])

  useEffect(() => {
    if (!dbReady && dbKind !== 'none') setDbKind('none')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dbReady])

  useEffect(() => {
    if (!open || step !== 2) return
    const t = setTimeout(() => {
      void api.servers.checkPorts(mode === 'txadmin' ? [gamePort, txAdminPort] : [gamePort]).then(setPorts)
    }, 250)
    return () => clearTimeout(t)
  }, [open, step, gamePort, txAdminPort, mode])

  const c = catalog.data
  const build = buildChoice === 'recommended' ? (c?.recommended ?? '') : buildChoice === 'latest' ? (c?.latest ?? '') : specific
  const database: DatabaseChoice =
    dbKind === 'create' ? { kind: 'create', name: dbNew } : dbKind === 'existing' ? { kind: 'existing', name: dbExisting } : { kind: 'none' }

  const stepError = useMemo((): string | null => {
    if (step === 0 && !name.trim()) return 'Give the server a name'
    if (step === 1 && !build) return 'Choose a build'
    if (step === 2) {
      if (mode === 'txadmin' && gamePort === txAdminPort) return 'Ports must differ'
      if (ports.some((p) => !p.free)) return 'Pick a free port'
    }
    if (step === 3) {
      if (dbKind === 'create' && !/^[A-Za-z0-9_]{1,64}$/.test(dbNew)) return 'Use letters, numbers and underscores'
      if (dbKind === 'existing' && !dbExisting) return 'Choose a database'
    }
    return null
  }, [step, name, build, mode, gamePort, txAdminPort, ports, dbKind, dbNew, dbExisting])

  const create = async (): Promise<void> => {
    setCreating(true)
    setStartedAt(Date.now())
    const input: CreateServerInput = {
      name: name.trim(),
      platform,
      build,
      mode,
      gamePort,
      txAdminPort,
      maxClients,
      licenseKey,
      database,
      autoStart: false,
      autoRestart
    }
    try {
      const server = await api.servers.create(input)
      close('newServer')
      toast({ kind: 'success', title: `${server.name} is ready`, description: mode === 'txadmin' ? 'Start it to finish setup in txAdmin.' : undefined })
      navigate(`/servers/${server.id}`)
    } catch (err) {
      setCreating(false)
      toast({ kind: 'error', title: 'Could not create the server', description: err instanceof Error ? err.message : String(err) })
    }
  }

  const activeTasks = tasks.filter((t) => t.startedAt >= startedAt - 1000)

  return (
    <Dialog open={open} onOpenChange={(o) => !o && !creating && close('newServer')} width={780} dismissable={!creating}>
      <div className="flex h-[560px]">
        <div className="flex w-[200px] shrink-0 flex-col border-r border-line bg-sunken/60 px-3 py-5">
          <div className="px-2 pb-4 text-[13px] font-semibold text-fg">New server</div>
          {STEPS.map((s, i) => (
            <button
              key={s}
              disabled={creating || i > step}
              onClick={() => setStep(i)}
              className={cn(
                'flex h-8 items-center gap-2.5 rounded-[7px] px-2 text-left text-[13px] transition-colors',
                i === step ? 'bg-active text-fg' : i < step ? 'text-fg-muted hover:bg-hover' : 'text-fg-faint'
              )}
            >
              <span
                className={cn(
                  'flex h-[18px] w-[18px] items-center justify-center rounded-full text-[10.5px] font-medium',
                  i < step ? 'bg-inverse text-inverse-fg' : i === step ? 'shadow-[inset_0_0_0_1.5px_var(--fg)] text-fg' : 'shadow-[inset_0_0_0_1.5px_var(--fg-faint)]'
                )}
              >
                {i < step ? <Check size={11} strokeWidth={3} /> : i + 1}
              </span>
              {s}
            </button>
          ))}
        </div>

        <div className="flex min-w-0 flex-1 flex-col">
          {creating ? (
            <div className="flex flex-1 flex-col items-center justify-center px-12">
              <Spinner size={18} className="text-fg-muted" />
              <div className="mt-4 text-[14px] font-medium text-fg">Setting up {name}</div>
              <div className="mt-1 text-[13px] text-fg-subtle">You can close the app window; work continues in the background.</div>
              <div className="mt-8 w-full max-w-[380px] space-y-4">
                {activeTasks.map((t) => (
                  <div key={t.id}>
                    <div className="mb-1.5 flex justify-between text-xs">
                      <span className="text-fg-muted">{t.title}</span>
                      <span className="text-fg-subtle tabular">{t.state === 'done' ? 'Done' : (t.detail ?? '')}</span>
                    </div>
                    <Progress value={t.state === 'done' ? 1 : t.progress} />
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <>
              <DialogHeader
                title={
                  [
                    'What are you setting up?',
                    'Choose a server build',
                    'Network and license',
                    'Database',
                    'Ready to create'
                  ][step]
                }
                description={
                  [
                    'You can change everything later in the server settings.',
                    'Builds are downloaded once and shared by every server that uses them.',
                    'Ports are picked automatically so servers on this PC never collide.',
                    'Each server can have its own database on the same database server.',
                    'The manager downloads the build if needed and prepares the folder.'
                  ][step]
                }
                onClose={() => close('newServer')}
              />
              <div className="min-h-0 flex-1 overflow-y-auto px-5 pt-4 pb-5">
                {step === 0 && (
                  <div className="flex flex-col gap-5">
                    <Field label="Server name">
                      <Input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="My Roleplay Server" onKeyDown={(e) => e.key === 'Enter' && !stepError && setStep(1)} />
                    </Field>
                    <Field label="Management">
                      <ChoiceCards<ServerMode>
                        value={mode}
                        onChange={setMode}
                        options={[
                          {
                            value: 'txadmin',
                            title: 'txAdmin',
                            icon: <LayoutPanelLeft size={15} strokeWidth={1.75} />,
                            badge: <Badge>Recommended</Badge>,
                            description: 'Web panel with recipes for QBCore, ESX and more, player management and scheduled restarts.'
                          },
                          {
                            value: 'standalone',
                            title: 'Standalone',
                            icon: <Terminal size={15} strokeWidth={1.75} />,
                            description: 'Plain FXServer with the default resources and a server.cfg you control directly.'
                          }
                        ]}
                      />
                    </Field>
                    <Field label="Platform">
                      <ChoiceCards<Platform>
                        value={platform}
                        onChange={setPlatform}
                        options={[
                          { value: 'legacy', title: 'FiveM', description: 'The classic platform for GTA V Legacy. Works with every existing resource.' },
                          {
                            value: 'enhanced',
                            title: 'FiveM Enhanced',
                            badge: <Badge tone="outline">Early access</Badge>,
                            description: 'For GTA V Enhanced. Some resources and assets need converting first.'
                          }
                        ]}
                      />
                    </Field>
                  </div>
                )}

                {step === 1 && (
                  <div className="flex flex-col gap-4">
                    {catalog.loading && !c ? (
                      <div className="flex items-center gap-2 py-6 text-[13px] text-fg-subtle">
                        <Spinner /> Loading builds from Cfx.re
                      </div>
                    ) : catalog.error ? (
                      <div className="text-[13px] text-err">{catalog.error}</div>
                    ) : (
                      <ChoiceCards<BuildChoice>
                        columns={platform === 'enhanced' ? 2 : 3}
                        value={buildChoice}
                        onChange={setBuildChoice}
                        options={[
                          {
                            value: 'recommended',
                            title: 'Recommended',
                            description: <span className="font-mono">{c?.recommended ?? '–'}</span>
                          },
                          ...(platform === 'legacy'
                            ? [{ value: 'latest' as const, title: 'Latest', description: <span className="font-mono">{c?.latest ?? '–'}</span> }]
                            : []),
                          { value: 'specific', title: 'Specific', description: 'Pick an exact build' }
                        ]}
                      />
                    )}
                    {buildChoice === 'specific' && (
                      <Field label="Build">
                        <BuildSelect platform={platform} value={specific} onChange={setSpecific} />
                      </Field>
                    )}
                    {build && (
                      <div className="flex items-center gap-3 rounded-[10px] px-4 py-3 text-[13px] shadow-[inset_0_0_0_1px_var(--line)]">
                        <span className="font-mono text-xs text-fg">{build}</span>
                        <span className="text-fg-faint">·</span>
                        <span className="text-fg-subtle">
                          {installed.data?.some((a) => a.platform === platform && a.build === build)
                            ? 'Already on this PC, nothing to download'
                            : 'Downloaded from Cfx.re when you create the server'}
                        </span>
                        {c?.builds.find((b) => b.build === build)?.txAdmin && (
                          <span className="ml-auto text-xs text-fg-subtle">txAdmin {c.builds.find((b) => b.build === build)!.txAdmin}</span>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {step === 2 && (
                  <div className="flex flex-col gap-5">
                    <div className="grid grid-cols-2 gap-3">
                      <Field label="Game port" aside={<PortStatus check={ports.find((p) => p.port === gamePort)} />}>
                        <Input mono type="number" value={gamePort} onChange={(e) => setGamePort(Number(e.target.value))} />
                      </Field>
                      {mode === 'txadmin' ? (
                        <Field label="txAdmin port" aside={<PortStatus check={ports.find((p) => p.port === txAdminPort)} />}>
                          <Input mono type="number" value={txAdminPort} onChange={(e) => setTxAdminPort(Number(e.target.value))} />
                        </Field>
                      ) : (
                        <Field label="Max players">
                          <Input mono type="number" value={maxClients} onChange={(e) => setMaxClients(Number(e.target.value))} />
                        </Field>
                      )}
                    </div>
                    <Field
                      label="License key"
                      hint={
                        <>
                          Get one for free at{' '}
                          <button className="text-fg-muted hover:underline" onClick={() => void api.app.openExternal('https://portal.cfx.re/servers/registration-keys')}>
                            portal.cfx.re
                          </button>
                          . Optional now, required before players can join.
                        </>
                      }
                    >
                      <SecretInput value={licenseKey} onChange={(e) => setLicenseKey(e.target.value)} placeholder="cfxk_…" />
                    </Field>
                    <div className="rounded-[10px] px-4 shadow-[inset_0_0_0_1px_var(--line)]">
                      <SettingRow title="Restart on crash" description="Bring the server back automatically if it exits unexpectedly.">
                        <Switch checked={autoRestart} onChange={setAutoRestart} />
                      </SettingRow>
                    </div>
                  </div>
                )}

                {step === 3 && (
                  <div className="flex flex-col gap-4">
                    {!dbReady && (
                      <div className="flex items-center gap-4 rounded-[10px] px-4 py-3.5 shadow-[inset_0_0_0_1px_var(--line-strong)]">
                        <div className="min-w-0 flex-1">
                          <div className="text-[13px] text-fg">No database server is available</div>
                          <div className="mt-0.5 text-xs text-fg-subtle">
                            {db?.mode === 'managed' && db.installed
                              ? 'MariaDB is installed but not running.'
                              : 'Install a private MariaDB for this PC, or continue without a database.'}
                          </div>
                        </div>
                        <Button
                          size="sm"
                          loading={!!db?.starting}
                          onClick={() =>
                            void (db?.mode === 'managed' && db.installed ? api.db.start() : api.db.install()).catch((e: Error) =>
                              toast({ kind: 'error', title: 'Database', description: e.message })
                            )
                          }
                        >
                          {db?.mode === 'managed' && db.installed ? 'Start MariaDB' : 'Install MariaDB'}
                        </Button>
                      </div>
                    )}
                    <ChoiceCards<DatabaseChoice['kind']>
                      columns={3}
                      value={dbKind}
                      onChange={setDbKind}
                      options={[
                        { value: 'create', title: 'New database', description: 'An empty database just for this server.', disabled: !dbReady },
                        { value: 'existing', title: 'Existing', description: 'Share or reuse a database already there.', disabled: !dbReady || !databases.data?.length },
                        { value: 'none', title: 'None', description: 'Set it up later from the server settings.' }
                      ]}
                    />
                    {dbKind === 'create' && (
                      <Field label="Database name" hint="Letters, numbers and underscores.">
                        <Input
                          mono
                          value={dbNew}
                          onChange={(e) => {
                            setDbTouched(true)
                            setDbNew(e.target.value)
                          }}
                        />
                      </Field>
                    )}
                    {dbKind === 'existing' && (
                      <Field label="Database">
                        <Select
                          mono
                          value={dbExisting || undefined}
                          onChange={setDbExisting}
                          placeholder="Choose a database"
                          options={(databases.data ?? []).map((d) => ({ value: d.name, label: d.name, hint: `${d.tables} tables` }))}
                        />
                      </Field>
                    )}
                  </div>
                )}

                {step === 4 && (
                  <div className="divide-y divide-line rounded-[10px] px-4 shadow-[inset_0_0_0_1px_var(--line)]">
                    <ReviewRow label="Name">{name}</ReviewRow>
                    <ReviewRow label="Management">{mode === 'txadmin' ? 'txAdmin' : 'Standalone'}</ReviewRow>
                    <ReviewRow label="Platform">{platform === 'enhanced' ? 'FiveM Enhanced' : 'FiveM'}</ReviewRow>
                    <ReviewRow label="Build">
                      <span className="font-mono text-xs">{build}</span>
                    </ReviewRow>
                    <ReviewRow label="Ports">
                      <span className="font-mono text-xs">
                        {gamePort}
                        {mode === 'txadmin' && ` · ${txAdminPort}`}
                      </span>
                    </ReviewRow>
                    <ReviewRow label="Database">
                      {database.kind === 'none' ? <span className="text-fg-subtle">None</span> : <span className="font-mono text-xs">{database.name}</span>}
                    </ReviewRow>
                    <ReviewRow label="License key">{licenseKey ? 'Set' : <span className="text-fg-subtle">Not set</span>}</ReviewRow>
                  </div>
                )}
              </div>

              <div className="flex items-center justify-between border-t border-line px-5 py-3">
                <span className="text-xs text-err">{stepError && step > 0 ? stepError : ''}</span>
                <div className="flex gap-2">
                  {step > 0 && (
                    <Button variant="ghost" onClick={() => setStep(step - 1)}>
                      Back
                    </Button>
                  )}
                  {step < STEPS.length - 1 ? (
                    <Button variant="primary" disabled={!!stepError} onClick={() => setStep(step + 1)}>
                      Continue
                    </Button>
                  ) : (
                    <Button variant="primary" onClick={() => void create()}>
                      Create server
                    </Button>
                  )}
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </Dialog>
  )
}
