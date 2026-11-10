import { app, safeStorage } from 'electron'
import { spawn, type ChildProcess } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createReadStream, existsSync, promises as fs } from 'node:fs'
import { hostname, networkInterfaces } from 'node:os'
import { join } from 'node:path'
import { connect } from 'node:tls'
import { hashSync } from 'bcryptjs'
import type { HubSetupInput, HubStatus, SyncRemote } from '@shared/types'
import { broadcast } from '../broadcast'
import { download, unzip } from '../net'
import { paths } from '../paths'
import { store } from '../store'
import { tasks } from '../tasks'
import { dirSize, errorMessage, id as newId, killTree, LineSplitter, password, readJson, RingBuffer, sleep, throttle, writeFileAtomic } from '../util'
import { firewallOpenFor, openFirewallPort } from '../sync/firewall'
import { REST_SERVER_SHA256, REST_SERVER_URL, REST_SERVER_VERSION } from '../sync/pin'
import { encodeConnectionCode, type RemoteSecrets } from '../sync/target'
import { createCa, createServerCert } from '../sync/x509'
import { portFree } from './ports'
import { sync } from './sync'

/** What the hub keeps between runs. Passwords and the CA key are sealed with safeStorage. */
interface HubFile {
  user: string
  password: string
  repoPassword: string
  caName: string
  caCert: string
  caKey: string
  /** The remote on this machine that points at its own hub. */
  remoteId: string
}

const PRIVATE = /^(10\.|127\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.)/

function seal(v: string): string {
  if (!safeStorage.isEncryptionAvailable()) throw new Error('Windows encryption is not available, so the hub cannot store its keys safely')
  return safeStorage.encryptString(v).toString('base64')
}
const unseal = (v: string): string => safeStorage.decryptString(Buffer.from(v, 'base64'))

/**
 * This machine as the sync hub: restic's rest-server over HTTPS with its own certificate
 * authority, a generated user and password, and optional append-only mode. The manager starts it,
 * stops it with the app, and hands out the connection code the other machines paste.
 */
class Hub {
  private child: ChildProcess | null = null
  private starting = false
  private stopping = false
  private lastError: string | null = null
  private logs = new RingBuffer<string>(200)
  private sizeCache: { at: number; bytes: number | null } = { at: 0, bytes: null }
  private firewallCache: { at: number; port: number; open: boolean | null } = { at: 0, port: 0, open: null }

  emit = throttle(() => void this.status().then((s) => broadcast('event:hub', s)), 300)

  private dir(): string {
    return join(app.getPath('userData'), 'sync-hub')
  }

  private binPath(): string {
    if (process.env.FSM_REST_SERVER_BIN) return process.env.FSM_REST_SERVER_BIN
    return join(paths.library(), 'tools', `rest-server-${REST_SERVER_VERSION}`, 'rest-server.exe')
  }

  private async ensureBinary(onStatus: (s: string) => void): Promise<string> {
    const bin = this.binPath()
    if (existsSync(bin)) return bin
    const zip = join(paths.downloads(), `rest-server_${REST_SERVER_VERSION}_windows_amd64.zip`)
    onStatus('Downloading rest-server')
    await download(REST_SERVER_URL, zip)
    const hash = await new Promise<string>((resolve, reject) => {
      const h = createHash('sha256')
      createReadStream(zip)
        .on('data', (d) => h.update(d))
        .on('error', reject)
        .on('end', () => resolve(h.digest('hex')))
    })
    if (hash !== REST_SERVER_SHA256) {
      await fs.rm(zip, { force: true })
      throw new Error('The rest-server download did not match its published checksum and was discarded')
    }
    const staging = join(paths.downloads(), `rest-server-${Date.now()}`)
    await unzip(zip, staging)
    const find = async (d: string): Promise<string | null> => {
      for (const e of await fs.readdir(d, { withFileTypes: true })) {
        const p = join(d, e.name)
        if (e.isDirectory()) {
          const f = await find(p)
          if (f) return f
        } else if (e.name.toLowerCase() === 'rest-server.exe') return p
      }
      return null
    }
    const exe = await find(staging)
    if (!exe) throw new Error('The rest-server download has no rest-server.exe')
    await fs.mkdir(join(bin, '..'), { recursive: true })
    await fs.rename(exe, bin)
    await fs.rm(staging, { recursive: true, force: true })
    await fs.rm(zip, { force: true })
    return bin
  }

  private async load(): Promise<HubFile | null> {
    return readJson<HubFile>(join(this.dir(), 'hub.json'))
  }

