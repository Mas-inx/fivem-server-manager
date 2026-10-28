import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { createWriteStream, existsSync, promises as fs, type WriteStream } from 'node:fs'
import { join } from 'node:path'
import { hashSync } from 'bcryptjs'
import type { LogLine, PlayerInfo, ResourceAction, ServerConfig, ServerRuntime } from '@shared/types'
import { broadcast, toast } from '../broadcast'
import { store } from '../store'
import { errorMessage, killTree, LineSplitter, RingBuffer, sleep, splitArgs, throttle } from '../util'
import { artifacts } from './artifacts'
import { syncCfg } from './cfg'
import { database } from './database'
import { checkPorts } from './ports'
import { serverFiles } from './server-files'
import { applyShared, MANAGED_CFG, syncTxAdmins } from './shared'
import { stats } from './stats'
import { txadmin, type TxCommand } from './txadmin'

const MAX_LOG_LINES = 5000
const CRASH_WINDOW = 10 * 60 * 1000
const MAX_CRASHES = 4

interface Proc {
  child: ChildProcessWithoutNullStreams | null
  runtime: ServerRuntime
  logs: RingBuffer<LogLine>
  pending: LogLine[]
  logFile: WriteStream | null
  stopRequested: boolean
  restartTimer: NodeJS.Timeout | null
  crashTimes: number[]
  exited: Promise<void> | null
}

const blankRuntime = (id: string): ServerRuntime => ({
  id,
  status: 'stopped',
  pid: null,
  startedAt: null,
  exitCode: null,
  gameOnline: false,
  txAdminOnline: false,
  players: 0,
  maxPlayers: 0,
  cpu: 0,
  memory: 0,
  crashes: 0,
  message: null
})

async function probe(url: string, timeout = 1500): Promise<Response | null> {
  try {
    return await fetch(url, { signal: AbortSignal.timeout(timeout) })
  } catch {
    return null
  }
}

class Runner {
  private procs = new Map<string, Proc>()
  private pollTimer: NodeJS.Timeout | null = null
  private tick = 0
  private logFlushTimer: NodeJS.Timeout | null = null

  private emitRuntime = throttle(() => broadcast('event:runtime', this.runtimeMap()), 200)

  private proc(id: string): Proc {
    let p = this.procs.get(id)
    if (!p) {
      p = {
        child: null,
        runtime: blankRuntime(id),
        logs: new RingBuffer(MAX_LOG_LINES),
        pending: [],
        logFile: null,
        stopRequested: false,
        restartTimer: null,
        crashTimes: [],
        exited: null
      }
      this.procs.set(id, p)
    }
    return p
  }

  runtimeMap(): Record<string, ServerRuntime> {
    const out: Record<string, ServerRuntime> = {}
    for (const s of store.servers) out[s.id] = this.proc(s.id).runtime
    return out
  }

  isRunning(id: string): boolean {
    return this.procs.get(id)?.child != null
  }

  anyRunning(): boolean {
    return [...this.procs.values()].some((p) => p.child)
  }

  runningCount(): number {
    return [...this.procs.values()].filter((p) => p.child).length
  }

  logs(id: string): LogLine[] {
    return this.proc(id).logs.all()
  }

  clearLogs(id: string): void {
    this.proc(id).logs.clear()
  }

  private log(id: string, text: string, stream: LogLine['stream']): void {
    const p = this.proc(id)
    const line: LogLine = { t: Date.now(), text, stream }
    if (stream !== 'sys') this.detectProblems(id, text)
    p.logs.push(line)
    p.pending.push(line)
    p.logFile?.write(`${text}\n`)
    if (!this.logFlushTimer) this.logFlushTimer = setTimeout(() => this.flushLogs(), 80)
  }

  /** Turns well-known fatal log lines into a readable message on the server. */
  private detectProblems(id: string, text: string): void {
    const p = this.proc(id)
    if (p.runtime.message) return
    let message: string | null = null
    if (/Could not authenticate server license key/i.test(text)) {
      message = 'The license key is missing or invalid. Add one from portal.cfx.re in the server settings.'
    } else if (/Could not bind on|address already in use/i.test(text)) {
      message = 'The game port is already in use by another program.'
    }
    if (!message) return
    this.set(id, { message })
    const server = store.servers.find((s) => s.id === id)
    toast({ kind: 'error', title: server ? `${server.name} cannot start` : 'Server cannot start', description: message })
  }

