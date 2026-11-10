import { app, safeStorage } from 'electron'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { SyncRemote } from '@shared/types'
import { writeFileAtomic } from '../util'
import type { RemoteSecrets } from './target'

interface StoredRemote extends SyncRemote {
  /** Keys and repo password, encrypted with Windows DPAPI through Electron safeStorage. */
  secrets: string
}

interface RemotesFile {
  version: 1
  remotes: StoredRemote[]
}

/** Storage remotes for this machine. Secrets are sealed with safeStorage and never written in the clear. */
class Remotes {
  private data: RemotesFile | null = null

  private get file(): string {
    return join(app.getPath('userData'), 'sync-remotes.json')
  }

  private load(): RemotesFile {
    if (this.data) return this.data
    this.data = { version: 1, remotes: [] }
    if (existsSync(this.file)) {
      try {
        const raw = JSON.parse(readFileSync(this.file, 'utf8')) as RemotesFile
        this.data = { version: 1, remotes: raw.remotes ?? [] }
      } catch (err) {
        console.error('Failed to read sync-remotes.json', err)
      }
    }
    return this.data
  }

  private async save(): Promise<void> {
    await writeFileAtomic(this.file, JSON.stringify(this.load(), null, 2))
  }

  list(): SyncRemote[] {
    return this.load().remotes.map(({ secrets: _s, ...pub }) => pub)
  }

  get(id: string): SyncRemote {
    const r = this.list().find((x) => x.id === id)
    if (!r) throw new Error('That sync remote no longer exists on this machine')
    return r
  }

  secrets(id: string): RemoteSecrets {
    const r = this.load().remotes.find((x) => x.id === id)
    if (!r) throw new Error('That sync remote no longer exists on this machine')
    try {
      return JSON.parse(safeStorage.decryptString(Buffer.from(r.secrets, 'base64'))) as RemoteSecrets
    } catch {
      throw new Error(`The keys for ${r.name} could not be decrypted on this Windows account; connect it again`)
    }
  }

  async add(remote: SyncRemote, secrets: RemoteSecrets): Promise<void> {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error('Windows encryption is not available, so keys cannot be stored safely')
    }
    const sealed = safeStorage.encryptString(JSON.stringify(secrets)).toString('base64')
    const data = this.load()
    data.remotes = [...data.remotes.filter((r) => r.id !== remote.id), { ...remote, secrets: sealed }]
    await this.save()
  }

  async rename(id: string, name: string): Promise<void> {
    const r = this.load().remotes.find((x) => x.id === id)
    if (!r) throw new Error('That sync remote no longer exists on this machine')
    r.name = name
    await this.save()
  }

  async remove(id: string): Promise<void> {
    const data = this.load()
    data.remotes = data.remotes.filter((r) => r.id !== id)
    await this.save()
  }
}

export const remotes = new Remotes()
