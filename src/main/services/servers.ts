import { shell } from 'electron'
import { existsSync, promises as fs, statSync } from 'node:fs'
import { basename, dirname, join, relative } from 'node:path'
import type {
  CreateServerInput,
  DuplicateServerInput,
  ImportProbe,
  ImportServerInput,
  ResourceInfo,
  ServerConfig,
  ServerPatch
} from '@shared/types'
import { download, unzip } from '../net'
import { paths } from '../paths'
import { store } from '../store'
import { tasks, type TaskHandle } from '../tasks'
import { dbName, id as newId, password, readJson, slugify, uniqueDir, writeFileAtomic } from '../util'
import { artifacts } from './artifacts'
import { cfgTemplate, ensuredResources, retargetDatabase, setEnsured, syncCfg } from './cfg'
import { database } from './database'
import { suggestPorts } from './ports'
import { runner } from './runner'
import { safeResolve, serverFiles, txProfiles, txServerPaths } from './server-files'

const CFX_SERVER_DATA = 'https://github.com/citizenfx/cfx-server-data/archive/refs/heads/master.zip'
const WEEK = 7 * 24 * 60 * 60 * 1000

/** Folder names never copied when duplicating; they are rebuilt by FXServer or are per-instance. */
const SKIP_ON_COPY = new Set(['cache', 'logs', 'crashes'])

async function defaultResources(dest: string, task: TaskHandle): Promise<void> {
  const zip = join(paths.downloads(), 'cfx-server-data.zip')
  const fresh = existsSync(zip) && Date.now() - statSync(zip).mtimeMs < WEEK
  if (!fresh) {
    task.update({ detail: 'Downloading default resources' })
    await download(CFX_SERVER_DATA, zip)
  }
  const staging = join(paths.downloads(), `cfx-server-data-${Date.now()}`)
  await unzip(zip, staging)
  const [top] = await fs.readdir(staging)
  await fs.cp(join(staging, top, 'resources'), join(dest, 'resources'), { recursive: true })
  await fs.rm(staging, { recursive: true, force: true })
}

async function countFiles(dir: string): Promise<number> {
  let n = 0
  const walk = async (d: string): Promise<void> => {
    for (const e of await fs.readdir(d, { withFileTypes: true }).catch(() => [])) {
      if (e.isDirectory()) {
        if (!SKIP_ON_COPY.has(e.name.toLowerCase())) await walk(join(d, e.name))
      } else n++
    }
  }
  await walk(dir)
  return n
}

async function copyTree(src: string, dest: string, onProgress: (copied: number) => void): Promise<void> {
  let copied = 0
  const walk = async (from: string, to: string): Promise<void> => {
    await fs.mkdir(to, { recursive: true })
    for (const e of await fs.readdir(from, { withFileTypes: true })) {
      const a = join(from, e.name)
      const b = join(to, e.name)
      if (e.isDirectory()) {
        if (!SKIP_ON_COPY.has(e.name.toLowerCase())) await walk(a, b)
      } else if (e.isFile()) {
        await fs.copyFile(a, b)
        if (++copied % 25 === 0) onProgress(copied)
      }
    }
  }
  await walk(src, dest)
  onProgress(copied)
}

const toSlash = (p: string): string => p.replace(/\\/g, '/').replace(/\/+$/, '')

/** Rewrites absolute paths in txAdmin's config so a copied txData points at its own server data. */
async function rebaseTxData(txData: string, fromRoot: string, toRoot: string): Promise<void> {
  const from = toSlash(fromRoot).toLowerCase()
  const rewrite = (value: unknown): unknown => {
    if (typeof value === 'string') {
      const s = toSlash(value)
      if (s.toLowerCase().startsWith(from)) {
        const rebased = toSlash(toRoot) + s.slice(from.length)
        return value.includes('\\') ? rebased.replace(/\//g, '\\') : rebased + (value.endsWith('/') ? '/' : '')
      }
      return value
    }
    if (Array.isArray(value)) return value.map(rewrite)
    if (value && typeof value === 'object') {
      return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, rewrite(v)]))
    }
    return value
  }
  for (const profile of await txProfiles(txData)) {
    const file = join(txData, profile, 'config.json')
    const cfg = await readJson<unknown>(file)
    if (cfg) await writeFileAtomic(file, JSON.stringify(rewrite(cfg), null, 2))
  }
}