  /** IPv4 addresses of this machine, public ones first. */
  addresses(): string[] {
    const all = Object.values(networkInterfaces())
      .flat()
      .filter((i): i is NonNullable<typeof i> => !!i && i.family === 'IPv4' && !i.internal)
      .map((i) => i.address)
    return [...all.filter((a) => !PRIVATE.test(a)), ...all.filter((a) => PRIVATE.test(a))]
  }

  private async freePort(from: number): Promise<number> {
    for (let p = from; p < from + 100; p++) if (await portFree(p)) return p
    throw new Error('No free port found for the hub')
  }

  /** Defaults for the setup form: the saved settings, or sensible ones for a new hub. */
  async suggest(): Promise<HubSetupInput> {
    const s = store.settings.syncHub
    return {
      port: s.enabled ? s.port : await this.freePort(s.port || 8000),
      dataPath: s.dataPath || join(paths.library(), 'sync-hub'),
      publicAddress: s.publicAddress || this.addresses()[0] || hostname(),
      appendOnly: s.appendOnly,
      autoStart: s.autoStart
    }
  }

  async status(): Promise<HubStatus> {
    const settings = store.settings.syncHub
    const configured = settings.enabled && !!(await this.load())
    let diskFree: number | null = null
    if (configured) {
      if (Date.now() - this.sizeCache.at > 30_000) {
        this.sizeCache = { at: Date.now(), bytes: existsSync(settings.dataPath) ? await dirSize(settings.dataPath) : null }
      }
      const st = await fs.statfs(settings.dataPath).catch(() => null)
      diskFree = st ? st.bavail * st.bsize : null
      if (Date.now() - this.firewallCache.at > 15_000 || this.firewallCache.port !== settings.port) {
        this.firewallCache = { at: Date.now(), port: settings.port, open: await firewallOpenFor(settings.port) }
      }
    }
    return {
      version: REST_SERVER_VERSION,
      configured,
      running: !!this.child && !this.starting,
      starting: this.starting,
      settings,
      addresses: this.addresses(),
      firewallOpen: configured ? this.firewallCache.open : null,
      repoBytes: configured ? this.sizeCache.bytes : null,
      diskFree,
      error: this.lastError
    }
  }