  private sys(id: string, text: string): void {
    this.log(id, text, 'sys')
  }

  private flushLogs(): void {
    this.logFlushTimer = null
    for (const [id, p] of this.procs) {
      if (!p.pending.length) continue
      broadcast('event:logs', { id, lines: p.pending })
      p.pending = []
    }
  }

  private set(id: string, patch: Partial<ServerRuntime>): void {
    Object.assign(this.proc(id).runtime, patch)
    this.emitRuntime()
  }

  async start(id: string): Promise<void> {
    const server = store.server(id)
    const p = this.proc(id)
    if (p.child) return
    if (p.restartTimer) {
      clearTimeout(p.restartTimer)
      p.restartTimer = null
    }
    this.set(id, { status: 'starting', message: null, exitCode: null })
    try {
      await this.launch(server, p)
    } catch (err) {
      this.set(id, { status: 'stopped', message: errorMessage(err) })
      this.sys(id, `Could not start: ${errorMessage(err)}`)
      throw err
    }
  }

  private async launch(server: ServerConfig, p: Proc): Promise<void> {
    const id = server.id
    if (!artifacts.isInstalled(server.platform, server.build)) {
      this.sys(id, `Build ${server.build} is not installed yet, downloading it now`)
      await artifacts.install(server.platform, server.build)
    }
    const exe = artifacts.exePath(server.platform, server.build)
    if (!exe) throw new Error(`Build ${server.build} could not be found`)

    const ports = server.mode === 'txadmin' ? [server.gamePort, server.txAdminPort] : [server.gamePort]
    for (const check of await checkPorts(ports, id)) {
      if (!check.free) {
        throw new Error(`Port ${check.port} is already in use${check.usedBy ? ` by ${check.usedBy}` : ''}`)
      }
    }

    if (server.database) {
      await database.ensureRunning().catch((err) => this.sys(id, `Database: ${errorMessage(err)}`))
    }

    const files = await serverFiles(server)
    let cwd: string
    let args: string[]
    const env: NodeJS.ProcessEnv = { ...process.env }

    if (server.mode === 'standalone') {
      if (!files.dataPath || !files.cfgPath || !existsSync(files.cfgPath)) {
        throw new Error('server.cfg was not found in the server data folder')
      }
      const cfg = await fs.readFile(files.cfgPath, 'utf8')
      const synced = syncCfg(cfg, {
        gamePort: server.gamePort,
        maxClients: server.maxClients,
        licenseKey: server.licenseKey || undefined,
        connectionString: server.database ? database.connectionString(server.database) : undefined
      })
      if (synced !== cfg) await fs.writeFile(files.cfgPath, synced, 'utf8')
      await applyShared(server).catch((e) => this.sys(id, `Could not write ${MANAGED_CFG}: ${errorMessage(e)}`))
      cwd = files.dataPath
      args = ['+exec', 'server.cfg', ...splitArgs(server.launchArgs)]
    } else {
      const txData = files.txDataPath!
      await fs.mkdir(txData, { recursive: true })
      await syncTxAdmins(store.server(id)).catch((e) => this.sys(id, `Could not sync txAdmin admins: ${errorMessage(e)}`))
      await applyShared(server).catch(() => false)
      cwd = server.root
      args = splitArgs(server.launchArgs)
      Object.assign(env, {
        TXHOST_DATA_PATH: txData,
        TXHOST_TXA_PORT: String(server.txAdminPort),
        TXHOST_FXS_PORT: String(server.gamePort),
        TXHOST_GAME_NAME: 'fivem',
        TXHOST_PROVIDER_NAME: 'Server Manager',
        TXHOST_IGNORE_DEPRECATED_CONFIGS: 'true'
      })
      // txAdmin refuses to boot when this variable is malformed, so only pass real keys through.
      if (/^cfxk_\w+_\w+$/.test(server.licenseKey)) env.TXHOST_DEFAULT_CFXKEY = server.licenseKey
      if (server.database) {
        const c = database.connection()
        Object.assign(env, {
          TXHOST_DEFAULT_DBHOST: c.host,
          TXHOST_DEFAULT_DBPORT: String(c.port),
          TXHOST_DEFAULT_DBUSER: c.user,
          TXHOST_DEFAULT_DBPASS: c.password,
          TXHOST_DEFAULT_DBNAME: server.database
        })
      }
      // Only seed the admin account on first boot; afterwards txAdmin owns admins.json.
      if (server.txAdmin && !existsSync(join(txData, 'admins.json'))) {
        env.TXHOST_DEFAULT_ACCOUNT = `${server.txAdmin.username}::${hashSync(server.txAdmin.password, 11)}`
      }
    }

    await fs.mkdir(join(server.root, 'logs'), { recursive: true })
    const day = new Date().toISOString().slice(0, 10)
    p.logFile = createWriteStream(join(server.root, 'logs', `console-${day}.log`), { flags: 'a' })
    p.stopRequested = false

    this.sys(id, `Starting ${server.name} on build ${server.build}`)
    const child = spawn(exe, args, { cwd, env, windowsHide: true })
    p.child = child
    store.updateServer(id, { lastStartedAt: Date.now() })
    this.set(id, { pid: child.pid ?? null, startedAt: Date.now(), cpu: 0, memory: 0 })

    const out = new LineSplitter()
    const err = new LineSplitter()
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (d: string) => out.push(d).forEach((l) => this.log(id, l, 'out')))
    child.stderr.on('data', (d: string) => err.push(d).forEach((l) => this.log(id, l, 'err')))
    child.stdin.on('error', () => undefined)