/** Writes the values the manager owns (port, slots, key, database) into a standalone server.cfg. */
async function syncStandaloneCfg(server: ServerConfig): Promise<void> {
  if (server.mode !== 'standalone') return
  const files = await serverFiles(server)
  if (!files.cfgPath || !existsSync(files.cfgPath)) return
  const cfg = await fs.readFile(files.cfgPath, 'utf8')
  const next = syncCfg(cfg, {
    gamePort: server.gamePort,
    maxClients: server.maxClients,
    licenseKey: server.licenseKey || undefined,
    connectionString: server.database ? database.connectionString(server.database) : undefined
  })
  if (next !== cfg) await fs.writeFile(files.cfgPath, next, 'utf8')
}

function isInsideLibrary(path: string): boolean {
  const rel = relative(paths.servers(), path)
  return !!rel && !rel.startsWith('..') && !rel.includes(':')
}

class Servers {
  list(): ServerConfig[] {
    return store.servers
  }

  async create(input: CreateServerInput): Promise<ServerConfig> {
    const name = input.name.trim()
    if (!name) throw new Error('Give the server a name')
    await fs.mkdir(paths.servers(), { recursive: true })
    const slug = await uniqueDir(paths.servers(), slugify(name))
    const root = join(paths.servers(), slug)

    return tasks.run(`Creating ${name}`, async (task) => {
      if (!artifacts.isInstalled(input.platform, input.build)) {
        task.update({ detail: `Waiting for build ${input.build}` })
        await artifacts.install(input.platform, input.build)
      }
      await fs.mkdir(join(root, 'logs'), { recursive: true })

      let databaseName: string | null = null
      if (input.database.kind !== 'none') {
        task.update({ detail: 'Preparing database' })
        await database.ensureRunning()
        databaseName = input.database.name
        if (input.database.kind === 'create') await database.create(databaseName)
      }

      const server: ServerConfig = {
        id: newId(),
        name,
        slug,
        root,
        platform: input.platform,
        build: input.build,
        mode: input.mode,
        gamePort: input.gamePort,
        txAdminPort: input.txAdminPort,
        maxClients: input.maxClients,
        licenseKey: input.licenseKey.trim(),
        database: databaseName,
        autoStart: input.autoStart,
        autoRestart: input.autoRestart,
        launchArgs: '',
        dataPath: null,
        txDataPath: null,
        txAdmin: null,
        notes: '',
        createdAt: Date.now(),
        lastStartedAt: null
      }

      if (input.mode === 'standalone') {
        const dataPath = join(root, 'server-data')
        await fs.mkdir(dataPath, { recursive: true })
        await defaultResources(dataPath, task)
        task.update({ detail: 'Writing server.cfg' })
        await fs.writeFile(
          join(dataPath, 'server.cfg'),
          cfgTemplate({
            name,
            gamePort: input.gamePort,
            maxClients: input.maxClients,
            licenseKey: server.licenseKey,
            connectionString: databaseName ? database.connectionString(databaseName) : null
          }),
          'utf8'
        )
        server.dataPath = dataPath
      } else {
        await fs.mkdir(join(root, 'txData'), { recursive: true })
        server.txAdmin = { username: 'admin', password: password(14) }
      }

      store.addServer(server)
      return server
    })
  }

  async probeImport(path: string): Promise<ImportProbe> {
    const probe: ImportProbe = {
      path,
      mode: null,
      dataPath: null,
      cfgFound: false,
      txDataFound: false,
      suggestedName: basename(path)
    }
    const hasTxProfile = async (dir: string): Promise<boolean> => (await txProfiles(dir)).length > 0
    if (await hasTxProfile(path)) {
      probe.mode = 'txadmin'
      probe.txDataFound = true
      probe.suggestedName = basename(dirname(path))
    } else if (existsSync(join(path, 'txData')) && (await hasTxProfile(join(path, 'txData')))) {
      probe.mode = 'txadmin'
      probe.txDataFound = true
    } else if (existsSync(join(path, 'server.cfg'))) {
      probe.mode = 'standalone'
      probe.dataPath = path
      probe.cfgFound = true
    } else if (existsSync(join(path, 'server-data', 'server.cfg'))) {
      probe.mode = 'standalone'
      probe.dataPath = join(path, 'server-data')
      probe.cfgFound = true
    }
    return probe
  }