  /** Sets the hub up, or changes its settings: certificates, login, the process, the repository and this machine's remote. */
  async setup(input: HubSetupInput): Promise<HubStatus> {
    if (!Number.isInteger(input.port) || input.port < 1024 || input.port > 65535) throw new Error('Pick a port between 1024 and 65535')
    if (!input.dataPath.trim()) throw new Error('Choose a folder for the hub data')
    if (!input.publicAddress.trim()) throw new Error('Enter the address other machines use to reach this one')
    const publicAddress = input.publicAddress.trim().replace(/^https?:\/\//i, '').replace(/[/:].*$/, '')

    await tasks.run('Setting up the sync hub', async (task) => {
      await this.stop()
      await this.ensureBinary((detail) => task.update({ detail }))
      await fs.mkdir(this.dir(), { recursive: true })
      await fs.mkdir(input.dataPath, { recursive: true })

      let file = await this.load()
      if (!file) {
        const caName = `FiveM Server Manager hub on ${store.settings.syncMachineName || hostname()}`
        const ca = createCa(caName)
        file = {
          user: 'fsm',
          password: seal(password(32)),
          repoPassword: seal(password(40)),
          caName,
          caCert: ca.certPem,
          caKey: seal(ca.keyPem),
          remoteId: newId()
        }
      }
      task.update({ detail: 'Creating the certificate' })
      const server = createServerCert({ commonName: file.caName, certPem: file.caCert, keyPem: unseal(file.caKey) }, [
        publicAddress,
        ...this.addresses(),
        hostname(),
        'localhost',
        '127.0.0.1',
        '::1'
      ])
      // rest-server reads these files itself; the chain lets clients that trust the CA verify it.
      await fs.writeFile(join(this.dir(), 'tls.crt'), server.certPem + file.caCert, 'utf8')
      await fs.writeFile(join(this.dir(), 'tls.key'), server.keyPem, { encoding: 'utf8', mode: 0o600 })
      await fs.writeFile(join(this.dir(), '.htpasswd'), `${file.user}:${hashSync(unseal(file.password), 10)}\n`, 'utf8')
      await writeFileAtomic(join(this.dir(), 'hub.json'), JSON.stringify(file, null, 2))

      store.updateSettings({ syncHub: { enabled: true, ...input, dataPath: input.dataPath.trim(), publicAddress } })
      task.update({ detail: 'Starting rest-server' })
      await this.start()
    })

    // The hub is also a remote on its own machine, reached locally.
    const file = (await this.load())!
    const local: SyncRemote = {
      id: file.remoteId,
      name: 'Hub on this machine',
      kind: 'rest',
      endpoint: `https://127.0.0.1:${input.port}`,
      bucket: '',
      prefix: '',
      region: '',
      host: '',
      port: input.port,
      user: file.user,
      path: '',
      keyFile: '',
      certPem: file.caCert,
      createdAt: Date.now()
    }
    await sync.connectRemote(local, this.secrets(file))
    this.sizeCache.at = 0
    this.emit()
    return this.status()
  }

  private secrets(file: HubFile): RemoteSecrets {
    return { accessKeyId: '', secretAccessKey: '', repoPassword: unseal(file.repoPassword), restPassword: unseal(file.password) }
  }

  async start(): Promise<void> {
    if (this.child) return
    const s = store.settings.syncHub
    if (!s.enabled || !(await this.load())) throw new Error('Set up the hub first')
    if (!(await portFree(s.port))) throw new Error(`Port ${s.port} is already in use`)
    const bin = await this.ensureBinary(() => undefined)
    this.starting = true
    this.lastError = null
    this.emit()
    const args = [
      '--path', s.dataPath,
      '--listen', `:${s.port}`,
      '--tls', '--tls-cert', join(this.dir(), 'tls.crt'), '--tls-key', join(this.dir(), 'tls.key'),
      '--htpasswd-file', join(this.dir(), '.htpasswd')
    ]
    if (s.appendOnly) args.push('--append-only')
    const child = spawn(bin, args, { windowsHide: true })
    this.child = child
    const lines = new LineSplitter()
    const onData = (d: Buffer): void => lines.push(d.toString('utf8')).forEach((l) => this.logs.push(l))
    child.stdout?.on('data', onData)
    child.stderr?.on('data', onData)
    child.on('exit', (code) => {
      this.child = null
      this.starting = false
      if (!this.stopping) this.lastError = this.logs.all().slice(-1)[0] ?? `rest-server exited with code ${code}`
      this.emit()
    })
    try {
      for (let i = 0; i < 50 && this.child; i++) {
        if (await this.answers(s.port)) break
        await sleep(200)
      }
      if (!this.child) throw new Error(this.lastError ?? 'rest-server did not start')
    } finally {
      this.starting = false
      this.emit()
    }
  }

  /** True once something accepts a TLS connection on the port. */
  private answers(port: number): Promise<boolean> {
    return new Promise((resolve) => {
      const sock = connect({ host: '127.0.0.1', port, rejectUnauthorized: false, timeout: 1000 }, () => {
        sock.end()
        resolve(true)
      })
      sock.on('error', () => resolve(false))
      sock.on('timeout', () => {
        sock.destroy()
        resolve(false)
      })
    })
  }

  async stop(): Promise<void> {
    const child = this.child
    if (!child?.pid) return
    this.stopping = true
    const exited = new Promise<void>((r) => child.once('exit', () => r()))
    await killTree(child.pid)
    await Promise.race([exited, sleep(5000)])
    this.stopping = false
    this.emit()
  }

  /** Stops the hub and forgets its settings. The repository and its data stay where they are. */
  async disable(): Promise<HubStatus> {
    await this.stop()
    store.updateSettings({ syncHub: { ...store.settings.syncHub, enabled: false } })
    return this.status()
  }

  /** The code other machines paste: the public address, the login, the CA certificate and the repo password. */
  async connectionCode(): Promise<string> {
    const file = await this.load()
    const s = store.settings.syncHub
    if (!file || !s.enabled) throw new Error('Set up the hub first')
    const remote: SyncRemote = {
      id: '',
      name: `Hub on ${store.settings.syncMachineName || hostname()}`,
      kind: 'rest',
      endpoint: `${s.publicAddress.includes(':') ? `[${s.publicAddress}]` : s.publicAddress}:${s.port}`,
      bucket: '',
      prefix: '',
      region: '',
      host: '',
      port: s.port,
      user: file.user,
      path: '',
      keyFile: '',
      certPem: file.caCert,
      createdAt: Date.now()
    }
    return encodeConnectionCode(remote, this.secrets(file))
  }

  async openFirewall(): Promise<HubStatus> {
    await openFirewallPort(store.settings.syncHub.port)
    this.firewallCache.at = 0
    return this.status()
  }

  async autoStart(): Promise<void> {
    const s = store.settings.syncHub
    if (!s.enabled || !s.autoStart) return
    await this.start().catch((e) => {
      this.lastError = errorMessage(e)
      this.emit()
    })
  }

  async dispose(): Promise<void> {
    await this.stop()
  }
}

export const hub = new Hub()