    p.exited = new Promise((resolve) => {
      child.on('exit', (code) => {
        out.flush().forEach((l) => this.log(id, l, 'out'))
        err.flush().forEach((l) => this.log(id, l, 'err'))
        this.onExit(id, code)
        resolve()
      })
    })
    child.on('error', (e) => this.sys(id, `Process error: ${e.message}`))
    this.ensurePolling()
  }

  private onExit(id: string, code: number | null): void {
    const p = this.proc(id)
    p.child = null
    txadmin.forget(id)
    p.logFile?.end()
    p.logFile = null
    const reset = {
      pid: null,
      exitCode: code,
      gameOnline: false,
      txAdminOnline: false,
      players: 0,
      cpu: 0,
      memory: 0
    }
    const server = store.servers.find((s) => s.id === id)
    if (p.stopRequested || !server) {
      this.sys(id, 'Server stopped')
      this.set(id, { ...reset, status: 'stopped', startedAt: null })
      return
    }

    const crashes = p.runtime.crashes + 1
    this.sys(id, `Server exited unexpectedly (code ${code ?? 'unknown'})`)
    this.set(id, { ...reset, status: 'crashed', crashes, message: p.runtime.message ?? `Exited with code ${code ?? 'unknown'}` })

    if (!server.autoRestart) {
      toast({ kind: 'error', title: `${server.name} crashed`, description: `Exit code ${code ?? 'unknown'}` })
      return
    }
    const now = Date.now()
    p.crashTimes = [...p.crashTimes.filter((t) => now - t < CRASH_WINDOW), now]
    if (p.crashTimes.length > MAX_CRASHES) {
      this.sys(id, 'Crashed too often in the last 10 minutes, automatic restart is paused')
      toast({ kind: 'error', title: `${server.name} keeps crashing`, description: 'Automatic restart has been paused.' })
      return
    }
    this.sys(id, 'Restarting in 5 seconds')
    p.restartTimer = setTimeout(() => {
      p.restartTimer = null
      void this.start(id).catch(() => undefined)
    }, 5000)
  }

  async stop(id: string): Promise<void> {
    const p = this.proc(id)
    if (p.restartTimer) {
      clearTimeout(p.restartTimer)
      p.restartTimer = null
      if (!p.child) this.set(id, { status: 'stopped' })
    }
    const child = p.child
    if (!child) return
    p.stopRequested = true
    this.set(id, { status: 'stopping' })
    const server = store.servers.find((s) => s.id === id)
    if (server?.mode === 'standalone') {
      // Ask FXServer to shut down cleanly first so resources can save their state.
      try {
        child.stdin.write('quit "Server is shutting down"\n')
      } catch {
        /* ignore */
      }
      const exited = await Promise.race([p.exited?.then(() => true), sleep(8000).then(() => false)])
      if (exited) return
    }
    if (child.pid) await killTree(child.pid)
    await Promise.race([p.exited, sleep(10000)])
  }

  async restart(id: string): Promise<void> {
    await this.stop(id)
    await this.start(id)
  }

  async stopAll(): Promise<void> {
    await Promise.all([...this.procs.keys()].map((id) => this.stop(id).catch(() => undefined)))
  }

  command(id: string, command: string): void {
    const p = this.proc(id)
    if (!p.child) throw new Error('The server is not running')
    this.sys(id, `> ${command}`)
    p.child.stdin.write(`${command}\n`)
  }

  /** Refreshes, starts, stops or restarts resources on a running server. */
  async resourceAction(id: string, action: ResourceAction, name?: string): Promise<void> {
    const server = store.server(id)
    const p = this.proc(id)
    if (!p.child) throw new Error('The server is not running')
    if (action !== 'refresh' && !name) throw new Error('Choose a resource')
    if (name && !/^[\w.\-[\]]+$/.test(name)) throw new Error('That is not a valid resource name')
    const label = action === 'refresh' ? 'refresh' : `${action} ${name}`
    if (server.mode === 'standalone') {
      this.command(id, label)
      return
    }
    if (!p.runtime.gameOnline) throw new Error('The game server is not running inside txAdmin yet')
    const reply = await txadmin.command(server, `${action}_res` as TxCommand, name ?? '')
    this.sys(id, `txAdmin: ${reply ?? label}`)
  }

  async players(id: string): Promise<PlayerInfo[]> {
    const server = store.server(id)
    if (!this.proc(id).runtime.gameOnline) return []
    const res = await probe(`http://127.0.0.1:${server.gamePort}/players.json`, 2500)
    if (!res?.ok) return []
    const list = (await res.json().catch(() => [])) as PlayerInfo[]
    return list.map((x) => ({ id: x.id, name: x.name, ping: x.ping, identifiers: x.identifiers ?? [] }))
  }

  forget(id: string): void {
    this.procs.delete(id)
  }

  private ensurePolling(): void {
    if (this.pollTimer) return
    this.pollTimer = setInterval(() => void this.poll(), 2000)
    void this.poll()
  }

  private async poll(): Promise<void> {
    const live = [...this.procs.entries()].filter(([, p]) => p.child)
    if (!live.length) {
      if (this.pollTimer) clearInterval(this.pollTimer)
      this.pollTimer = null
      return
    }
    this.tick++
    await stats.sample()
    await Promise.all(
      live.map(async ([id, p]) => {
        const server = store.servers.find((s) => s.id === id)
        if (!server || !p.child?.pid) return
        const usage = stats.tree(p.child.pid)
        const patch: Partial<ServerRuntime> = { cpu: usage.cpu, memory: usage.memory }

        if (this.tick % 2 === 1 || p.runtime.status === 'starting') {
          const dyn = await probe(`http://127.0.0.1:${server.gamePort}/dynamic.json`)
          if (dyn?.ok) {
            if (server.mode === 'txadmin' && !p.runtime.gameOnline) void applyShared(server).catch(() => false)
            const d = (await dyn.json().catch(() => null)) as { clients?: number; sv_maxclients?: string | number } | null
            patch.gameOnline = true
            patch.players = Number(d?.clients ?? 0)
            patch.maxPlayers = Number(d?.sv_maxclients ?? server.maxClients)
          } else {
            patch.gameOnline = false
            patch.players = 0
          }
          if (server.mode === 'txadmin') {
            patch.txAdminOnline = (await probe(`http://127.0.0.1:${server.txAdminPort}/`)) !== null
          }
        }

        if (p.runtime.status === 'starting') {
          const ready = server.mode === 'txadmin' ? patch.txAdminOnline : patch.gameOnline
          const slow = p.runtime.startedAt && Date.now() - p.runtime.startedAt > 120000
          if (ready || slow) {
            patch.status = 'running'
            if (ready) this.sys(id, server.mode === 'txadmin' ? 'txAdmin is ready' : 'Server is accepting connections')
          }
        }
        this.set(id, patch)
      })
    )
  }

  /** Re-applies universal admins and shared config to every server after they change. */
  async applySharedEverywhere(): Promise<void> {
    for (const server of store.servers) {
      const written = await applyShared(server).catch(() => false)
      const p = this.procs.get(server.id)
      if (!p?.child) {
        await syncTxAdmins(server).catch(() => undefined)
      } else if (written && server.mode === 'standalone' && server.shared) {
        // New principals apply right away; removed ones are gone after the next restart.
        this.command(server.id, `exec ${MANAGED_CFG}`)
      }
    }
  }

  dispose(): void {
    if (this.pollTimer) clearInterval(this.pollTimer)
    stats.dispose()
  }
}

export const runner = new Runner()
