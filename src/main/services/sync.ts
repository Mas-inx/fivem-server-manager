import { app } from 'electron'
import { existsSync, promises as fs } from 'node:fs'
import { hostname } from 'node:os'
import { isAbsolute, join, relative } from 'node:path'
import type {
  Platform,
  RemoteServerEntry,
  ServerConfig,
  ServerMode,
  ServerSyncState,
  SyncCheck,
  SyncCloneInput,
  SyncEngineInfo,
  SyncOp,
  SyncProgress,
  SyncPullOptions,
  SyncPushOptions,
  SyncRemote,
  SyncRemoteInput,
  SyncResult,
  SyncSnapshot
} from '@shared/types'
import { formatBytes } from '@shared/format'
import { classifySync, decodeTag, encodeTag, IGNORE_FILE, needsConfirmation, SYNC_DIR, type SyncLayout } from '@shared/sync'
import { broadcast, toast } from '../broadcast'
import { paths } from '../paths'
import { store } from '../store'
import { tasks, type TaskHandle } from '../tasks'
import { dbName, errorMessage, id as newId, password, slugify, throttle, uniqueDir } from '../util'
import { ensureRestic, RESTIC_VERSION, resticInstalled } from '../sync/binary'
import { dumpDatabase, importDatabase } from '../sync/db-dump'
import { diffSnapshots, ensureIgnoreFile, listSnapshots, pushFolder, readIgnoreText, restoreFolder, type EngineProgress, type ResticSnapshot } from '../sync/engine'
import { compileIgnore, DEFAULT_IGNORE } from '../sync/ignore'
import { decodeManifest, diffManifest, encodeManifest, scanTree, type Manifest } from '../sync/manifest'
import { applyLocalCfg } from '../sync/overrides'
import { remotes } from '../sync/remotes'
import { Restic, SyncCancelled } from '../sync/restic'
import { checkHub } from '../sync/hub-check'
import { decodeConnectionCode, encodeConnectionCode, hubUrl, resticTarget, validateRemote, type RemoteSecrets } from '../sync/target'
import { artifacts } from './artifacts'
import { database } from './database'
import { runner } from './runner'
import { serverFiles, txProfiles } from './server-files'
import { rebaseTxData } from './servers'

/** What a snapshot says about the server it came from, read from its tags. */
interface SnapshotMeta {
  syncId: string
  name: string
  kind: 'push' | 'pre-pull'
  platform: Platform | null
  build: string | null
  mode: ServerMode | null
  layout: SyncLayout | null
  slots: number | null
  hasDatabase: boolean
}

function readTags(tags: string[] = []): SnapshotMeta {
  const get = (key: string): string | null => {
    const t = tags.find((x) => x.startsWith(`${key}:`))
    return t ? t.slice(key.length + 1) : null
  }
  const build = get('build')
  const [platform, buildNo] = build ? build.split(':') : [null, null]
  const layout = get('layout')
  return {
    syncId: get('sync') ?? '',
    name: decodeTag(get('name') ?? ''),
    kind: get('kind') === 'pre-pull' ? 'pre-pull' : 'push',
    platform: platform === 'legacy' || platform === 'enhanced' ? platform : null,
    build: buildNo || null,
    mode: get('mode') === 'txadmin' ? 'txadmin' : get('mode') === 'standalone' ? 'standalone' : null,
    layout: layout === 'root' || layout === 'data' || layout === 'txdata' ? layout : null,
    slots: Number(get('slots')) || null,
    hasDatabase: tags.includes('db')
  }
}

function toSnapshot(s: ResticSnapshot): SyncSnapshot {
  const meta = readTags(s.tags)
  return {
    id: s.id,
    shortId: s.short_id ?? s.id.slice(0, 8),
    time: Date.parse(s.time),
    machine: s.hostname,
    kind: meta.kind,
    syncId: meta.syncId,
    name: meta.name,
    platform: meta.platform,
    build: meta.build,
    mode: meta.mode,
    hasDatabase: meta.hasDatabase,
    files: s.summary?.total_files_processed ?? 0,
    bytes: s.summary?.total_bytes_processed ?? 0,
    added: s.summary?.data_added_packed ?? s.summary?.data_added ?? 0
  }
}