  async import(input: ImportServerInput): Promise<ServerConfig> {
    const probe = await this.probeImport(input.path)
    if (!probe.mode) throw new Error('No server.cfg or txData was found in that folder')
    const name = input.name.trim() || probe.suggestedName
    await fs.mkdir(paths.servers(), { recursive: true })
    const slug = await uniqueDir(paths.servers(), slugify(name))
    const root = join(paths.servers(), slug)

    return tasks.run(`Importing ${name}`, async (task) => {
      await fs.mkdir(join(root, 'logs'), { recursive: true })
      let dataPath: string | null = null
      let txDataPath: string | null = null
      const txSource = probe.mode === 'txadmin' ? ((await txProfiles(input.path)).length ? input.path : join(input.path, 'txData')) : null

      if (probe.mode === 'standalone') {
        if (input.copy) {
          const total = await countFiles(probe.dataPath!)
          dataPath = join(root, 'server-data')
          await copyTree(probe.dataPath!, dataPath, (n) =>
            task.update({ progress: total ? n / total : null, detail: `${n} of ${total} files` })
          )
        } else dataPath = probe.dataPath
      } else if (txSource) {
        if (input.copy) {
          const total = await countFiles(txSource)
          await copyTree(txSource, join(root, 'txData'), (n) =>
            task.update({ progress: total ? n / total : null, detail: `${n} of ${total} files` })
          )
          await rebaseTxData(join(root, 'txData'), txSource, join(root, 'txData'))
        } else txDataPath = txSource
      }

      const server: ServerConfig = {
        id: newId(),
        name,
        slug,
        root,
        platform: input.platform,
        build: input.build,
        mode: probe.mode!,
        gamePort: input.gamePort,
        txAdminPort: input.txAdminPort,
        maxClients: 48,
        licenseKey: '',
        database: null,
        autoStart: false,
        autoRestart: true,
        launchArgs: '',
        dataPath,
        txDataPath,
        txAdmin: null,
        notes: '',
        createdAt: Date.now(),
        lastStartedAt: null
      }
      store.addServer(server)
      return server
    })
  }

  async duplicate(input: DuplicateServerInput): Promise<ServerConfig> {
    const src = store.server(input.sourceId)
    if (runner.isRunning(src.id)) throw new Error('Stop the server before duplicating it')
    const name = input.name.trim() || `${src.name} copy`
    const slug = await uniqueDir(paths.servers(), slugify(name))
    const root = join(paths.servers(), slug)
    const srcFiles = await serverFiles(src)

    return tasks.run(`Duplicating ${src.name}`, async (task) => {
      task.update({ detail: 'Counting files' })
      const ports = await suggestPorts()
      let dataPath: string | null = null
      let txDataPath: string | null = null

      if (src.mode === 'standalone') {
        const from = srcFiles.dataPath!
        const total = await countFiles(from)
        dataPath = join(root, 'server-data')
        await copyTree(from, dataPath, (n) => task.update({ progress: total ? (n / total) * 0.8 : null, detail: `Copying files · ${n} of ${total}` }))
      } else {
        const from = srcFiles.txDataPath!
        const to = join(root, 'txData')
        // Server data deployed inside the old server folder is copied along with txData.
        const external = srcFiles.dataPath && !toSlash(srcFiles.dataPath).toLowerCase().startsWith(toSlash(src.root).toLowerCase())
        const total = (await countFiles(from)) + (external && srcFiles.dataPath ? await countFiles(srcFiles.dataPath) : 0)
        let base = 0
        await copyTree(from, to, (n) => {
          base = n
          task.update({ progress: total ? (n / total) * 0.8 : null, detail: `Copying files · ${n} of ${total}` })
        })
        if (src.txDataPath) await rebaseTxData(to, src.txDataPath, to)
        else await rebaseTxData(to, src.root, root)
        if (external && srcFiles.dataPath) {
          const target = join(root, 'server-data')
          await copyTree(srcFiles.dataPath, target, (n) =>
            task.update({ progress: total ? ((base + n) / total) * 0.8 : null, detail: `Copying files · ${base + n} of ${total}` })
          )
          await rebaseTxData(to, srcFiles.dataPath, target)
        }
      }

      let databaseName: string | null = null
      if (input.database === 'share') databaseName = src.database
      else if (input.database === 'clone' || input.database === 'empty') {
        await database.ensureRunning()
        databaseName = await database.uniqueName(dbName(name))
        if (input.database === 'clone' && src.database) {
          task.update({ detail: `Cloning database ${src.database}`, progress: 0.85 })
          await database.clone(src.database, databaseName, (f) => task.update({ progress: 0.85 + f * 0.15 }))
        } else await database.create(databaseName)
      }

      const server: ServerConfig = {
        ...src,
        id: newId(),
        name,
        slug,
        root,
        gamePort: ports.gamePort,
        txAdminPort: ports.txAdminPort,
        database: databaseName,
        dataPath,
        txDataPath,
        autoStart: false,
        createdAt: Date.now(),
        lastStartedAt: null
      }

      if (src.database && databaseName && databaseName !== src.database) {
        const files = await serverFiles(server)
        if (files.cfgPath && existsSync(files.cfgPath)) {
          const cfg = await fs.readFile(files.cfgPath, 'utf8')
          await fs.writeFile(files.cfgPath, retargetDatabase(cfg, src.database, databaseName), 'utf8')
        }
      }

      await syncStandaloneCfg(server)
      store.addServer(server)
      return server
    })
  }

