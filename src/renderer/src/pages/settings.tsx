import { FolderOpen, Monitor, Moon, Sun } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import type { ThemePreference } from '@shared/types'
import { Page, PageHeader } from '@/components/layout/page'
import { Button } from '@/components/ui/button'
import { Input, SecretInput } from '@/components/ui/input'
import { Segmented } from '@/components/ui/segmented'
import { SettingRow, Switch } from '@/components/ui/switch'
import { attempt, toast } from '@/components/ui/toast'
import { installUpdate, RELEASES_URL } from '@/components/update-pill'
import { useAsync } from '@/lib/hooks'
import { api, relativeTime } from '@/lib/utils'
import { useApp } from '@/store/app'

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mb-9">
      <h2 className="mb-1 text-[13px] font-medium text-fg">{title}</h2>
      <div className="divide-y divide-line border-y border-line">{children}</div>
    </section>
  )
}

function UpdatesRow() {
  const update = useApp((s) => s.update)
  const [checking, setChecking] = useState(false)
  const status = update?.status ?? 'idle'
  const description = {
    idle: 'Updates are checked every few hours.',
    unsupported: 'Development builds do not update themselves. Installed copies do.',
    checking: 'Checking GitHub for a new version.',
    'up-to-date': `You are on the latest version${update?.checkedAt ? `, checked ${relativeTime(update.checkedAt).toLowerCase()}` : ''}.`,
    downloading: `Downloading ${update?.version ?? 'the update'}${update?.progress !== undefined ? ` · ${Math.round(update.progress * 100)}%` : ''}.`,
    ready: `Version ${update?.version} is downloaded and installs on restart.`,
    error: update?.error ?? 'The last check failed.'
  }[status]
  return (
    <SettingRow title="Updates" description={<span className={status === 'error' ? 'text-err' : undefined}>{description}</span>}>
      {status === 'ready' ? (
        <Button variant="primary" onClick={() => void installUpdate()}>
          Restart and update
        </Button>
      ) : (
        <Button
          loading={checking || status === 'checking' || status === 'downloading'}
          disabled={status === 'unsupported'}
          onClick={async () => {
            setChecking(true)
            const next = await api.updates.check()
            setChecking(false)
            if (next.status === 'up-to-date') toast({ kind: 'success', title: `${next.current} is the latest version` })
            else if (next.status === 'error') toast({ kind: 'error', title: 'Could not check for updates', description: next.error })
          }}
        >
          Check for updates
        </Button>
      )}
    </SettingRow>
  )
}

export function SettingsPage() {
  const settings = useApp((s) => s.settings)!
  const update = useApp((s) => s.updateSettings)
  const servers = useApp((s) => s.servers)
  const info = useAsync(() => api.app.info(), [])
  const [license, setLicense] = useState(settings.defaultLicenseKey)

  useEffect(() => setLicense(settings.defaultLicenseKey), [settings.defaultLicenseKey])

  const changeLibrary = async (): Promise<void> => {
    const path = await api.app.pickFolder('Choose where servers and builds are stored', settings.libraryPath)
    if (!path || path === settings.libraryPath) return
    await attempt(() => update({ libraryPath: path }))
    if (servers.length) {
      toast({
        kind: 'info',
        title: 'Library location changed',
        description: 'Existing servers stay where they are. New servers and builds go to the new folder.'
      })
    }
  }

  return (
    <Page className="max-w-[760px]">
      <PageHeader title="Settings" />

      <Group title="Library">
        <SettingRow title="Location" description="Where servers, downloaded builds and the managed database live.">
          <div className="flex items-center gap-1.5">
            <Input mono readOnly value={settings.libraryPath} className="w-[300px] text-fg-muted" />
            <Button square variant="ghost" onClick={() => void api.app.openPath(settings.libraryPath)} icon={<FolderOpen size={14} strokeWidth={1.75} />} />
            <Button onClick={() => void changeLibrary()}>Change</Button>
          </div>
        </SettingRow>
      </Group>

      <Group title="Appearance">
        <SettingRow title="Theme">
          <Segmented<ThemePreference>
            value={settings.theme}
            onChange={(theme) => void update({ theme })}
            options={[
              { value: 'dark', label: 'Dark', icon: <Moon size={13} strokeWidth={1.75} /> },
              { value: 'light', label: 'Light', icon: <Sun size={13} strokeWidth={1.75} /> },
              { value: 'system', label: 'System', icon: <Monitor size={13} strokeWidth={1.75} /> }
            ]}
          />
        </SettingRow>
      </Group>

      <Group title="Startup and closing">
        <SettingRow title="Launch when Windows starts" description="Opens quietly in the tray so auto-start servers come up after a reboot.">
          <Switch checked={settings.launchOnStartup} onChange={(v) => void update({ launchOnStartup: v })} />
        </SettingRow>
        <SettingRow title="Start minimized" description="Open to the tray instead of showing the window.">
          <Switch checked={settings.startMinimized} onChange={(v) => void update({ startMinimized: v })} />
        </SettingRow>
        <SettingRow title="Keep running in the tray" description="Closing the window leaves your servers running.">
          <Switch checked={settings.closeToTray} onChange={(v) => void update({ closeToTray: v })} />
        </SettingRow>
        <SettingRow title="Confirm before quitting" description="Ask before stopping running servers on quit.">
          <Switch checked={settings.confirmStop} onChange={(v) => void update({ confirmStop: v })} />
        </SettingRow>
        <SettingRow title="Start the managed database with the app">
          <Switch checked={settings.db.autoStart} onChange={(v) => void update({ db: { ...settings.db, autoStart: v } })} />
        </SettingRow>
      </Group>

      <Group title="Defaults for new servers">
        <SettingRow title="License key" description="Prefilled when you create a server. Each running server still needs its own key.">
          <div className="flex items-center gap-1.5">
            <SecretInput value={license} onChange={(e) => setLicense(e.target.value)} placeholder="cfxk_…" className="w-[300px]" />
            <Button disabled={license === settings.defaultLicenseKey} onClick={() => void update({ defaultLicenseKey: license })}>
              Save
            </Button>
          </div>
        </SettingRow>
      </Group>

      <Group title="About">
        <SettingRow title="FiveM Server Manager" description={info.data ? `Version ${info.data.version} · Electron ${info.data.electron}` : ' '}>
          <div className="flex gap-1.5">
            <Button variant="ghost" onClick={() => void api.app.openExternal(RELEASES_URL)}>
              Releases
            </Button>
            <Button variant="ghost" onClick={() => info.data && void api.app.openPath(info.data.userData)}>
              App data
            </Button>
          </div>
        </SettingRow>
        <UpdatesRow />
      </Group>
    </Page>
  )
}
