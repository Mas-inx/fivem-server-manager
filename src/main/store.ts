import { app, safeStorage } from 'electron'
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { AppSettings, ServerConfig } from '@shared/types'
import { broadcast } from './broadcast'
import { writeFileAtomic } from './util'

interface StoreData {
  version: 1
  settings: AppSettings
  servers: ServerConfig[]
}

const defaults = (): AppSettings => ({
  libraryPath: join(homedir(), 'FXServers'),
  theme: 'dark',
  defaultLicenseKey: '',
  launchOnStartup: false,
  startMinimized: false,
  closeToTray: true,
  confirmStop: true,
  db: {
    mode: 'managed',
    external: { host: '127.0.0.1', port: 3306, user: 'root', password: '' },
    managedPort: 3306,
    managedPassword: '',
    managedVersion: null,
    autoStart: true
  },
  onboarded: false
})

// Secrets are encrypted with the OS keychain (DPAPI on Windows) before they touch disk.
const SECRET_PREFIX = 'enc:'

function seal(value: string): string {
  if (!value || !safeStorage.isEncryptionAvailable()) return value
  return SECRET_PREFIX + safeStorage.encryptString(value).toString('base64')
}

function unseal(value: string): string {
  if (!value?.startsWith(SECRET_PREFIX)) return value
  try {
    return safeStorage.decryptString(Buffer.from(value.slice(SECRET_PREFIX.length), 'base64'))
  } catch {
    return ''
  }
}

class Store {
  private get file(): string {
    return join(app.getPath('userData'), 'library.json')
  }
  private data: StoreData = { version: 1, settings: defaults(), servers: [] }
  private saveTimer: NodeJS.Timeout | null = null

  load(): void {
    if (!existsSync(this.file)) return
    try {
      const raw = JSON.parse(readFileSync(this.file, 'utf8')) as StoreData
      const base = defaults()
      const settings: AppSettings = {
        ...base,
        ...raw.settings,
        db: {
          ...base.db,
          ...raw.settings?.db,
          external: { ...base.db.external, ...raw.settings?.db?.external }
        }
      }
      settings.db.managedPassword = unseal(settings.db.managedPassword)
      settings.db.external.password = unseal(settings.db.external.password)
      const servers = (raw.servers ?? []).map((s) => ({
        ...s,
        licenseKey: unseal(s.licenseKey ?? ''),
        txAdmin: s.txAdmin ? { ...s.txAdmin, password: unseal(s.txAdmin.password) } : null
      }))
      settings.defaultLicenseKey = unseal(settings.defaultLicenseKey)
      this.data = { version: 1, settings, servers }
    } catch (err) {
      console.error('Failed to read library.json', err)
    }
  }

  get settings(): AppSettings {
    return this.data.settings
  }

  get servers(): ServerConfig[] {
    return this.data.servers
  }

  server(id: string): ServerConfig {
    const s = this.data.servers.find((x) => x.id === id)
    if (!s) throw new Error('Server not found')
    return s
  }

  updateSettings(patch: Partial<AppSettings>): AppSettings {
    const cur = this.data.settings
    this.data.settings = {
      ...cur,
      ...patch,
      db: patch.db ? { ...cur.db, ...patch.db, external: { ...cur.db.external, ...patch.db.external } } : cur.db
    }
    this.save()
    broadcast('event:settings', this.data.settings)
    return this.data.settings
  }

  addServer(server: ServerConfig): void {
    this.data.servers.push(server)
    this.save()
    this.emitServers()
  }

  updateServer(id: string, patch: Partial<ServerConfig>): ServerConfig {
    const s = this.server(id)
    Object.assign(s, patch)
    this.save()
    this.emitServers()
    return s
  }

  removeServer(id: string): void {
    this.data.servers = this.data.servers.filter((s) => s.id !== id)
    this.save()
    this.emitServers()
  }

  emitServers(): void {
    broadcast('event:servers', this.data.servers)
  }

  save(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer)
    this.saveTimer = setTimeout(() => void this.flush(), 150)
  }

  async flush(): Promise<void> {
    if (this.saveTimer) clearTimeout(this.saveTimer)
    this.saveTimer = null
    const s = this.data.settings
    const out: StoreData = {
      version: 1,
      settings: {
        ...s,
        defaultLicenseKey: seal(s.defaultLicenseKey),
        db: {
          ...s.db,
          managedPassword: seal(s.db.managedPassword),
          external: { ...s.db.external, password: seal(s.db.external.password) }
        }
      },
      servers: this.data.servers.map((sv) => ({
        ...sv,
        licenseKey: seal(sv.licenseKey),
        txAdmin: sv.txAdmin ? { ...sv.txAdmin, password: seal(sv.txAdmin.password) } : null
      }))
    }
    await writeFileAtomic(this.file, JSON.stringify(out, null, 2))
  }
}

export const store = new Store()