  async update(id: string, patch: ServerPatch): Promise<ServerConfig> {
    const server = store.server(id)
    if (patch.name !== undefined && !patch.name.trim()) throw new Error('Name cannot be empty')
    for (const key of ['gamePort', 'txAdminPort'] as const) {
      const port = patch[key]
      if (port === undefined) continue
      if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Ports must be between 1024 and 65535')
      const clash = store.servers.find((s) => s.id !== id && (s.gamePort === port || s.txAdminPort === port))
      if (clash) throw new Error(`Port ${port} is already assigned to ${clash.name}`)
    }
    const nextGame = patch.gamePort ?? server.gamePort
    const nextTx = patch.txAdminPort ?? server.txAdminPort
    if (server.mode === 'txadmin' && nextGame === nextTx) throw new Error('Game and txAdmin ports must differ')
    if (patch.build && patch.build !== server.build) {
      void artifacts.install(patch.platform ?? server.platform, patch.build).catch(() => undefined)
    }
    const updated = store.updateServer(id, { ...patch, name: patch.name?.trim() ?? server.name })
    await syncStandaloneCfg(updated).catch(() => undefined)
    return updated
  }

  async remove(id: string, deleteFiles: boolean): Promise<void> {
    const server = store.server(id)
    await runner.stop(id)
    if (deleteFiles && existsSync(server.root)) {
      // Only folders the manager created are removed, and they go to the Recycle Bin.
      if (isInsideLibrary(server.root)) await shell.trashItem(server.root)
    }
    runner.forget(id)
    store.removeServer(id)
  }

  async listConfigs(id: string): Promise<string[]> {
    const files = await serverFiles(store.server(id))
    if (!files.dataPath) return []
    const out: string[] = []
    for (const e of await fs.readdir(files.dataPath, { withFileTypes: true }).catch(() => [])) {
      if (e.isFile() && /\.(cfg|txt)$/i.test(e.name)) out.push(e.name)
    }
    return out.sort((a, b) => (a === 'server.cfg' ? -1 : b === 'server.cfg' ? 1 : a.localeCompare(b)))
  }

  async readFile(id: string, path: string): Promise<string> {
    const files = await serverFiles(store.server(id))
    return fs.readFile(safeResolve(files, path), 'utf8')
  }

  async writeFile(id: string, path: string, content: string): Promise<void> {
    const files = await serverFiles(store.server(id))
    await writeFileAtomic(safeResolve(files, path), content)
  }

  async resources(id: string): Promise<ResourceInfo[]> {
    const files = await serverFiles(store.server(id))
    if (!files.dataPath) return []
    const cfg = files.cfgPath ? await fs.readFile(files.cfgPath, 'utf8').catch(() => '') : ''
    const state = ensuredResources(cfg)
    const out: ResourceInfo[] = []
    const walk = async (dir: string, category: string | null, chain: string[]): Promise<void> => {
      for (const e of await fs.readdir(dir, { withFileTypes: true }).catch(() => [])) {
        if (!e.isDirectory()) continue
        const p = join(dir, e.name)
        if (e.name.startsWith('[') && e.name.endsWith(']')) {
          await walk(p, e.name, [...chain, e.name])
        } else if (existsSync(join(p, 'fxmanifest.lua')) || existsSync(join(p, '__resource.lua'))) {
          const viaCategory = chain.find((c) => state.categories.has(c)) ?? null
          out.push({
            name: e.name,
            category,
            path: p,
            ensured: state.names.has(e.name) || viaCategory !== null,
            viaCategory: state.names.has(e.name) ? null : viaCategory
          })
        }
      }
    }
    await walk(join(files.dataPath, 'resources'), null, [])
    return out.sort((a, b) => (a.category ?? '').localeCompare(b.category ?? '') || a.name.localeCompare(b.name))
  }

  async setResourceEnsured(id: string, name: string, ensured: boolean): Promise<void> {
    const files = await serverFiles(store.server(id))
    if (!files.cfgPath) throw new Error('server.cfg was not found')
    const cfg = await fs.readFile(files.cfgPath, 'utf8')
    await fs.writeFile(files.cfgPath, setEnsured(cfg, name, ensured), 'utf8')
  }

  async connectionString(id: string): Promise<string | null> {
    const s = store.server(id)
    return s.database ? database.connectionString(s.database) : null
  }

  /** True once txAdmin has deployed a server, meaning its config points at real server data. */
  async txDeployed(id: string): Promise<boolean> {
    const s = store.server(id)
    return (await txServerPaths(s.txDataPath ?? join(s.root, 'txData'))) !== null
  }
}

export const servers = new Servers()