const byNewest = (a: ResticSnapshot, b: ResticSnapshot): number => Date.parse(b.time) - Date.parse(a.time)
const sameId = (a: string, b: string): boolean => a.startsWith(b) || b.startsWith(a)

function inside(child: string, parent: string): boolean {
  const rel = relative(parent, child)
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

const SYNC_ID = /^[a-z0-9][a-z0-9-]{3,40}$/

interface ActiveOp {
  abort: AbortController
  progress: SyncProgress
  lastBytes: number
  lastAt: number
}

class SyncService {
  private ops = new Map<string, ActiveOp>()
  private emit = throttle(() => broadcast('event:sync', this.progressMap()), 250)

  // ---------------------------------------------------------------------------------------------
  // Engine and remotes

  engine(): SyncEngineInfo {
    return { version: RESTIC_VERSION, installed: resticInstalled() }
  }

  machineName(): string {
    return store.settings.syncMachineName?.trim() || hostname()
  }

  private cacheDir(): string {
    return join(app.getPath('userData'), 'sync-cache')
  }

  private tmpDir(): string {
    return join(app.getPath('temp'), 'fsm-sync')
  }

  /** Writes a hub remote's CA certificate where restic --cacert can read it. */
  private async certFile(remote: SyncRemote): Promise<string | undefined> {
    if (remote.kind !== 'rest' || !remote.certPem) return undefined
    const dir = join(app.getPath('userData'), 'sync-certs')
    await fs.mkdir(dir, { recursive: true })
    const file = join(dir, `${remote.id}.pem`)
    await fs.writeFile(file, remote.certPem, 'utf8')
    return file
  }

  private async resticFor(remote: SyncRemote, secrets: RemoteSecrets, task?: TaskHandle): Promise<Restic> {
    if (remote.kind === 'rest') {
      const check = await checkHub(hubUrl(remote.endpoint), remote.user, secrets.restPassword ?? '', remote.certPem)
      if (!check.ok) throw new Error(check.message)
    }
    const bin = await ensureRestic((detail) => task?.update({ detail }))
    return new Restic(bin, resticTarget(remote, secrets, await this.certFile(remote)), this.cacheDir())
  }

  private async restic(remoteId: string, task?: TaskHandle): Promise<Restic> {
    return this.resticFor(remotes.get(remoteId), remotes.secrets(remoteId), task)
  }

  listRemotes(): SyncRemote[] {
    return remotes.list()
  }

  /** Saves a remote after proving it works: an empty location gets a new repository, an existing one must open. */
  async addRemote(input: SyncRemoteInput): Promise<SyncRemote> {
    const problem = validateRemote(input)
    if (problem) throw new Error(problem)
    const remote: SyncRemote = {
      id: newId(),
      name: input.name.trim(),
      kind: input.kind,
      endpoint: input.endpoint.trim(),
      bucket: input.bucket.trim(),
      prefix: input.prefix.trim(),
      region: input.region.trim(),
      host: input.host.trim(),
      port: input.port || 22,
      user: input.user.trim(),
      path: input.path.trim(),
      keyFile: input.keyFile.trim(),
      certPem: input.certPem.trim(),
      createdAt: Date.now()
    }
    const secrets: RemoteSecrets = {
      accessKeyId: input.accessKeyId.trim(),
      secretAccessKey: input.secretAccessKey.trim(),
      repoPassword: input.repoPassword || password(32),
      restPassword: input.restPassword
    }
    if (remote.kind === 'local') await fs.mkdir(remote.path, { recursive: true }).catch(() => undefined)
    return this.connectRemote(remote, secrets)
  }

  /** Opens the repository behind a remote, creating it when the location is empty, then saves the remote here. */
  async connectRemote(remote: SyncRemote, secrets: RemoteSecrets): Promise<SyncRemote> {
    await tasks.run(`Connecting ${remote.name}`, async (task) => {
      const restic = await this.resticFor(remote, secrets, task)
      task.update({ detail: 'Opening the repository' })
      if (!(await restic.exists())) {
        task.update({ detail: 'Creating the repository' })
        await restic.init()
      }
    })
    await remotes.add(remote, secrets)
    return remote
  }

  async importCode(code: string): Promise<SyncRemote> {
    const input = decodeConnectionCode(code)
    const existing = remotes.list().find((r) => r.name === input.name)
    if (existing) input.name = `${input.name} (${new Date().toLocaleDateString()})`
    return this.addRemote(input)
  }

  connectionCode(id: string): string {
    return encodeConnectionCode(remotes.get(id), remotes.secrets(id))
  }

  async renameRemote(id: string, name: string): Promise<void> {
    if (!name.trim()) throw new Error('Give the remote a name')
    await remotes.rename(id, name.trim())
  }

  async removeRemote(id: string): Promise<void> {
    const users = store.servers.filter((s) => s.sync?.remoteId === id)
    if (users.length) throw new Error(`Turn off sync for ${users.map((s) => s.name).join(', ')} first`)
    await remotes.remove(id)
  }

  async testRemote(id: string): Promise<{ snapshots: number; servers: number }> {
    const restic = await this.restic(id)
    const snaps = await listSnapshots(restic, ['fsm'])
    return { snapshots: snaps.length, servers: new Set(snaps.map((s) => readTags(s.tags).syncId)).size }
  }

  /** Servers that have been pushed to a remote, newest push first, for "Clone from remote". */
  async remoteServers(remoteId: string): Promise<RemoteServerEntry[]> {
    const restic = await this.restic(remoteId)
    const snaps = (await listSnapshots(restic, ['fsm', 'kind:push'])).sort(byNewest)
    const out = new Map<string, RemoteServerEntry>()
    for (const s of snaps) {
      const meta = readTags(s.tags)
      if (!meta.syncId) continue
      const entry = out.get(meta.syncId)
      if (entry) entry.snapshots++
      else out.set(meta.syncId, { syncId: meta.syncId, name: meta.name || meta.syncId, latest: toSnapshot(s), snapshots: 1 })
    }
    return [...out.values()]
  }

  // ---------------------------------------------------------------------------------------------
  // Per-server settings

  /** The folder a server syncs: everything the server needs, and nothing outside it. */
  async syncRoot(server: ServerConfig): Promise<{ root: string; layout: SyncLayout }> {
    if (server.mode === 'standalone') return { root: server.dataPath ?? join(server.root, 'server-data'), layout: 'data' }
    const root = server.txDataPath ?? server.root
    const layout: SyncLayout = server.txDataPath ? 'txdata' : 'root'
    const files = await serverFiles(server)
    if (files.dataPath && !inside(files.dataPath, root)) {
      throw new Error(
        `txAdmin keeps this server's data in ${files.dataPath}, outside the folder Sync can include. Duplicate the server, which copies the data in, and sync the copy.`
      )
    }
    return { root, layout }
  }

  async enable(id: string, opts: { remoteId: string; syncId?: string; includeDatabase: boolean }): Promise<ServerConfig> {
    const server = store.server(id)
    remotes.get(opts.remoteId)
    const syncId = (opts.syncId?.trim() || `${slugify(server.name).slice(0, 24)}-${newId().slice(0, 6)}`).toLowerCase()
    if (!SYNC_ID.test(syncId)) throw new Error('Sync ids use lowercase letters, numbers and dashes')
    const clash = store.servers.find((s) => s.id !== id && s.sync?.id === syncId)
    if (clash) throw new Error(`${clash.name} already uses that sync id on this machine`)
    const { root } = await this.syncRoot(server)
    await fs.mkdir(root, { recursive: true })
    await ensureIgnoreFile(root)
    return store.updateServer(id, {
      sync: { id: syncId, remoteId: opts.remoteId, includeDatabase: opts.includeDatabase },
      syncState: server.sync?.id === syncId ? server.syncState : null
    })
  }

  async disable(id: string): Promise<ServerConfig> {
    if (this.ops.has(id)) throw new Error('Wait for the running sync to finish')
    await fs.rm(this.manifestFile(id), { force: true })
    return store.updateServer(id, { sync: null, syncState: null })
  }

  setIncludeDatabase(id: string, includeDatabase: boolean): ServerConfig {
    const server = store.server(id)
    if (!server.sync) throw new Error('Sync is off for this server')
    return store.updateServer(id, { sync: { ...server.sync, includeDatabase } })
  }

  async readIgnore(id: string): Promise<string> {
    const { root } = await this.syncRoot(store.server(id))
    return readIgnoreText(root)
  }

  async writeIgnore(id: string, text: string): Promise<void> {
    const { root } = await this.syncRoot(store.server(id))
    compileIgnore(text)
    await fs.mkdir(root, { recursive: true })
    await fs.writeFile(join(root, IGNORE_FILE), text.trim() ? `${text.replace(/\s+$/, '')}\n` : DEFAULT_IGNORE, 'utf8')
  }

  // ---------------------------------------------------------------------------------------------
  // State kept per machine

  private manifestFile(id: string): string {
    return join(app.getPath('userData'), 'sync', `${id}.manifest.gz`)
  }

  private async saveManifest(id: string, snapshot: string, files: Manifest): Promise<void> {
    await fs.mkdir(join(app.getPath('userData'), 'sync'), { recursive: true })
    await fs.writeFile(this.manifestFile(id), encodeManifest(snapshot, files))
  }

  private async loadManifest(id: string): Promise<{ snapshot: string | null; files: Manifest } | null> {
    try {
      return decodeManifest(await fs.readFile(this.manifestFile(id)))
    } catch {
      return null
    }
  }

  private setState(id: string, patch: Partial<ServerSyncState>): void {
    const cur = store.server(id).syncState ?? { base: null, lastAction: null, lastAt: null, interrupted: false }
    store.updateServer(id, { syncState: { ...cur, ...patch } })
  }

  // ---------------------------------------------------------------------------------------------
  // Progress and cancellation

  progressMap(): Record<string, SyncProgress> {
    return Object.fromEntries([...this.ops].map(([k, v]) => [k, v.progress]))
  }

  cancel(id: string): void {
    this.ops.get(id)?.abort.abort()
  }

  /** Runs a sync operation as a task, with live progress, speed and ETA, and a way to cancel it. */
  private async track<T>(key: string, op: SyncOp, title: string, work: (ctx: { signal: AbortSignal; task: TaskHandle; progress: (p: EngineProgress) => void; phase: (text: string) => void }) => Promise<T>): Promise<T> {
    if (this.ops.has(key)) throw new Error('A sync is already running for this server')
    const active: ActiveOp = {
      abort: new AbortController(),
      lastBytes: 0,
      lastAt: Date.now(),
      progress: { serverId: key, op, phase: 'Starting', fraction: null, bytesDone: 0, bytesTotal: 0, filesDone: 0, filesTotal: 0, speed: 0, eta: null, startedAt: Date.now() }
    }
    this.ops.set(key, active)
    this.emit()
    try {
      return await tasks.run(title, (task) => {
        const phase = (text: string): void => {
          Object.assign(active.progress, { phase: text, fraction: null, bytesDone: 0, bytesTotal: 0, filesDone: 0, filesTotal: 0, speed: 0, eta: null })
          active.lastBytes = 0
          active.lastAt = Date.now()
          task.update({ detail: text, progress: null })
          this.emit()
        }
        const progress = (p: EngineProgress): void => {
          const pr = active.progress
          const now = Date.now()
          if (p.phase !== pr.phase) {
            active.lastBytes = p.bytesDone
            active.lastAt = now
            pr.speed = 0
          } else if (now - active.lastAt >= 400) {
            const inst = ((p.bytesDone - active.lastBytes) * 1000) / (now - active.lastAt)
            pr.speed = pr.speed ? pr.speed * 0.7 + Math.max(0, inst) * 0.3 : Math.max(0, inst)
            active.lastBytes = p.bytesDone
            active.lastAt = now
          }
          Object.assign(pr, {
            phase: p.phase,
            fraction: p.fraction,
            bytesDone: p.bytesDone,
            bytesTotal: p.bytesTotal,
            filesDone: p.filesDone,
            filesTotal: p.filesTotal,
            eta: p.secondsLeft ?? (pr.speed > 0 && p.bytesTotal ? Math.max(0, (p.bytesTotal - p.bytesDone) / pr.speed) : null)
          })
          const detail = p.bytesTotal ? `${p.phase} · ${formatBytes(p.bytesDone)} of ${formatBytes(p.bytesTotal)}` : p.phase
          task.update({ detail, progress: p.fraction })
          this.emit()
        }
        return work({ signal: active.abort.signal, task, progress, phase })
      })
    } finally {
      this.ops.delete(key)
      this.emit()
    }
  }

  // ---------------------------------------------------------------------------------------------
  // Snapshot helpers

  private tags(server: ServerConfig, kind: 'push' | 'pre-pull', layout: SyncLayout, withDb: boolean): string[] {
    const tags = [
      'fsm',
      `sync:${server.sync!.id}`,
      `kind:${kind}`,
      `name:${encodeTag(server.name)}`,
      `build:${server.platform}:${server.build}`,
      `mode:${server.mode}`,
      `layout:${layout}`,
      `slots:${server.maxClients}`
    ]
    if (withDb) tags.push('db')
    return tags
  }

  private async snapshots(restic: Restic, syncId: string, signal?: AbortSignal): Promise<ResticSnapshot[]> {
    return (await listSnapshots(restic, [`sync:${syncId}`], signal)).sort(byNewest)
  }

  /** Dumps the server's database into the sync folder; returns false when there is nothing to dump. */
  private async dumpInto(server: ServerConfig, root: string): Promise<boolean> {
    if (!server.database) return false
    const tool = database.clientTool('dump')
    if (!tool) throw new Error('mariadb-dump was not found. Install the managed database from the Database page, or turn off "Include database".')
    await database.ensureRunning()
    await fs.mkdir(join(root, SYNC_DIR), { recursive: true })
    await dumpDatabase(tool, database.connection(), server.database, join(root, SYNC_DIR, 'database.sql'))
    return true
  }

  private async clearSyncDir(root: string): Promise<void> {
    await fs.rm(join(root, SYNC_DIR, 'database.sql'), { force: true })
  }

  /** Replaces the server's database with the dump that came with a snapshot. */
  private async importInto(server: ServerConfig, root: string, task: TaskHandle): Promise<string | null> {
    const dump = join(root, SYNC_DIR, 'database.sql')
    if (!existsSync(dump)) return server.database
    const tool = database.clientTool('client')
    if (!tool) throw new Error('The mariadb client was not found. Install the managed database from the Database page.')
    await database.ensureRunning()
    const name = server.database ?? (await database.uniqueName(dbName(server.name)))
    task.update({ detail: `Importing database ${name}` })
    await database.drop(name)
    await database.create(name)
    await importDatabase(tool, database.connection(), name, dump)
    return name
  }

  /** Points pulled files back at this machine: txAdmin's paths, then the port, license key and database in server.cfg. */
  private async applyLocal(server: ServerConfig, root: string, layout: SyncLayout, fromRoot: string | undefined): Promise<void> {
    if (server.mode === 'txadmin' && fromRoot) {
      const txData = layout === 'root' ? join(root, 'txData') : root
      if ((await txProfiles(txData)).length) await rebaseTxData(txData, fromRoot, root)
    }
    const files = await serverFiles(server)
    if (!files.cfgPath || !existsSync(files.cfgPath)) return
    const cfg = await fs.readFile(files.cfgPath, 'utf8')
    const next = applyLocalCfg(cfg, {
      mode: server.mode,
      gamePort: server.gamePort,
      txAdminPort: server.txAdminPort,
      licenseKey: server.licenseKey,
      database: server.database,
      connectionString: server.database ? database.connectionString(server.database) : null,
      db: database.connection()
    })
    if (next !== cfg) await fs.writeFile(files.cfgPath, next, 'utf8')
  }

  private async recordState(id: string, root: string, snapshot: string, action: ServerSyncState['lastAction']): Promise<void> {
    const scan = await scanTree(root, compileIgnore(await readIgnoreText(root)))
    await this.saveManifest(id, snapshot, scan.files)
    this.setState(id, { base: snapshot, lastAction: action, lastAt: Date.now(), interrupted: false })
  }

  // ---------------------------------------------------------------------------------------------
  // Check, push, pull, history, clone

  /** Compares this copy with the remote: what changed here since the last sync, and what was pushed since. */
  async check(id: string, signal?: AbortSignal): Promise<SyncCheck> {
    const server = store.server(id)
    if (!server.sync) throw new Error('Sync is off for this server')
    const restic = await this.restic(server.sync.remoteId)
    const snaps = await this.snapshots(restic, server.sync.id, signal)
    const latestRaw = snaps.find((s) => readTags(s.tags).kind === 'push') ?? null
    const base = server.syncState?.base ?? null
    const { root } = await this.syncRoot(server)

    let local: SyncCheck['local'] = []
    const saved = base ? await this.loadManifest(id) : null
    if (saved) {
      const scan = await scanTree(root, compileIgnore(await readIgnoreText(root)))
      local = diffManifest(saved.files, scan.files)
    }
    let remote: SyncCheck['remote'] = []
    let remoteUnknown = false
    if (base && latestRaw && !sameId(base, latestRaw.id)) {
      try {
        remote = await diffSnapshots(restic, base, latestRaw.id, signal)
      } catch {
        remoteUnknown = true
      }
    }
    return {
      state: classifySync({ base, latest: latestRaw?.id ?? null, local }),
      base,
      latest: latestRaw ? toSnapshot(latestRaw) : null,
      local,
      remote,
      remoteUnknown
    }
  }

  async push(id: string, opts: SyncPushOptions): Promise<SyncResult> {
    const server = store.server(id)
    const cfg = server.sync
    if (!cfg) throw new Error('Sync is off for this server')
    if (this.ops.has(id)) throw new Error('A sync is already running for this server')
    if (opts.includeDatabase !== cfg.includeDatabase) this.setIncludeDatabase(id, opts.includeDatabase)
    if (!opts.force) {
      const check = await this.check(id)
      if (needsConfirmation('push', check.state)) return { status: 'conflict', check }
    }
    try {
      return await this.track(id, 'push', `Pushing ${server.name}`, async ({ signal, task, progress, phase }) => {
        const { root, layout } = await this.syncRoot(server)
        const restic = await this.restic(cfg.remoteId, task)
        const snaps = await this.snapshots(restic, cfg.id, signal)
        const base = server.syncState?.base
        const parent = (base && snaps.find((s) => sameId(s.id, base))?.id) ?? snaps.find((s) => s.hostname === this.machineName())?.id ?? null
        let withDb = false
        try {
          if (opts.includeDatabase && server.database) {
            phase(`Dumping database ${server.database}`)
            withDb = await this.dumpInto(server, root)
          }
          const res = await pushFolder({
            restic,
            root,
            host: this.machineName(),
            tags: this.tags(server, 'push', layout, withDb),
            parent,
            tmpDir: this.tmpDir(),
            signal,
            onProgress: progress
          })
          await this.saveManifest(id, res.snapshotId, res.manifest)
          this.setState(id, { base: res.snapshotId, lastAction: 'push', lastAt: Date.now(), interrupted: false })
          const after = (await this.snapshots(restic, cfg.id)).find((s) => sameId(s.id, res.snapshotId))
          return {
            status: 'done' as const,
            snapshot: after ? toSnapshot(after) : null,
            message: `Uploaded ${formatBytes(res.dataAddedPacked)} (${res.filesNew} new, ${res.filesChanged} changed files)`
          }
        } finally {
          await this.clearSyncDir(root)
        }
      })
    } catch (err) {
      // The next push skips whatever restic had already saved and indexed on the remote.
      if (store.servers.some((s) => s.id === id)) this.setState(id, { interrupted: true })
      if (err instanceof SyncCancelled) {
        await this.restic(cfg.remoteId)
          .then((r) => r.unlock())
          .catch(() => undefined)
      }
      throw err
    }
  }

  async pull(id: string, opts: SyncPullOptions): Promise<SyncResult> {
    const server = store.server(id)
    const cfg = server.sync
    if (!cfg) throw new Error('Sync is off for this server')
    if (this.ops.has(id)) throw new Error('A sync is already running for this server')
    if (!opts.force && !opts.snapshotId) {
      const check = await this.check(id)
      if (needsConfirmation('pull', check.state)) return { status: 'conflict', check }
    }
    const op: SyncOp = opts.snapshotId ? 'restore' : 'pull'
    try {
      return await this.track(id, op, `${op === 'restore' ? 'Restoring' : 'Pulling'} ${server.name}`, async ({ signal, task, progress, phase }) => {
        const restic = await this.restic(cfg.remoteId, task)
        const snaps = await this.snapshots(restic, cfg.id, signal)
        const target = opts.snapshotId ? snaps.find((s) => sameId(s.id, opts.snapshotId!)) : snaps.find((s) => readTags(s.tags).kind === 'push')
        if (!target) throw new Error(opts.snapshotId ? 'That snapshot is no longer on the remote' : 'Nothing has been pushed for this server yet')
        const meta = readTags(target.tags)
        const { root, layout } = await this.syncRoot(server)
        if (meta.layout && meta.layout !== layout) {
          throw new Error(`The snapshot is a ${meta.mode === 'txadmin' ? 'txAdmin' : 'standalone'} server laid out differently from this one; clone it as a new server instead`)
        }

        const wasRunning = runner.isRunning(id)
        if (wasRunning) {
          phase('Stopping the server')
          await runner.stop(id)
        }

        // A restore point first, so this pull can be undone from History.
        phase('Saving a restore point')
        const base = server.syncState?.base
        let withDb = false
        let restorePoint: string
        try {
          if (cfg.includeDatabase && server.database) withDb = await this.dumpInto(server, root)
          const pre = await pushFolder({
            restic,
            root,
            host: this.machineName(),
            tags: this.tags(server, 'pre-pull', layout, withDb),
            parent: (base && snaps.find((s) => sameId(s.id, base))?.id) ?? null,
            tmpDir: this.tmpDir(),
            signal,
            onProgress: (p) => progress({ ...p, phase: 'Saving a restore point' })
          })
          restorePoint = pre.snapshotId
        } finally {
          await this.clearSyncDir(root)
        }

        const result = await restoreFolder({ restic, root, snapshotId: target.id, signal, onProgress: progress })

        let databaseName = server.database
        if (opts.importDatabase && meta.hasDatabase) {
          phase('Importing the database')
          databaseName = await this.importInto(server, root, task)
        }
        await this.clearSyncDir(root)

        const patch: Partial<ServerConfig> = { database: databaseName }
        if (meta.platform && meta.build) Object.assign(patch, { platform: meta.platform, build: meta.build })
        if (meta.slots) patch.maxClients = meta.slots
        const updated = store.updateServer(id, patch)

        phase("Applying this machine's settings")
        await this.applyLocal(updated, root, layout, target.paths[0])

        if (!artifacts.isInstalled(updated.platform, updated.build)) {
          phase(`Downloading FXServer build ${updated.build}`)
          await artifacts.install(updated.platform, updated.build)
        }
        await this.recordState(id, root, target.id, op)

        if (wasRunning) {
          phase('Starting the server')
          await runner.start(id).catch((e) => toast({ kind: 'error', title: `${updated.name} did not start`, description: errorMessage(e) }))
        }
        return {
          status: 'done' as const,
          snapshot: toSnapshot(target),
          restorePoint,
          message: `${result.filesRestored} files updated, ${result.filesDeleted} removed`
        }
      })
    } catch (err) {
      if (err instanceof SyncCancelled) {
        await this.restic(cfg.remoteId)
          .then((r) => r.unlock())
          .catch(() => undefined)
      }
      throw err
    }
  }

  async history(id: string): Promise<SyncSnapshot[]> {
    const server = store.server(id)
    if (!server.sync) return []
    const restic = await this.restic(server.sync.remoteId)
    return (await this.snapshots(restic, server.sync.id)).map(toSnapshot)
  }

  /** Creates a new server on this machine from the newest push (or a chosen snapshot) of a synced server. */
  async clone(input: SyncCloneInput): Promise<ServerConfig> {
    const key = `clone:${input.syncId}`
    return this.track(key, 'clone', `Cloning ${input.name || input.syncId}`, async ({ signal, task, progress, phase }) => {
      const restic = await this.restic(input.remoteId, task)
      const snaps = await this.snapshots(restic, input.syncId, signal)
      const target = input.snapshotId ? snaps.find((s) => sameId(s.id, input.snapshotId!)) : snaps.find((s) => readTags(s.tags).kind === 'push')
      if (!target) throw new Error('Nothing has been pushed for that server yet')
      const meta = readTags(target.tags)
      if (!meta.mode || !meta.layout || !meta.platform || !meta.build) throw new Error('That snapshot was not made by FiveM Server Manager')
      if (store.servers.some((s) => s.sync?.id === input.syncId)) {
        throw new Error('A server on this machine already syncs with that id; pull into it instead')
      }

      const name = input.name.trim() || meta.name || input.syncId
      await fs.mkdir(paths.servers(), { recursive: true })
      const slug = await uniqueDir(paths.servers(), slugify(name))
      const root = join(paths.servers(), slug)
      const dataRoot = meta.layout === 'data' ? join(root, 'server-data') : meta.layout === 'txdata' ? join(root, 'txData') : root
      await fs.mkdir(join(root, 'logs'), { recursive: true })
      let added = false
      try {
        const result = await restoreFolder({ restic, root: dataRoot, snapshotId: target.id, signal, onProgress: progress })

      const server: ServerConfig = {
        id: newId(),
        name,
        slug,
        root,
        platform: meta.platform,
        build: meta.build,
        mode: meta.mode,
        gamePort: input.gamePort,
        txAdminPort: input.txAdminPort,
        maxClients: meta.slots ?? 48,
        licenseKey: store.settings.defaultLicenseKey,
        database: null,
        autoStart: false,
        autoRestart: true,
        launchArgs: '',
        dataPath: meta.layout === 'data' ? dataRoot : null,
        txDataPath: meta.layout === 'txdata' ? dataRoot : null,
        txAdmin: null,
        shared: true,
        syncedAdmins: [],
        notes: '',
        createdAt: Date.now(),
        lastStartedAt: null,
        sync: { id: input.syncId, remoteId: input.remoteId, includeDatabase: meta.hasDatabase },
        syncState: null
      }

      if (input.importDatabase && meta.hasDatabase) {
        phase('Importing the database')
        await database.ensureRunning()
        server.database = await database.uniqueName(dbName(name))
        server.database = await this.importInto(server, dataRoot, task)
      }
      await this.clearSyncDir(dataRoot)

      phase("Applying this machine's settings")
      await this.applyLocal(server, dataRoot, meta.layout, target.paths[0])

      if (!artifacts.isInstalled(server.platform, server.build)) {
        phase(`Downloading FXServer build ${server.build}`)
        await artifacts.install(server.platform, server.build)
      }

        store.addServer(server)
        added = true
        await this.recordState(server.id, dataRoot, target.id, 'clone')
        toast({ kind: 'success', title: `${name} cloned`, description: `${result.filesRestored} files from ${target.hostname}` })
        return store.server(server.id)
      } finally {
        // A clone that did not finish leaves nothing behind.
        if (!added) await fs.rm(root, { recursive: true, force: true }).catch(() => undefined)
      }
    })
  }
}

export const sync = new SyncService()
