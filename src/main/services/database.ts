import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { existsSync, promises as fs } from 'node:fs'
import { join } from 'node:path'
import mysql from 'mysql2/promise'
import type { DatabaseInfo, DbConnection, DbStatus, LogLine } from '@shared/types'
import { formatBytes } from '@shared/format'
import { broadcast } from '../broadcast'
import { download, fetchJson, unzip } from '../net'
import { paths } from '../paths'
import { store } from '../store'
import { tasks } from '../tasks'
import { errorMessage, killTree, LineSplitter, password, RingBuffer, sleep, throttle } from '../util'
import { portFree } from './ports'

const MARIADB_SERIES = '11.8'
const SYSTEM_SCHEMAS = new Set(['information_schema', 'mysql', 'performance_schema', 'sys'])

interface MariaRelease {
  releases: Record<string, { release_id: string; files: { file_name: string; file_download_url: string }[] }>
}

export function assertDbName(name: string): void {
  if (!/^[A-Za-z0-9_]{1,64}$/.test(name)) {
    throw new Error('Database names may only contain letters, numbers and underscores')
  }
}

class Database {
  private child: ChildProcessWithoutNullStreams | null = null
  private starting = false
  private stopping = false
  private lastError: string | null = null
  private serverVersion: string | null = null
  private reachable = false
  private logs = new RingBuffer<LogLine>(1500)
  private pool: mysql.Pool | null = null
  private poolKey = ''

  emit = throttle(() => broadcast('event:db', this.status()), 150)

  connection(): DbConnection {
    const db = store.settings.db
    if (db.mode === 'external') return db.external
    return { host: '127.0.0.1', port: db.managedPort, user: 'root', password: db.managedPassword }
  }

  connectionString(database: string): string {
    const c = this.connection()
    const auth = c.password ? `${encodeURIComponent(c.user)}:${encodeURIComponent(c.password)}` : encodeURIComponent(c.user)
    return `mysql://${auth}@${c.host}:${c.port}/${database}?charset=utf8mb4`
  }

  private binDir(): string | null {
    const v = store.settings.db.managedVersion
    if (!v) return null
    const dir = join(paths.mariadb(), v, 'bin')
    return existsSync(dir) ? dir : null
  }

  private daemon(): string | null {
    const bin = this.binDir()
    if (!bin) return null
    for (const exe of ['mariadbd.exe', 'mysqld.exe']) if (existsSync(join(bin, exe))) return join(bin, exe)
    return null
  }

  isManagedInstalled(): boolean {
    return this.daemon() !== null && existsSync(join(paths.mariadbData(), 'my.ini'))
  }

  status(): DbStatus {
    const db = store.settings.db
    const managed = db.mode === 'managed'
    const c = this.connection()
    return {
      mode: db.mode,
      installed: managed ? this.isManagedInstalled() : true,
      running: managed ? this.child !== null && !this.starting : this.reachable,
      starting: this.starting,
      reachable: this.reachable,
      version: db.managedVersion?.match(/mariadb-([\d.]+)/)?.[1] ?? null,
      serverVersion: this.serverVersion,
      port: c.port,
      host: c.host,
      dataDir: managed ? paths.mariadbData() : null,
      error: this.lastError
    }
  }

  getLogs(): LogLine[] {
    return this.logs.all()
  }

  private log(text: string, stream: LogLine['stream'] = 'out'): void {
    this.logs.push({ t: Date.now(), text, stream })
  }

  private getPool(): mysql.Pool {
    const c = this.connection()
    const key = `${c.host}:${c.port}:${c.user}:${c.password}`
    if (this.pool && key === this.poolKey) return this.pool
    void this.pool?.end().catch(() => undefined)
    this.pool = mysql.createPool({
      host: c.host,
      port: c.port,
      user: c.user,
      password: c.password,
      connectionLimit: 4,
      connectTimeout: 4000,
      multipleStatements: false
    })
    this.poolKey = key
    return this.pool
  }

  async query<T = unknown>(sql: string, params: unknown[] = []): Promise<T> {
    try {
      const [rows] = await this.getPool().query(sql, params)
      this.reachable = true
      return rows as T
    } catch (err) {
      const code = (err as { code?: string }).code
      if (code === 'ECONNREFUSED' || code === 'ETIMEDOUT' || code === 'ER_ACCESS_DENIED_ERROR') {
        this.reachable = false
        this.emit()
        throw new Error(
          code === 'ER_ACCESS_DENIED_ERROR'
            ? 'The database rejected the username or password'
            : 'Could not connect to the database server'
        )
      }
      throw err
    }
  }

  /** Re-checks reachability; used after settings change and on startup. */
  async probe(): Promise<void> {
    try {
      const rows = await this.query<{ v: string }[]>('SELECT VERSION() AS v')
      this.serverVersion = rows[0]?.v ?? null
      this.lastError = null
    } catch (err) {
      this.serverVersion = null
      if (store.settings.db.mode === 'external') this.lastError = errorMessage(err)
    }
    this.emit()
  }

  async test(c: DbConnection): Promise<{ ok: boolean; version?: string; error?: string }> {
    try {
      const conn = await mysql.createConnection({ ...c, connectTimeout: 4000 })
      const [rows] = await conn.query('SELECT VERSION() AS v')
      await conn.end()
      return { ok: true, version: (rows as { v: string }[])[0]?.v }
    } catch (err) {
      return { ok: false, error: errorMessage(err) }
    }
  }

  async install(): Promise<void> {
    await tasks.run('MariaDB', async (task) => {
      task.update({ detail: 'Finding the latest release' })
      const info = await fetchJson<MariaRelease>(`https://downloads.mariadb.org/rest-api/mariadb/${MARIADB_SERIES}/latest/`)
      const release = Object.values(info.releases)[0]
      const file = release?.files.find((f) => /winx64\.zip$/.test(f.file_name))
      if (!file) throw new Error('No Windows build of MariaDB was found')
      const zip = join(paths.downloads(), file.file_name)
      await download(file.file_download_url.replace(/^http:/, 'https:'), zip, ({ received, total, speed }) =>
        task.update({
          progress: total ? (received / total) * 0.8 : null,
          detail: `${formatBytes(received)}${total ? ` of ${formatBytes(total)}` : ''} · ${formatBytes(speed)}/s`
        })
      )
      task.update({ detail: 'Unpacking', progress: 0.8 })
      await unzip(zip, paths.mariadb(), (f) => task.update({ progress: 0.8 + f * 0.15 }))
      await fs.rm(zip, { force: true })
      const folder = file.file_name.replace(/\.zip$/, '')
      const bin = join(paths.mariadb(), folder, 'bin')

      const dataDir = paths.mariadbData()
      // Another MySQL (XAMPP, Laragon…) often owns 3306 already; quietly move to the next free port.
      if (!(await portFree(store.settings.db.managedPort))) {
        const port = await this.nextFreePort(store.settings.db.managedPort + 1)
        store.updateSettings({ db: { ...store.settings.db, managedPort: port } })
        this.log(`Port in use, MariaDB will listen on ${port}`, 'sys')
      }
      const settings = store.settings.db
      let rootPassword = settings.managedPassword
      if (!existsSync(join(dataDir, 'my.ini'))) {
        task.update({ detail: 'Initialising data directory', progress: 0.96 })
        rootPassword = password(20)
        await fs.mkdir(dataDir, { recursive: true })
        const installer = ['mariadb-install-db.exe', 'mysql_install_db.exe'].map((n) => join(bin, n)).find(existsSync)
        if (!installer) throw new Error('mariadb-install-db.exe is missing from the download')
        await this.exec(installer, [`--datadir=${dataDir}`, `--port=${settings.managedPort}`, `--password=${rootPassword}`])
      }
      store.updateSettings({
        db: { ...store.settings.db, managedVersion: folder, managedPassword: rootPassword, mode: 'managed' }
      })
    })
    this.emit()
    await this.start()
  }

  private exec(file: string, args: string[]): Promise<void> {
    return new Promise((resolve, reject) => {
      const p = spawn(file, args, { windowsHide: true })
      let out = ''
      p.stdout.on('data', (d) => (out += d))
      p.stderr.on('data', (d) => (out += d))
      p.on('error', reject)
      p.on('exit', (code) => {
        for (const line of out.split(/\r?\n/).filter(Boolean)) this.log(line)
        if (code === 0) resolve()
        else reject(new Error(out.trim().split(/\r?\n/).pop() || `Exited with code ${code}`))
      })
    })
  }

  async start(): Promise<void> {
    if (store.settings.db.mode !== 'managed' || this.child) return
    const exe = this.daemon()
    if (!exe) throw new Error('MariaDB is not installed yet')
    const port = store.settings.db.managedPort
    if (!(await portFree(port))) {
      this.lastError = `Port ${port} is already in use. Another MySQL or MariaDB (XAMPP, Laragon…) is probably running.`
      this.emit()
      throw new Error(this.lastError)
    }
    this.lastError = null
    this.starting = true
    this.emit()
    const child = spawn(
      exe,
      [`--defaults-file=${join(paths.mariadbData(), 'my.ini')}`, `--port=${port}`, '--bind-address=127.0.0.1', '--console'],
      { windowsHide: true }
    )
    this.child = child
    const split = new LineSplitter()
    const onData = (chunk: Buffer): void => {
      for (const line of split.push(chunk.toString('utf8'))) if (line.trim()) this.log(line)
    }
    child.stdout.on('data', onData)
    child.stderr.on('data', onData)
    child.on('exit', (code) => {
      this.child = null
      this.starting = false
      this.reachable = false
      this.serverVersion = null
      if (!this.stopping) this.lastError = `MariaDB stopped unexpectedly (code ${code})`
      this.stopping = false
      this.log(`Process exited with code ${code}`, 'sys')
      this.emit()
    })

    const deadline = Date.now() + 30000
    while (Date.now() < deadline && this.child) {
      await sleep(500)
      try {
        const rows = await this.query<{ v: string }[]>('SELECT VERSION() AS v')
        this.serverVersion = rows[0]?.v ?? null
        break
      } catch {
        /* still booting */
      }
    }
    this.starting = false
    if (!this.reachable && this.child) this.lastError = 'MariaDB started but is not accepting connections'
    this.emit()
    if (!this.child) throw new Error(this.lastError ?? 'MariaDB failed to start')
  }

  private async nextFreePort(from: number): Promise<number> {
    const taken = new Set(store.servers.flatMap((sv) => [sv.gamePort, sv.txAdminPort]))
    for (let port = from; port < from + 200; port++) {
      if (!taken.has(port) && (await portFree(port))) return port
    }
    throw new Error('No free port found for MariaDB')
  }

  /** Moves the managed server to the next free port and starts it. */
  async startOnFreePort(): Promise<number> {
    const port = await this.nextFreePort(store.settings.db.managedPort + 1)
    store.updateSettings({ db: { ...store.settings.db, managedPort: port } })
    this.lastError = null
    await this.start()
    return port
  }

  async ensureRunning(): Promise<void> {
    if (store.settings.db.mode === 'managed' && this.isManagedInstalled() && !this.child) await this.start()
  }

  async stop(): Promise<void> {
    const child = this.child
    if (!child) return
    this.stopping = true
    this.emit()
    try {
      await this.query('SHUTDOWN')
    } catch {
      /* fall through to kill */
    }
    const exited = await Promise.race([
      new Promise<boolean>((r) => child.once('exit', () => r(true))),
      sleep(15000).then(() => false)
    ])
    if (!exited && child.pid) await killTree(child.pid)
    await this.pool?.end().catch(() => undefined)
    this.pool = null
  }

  async list(): Promise<DatabaseInfo[]> {
    const rows = await this.query<{ name: string; size: string | number; tables: number }[]>(
      `SELECT s.SCHEMA_NAME AS name,
              COALESCE(SUM(t.DATA_LENGTH + t.INDEX_LENGTH), 0) AS size,
              COUNT(t.TABLE_NAME) AS tables
         FROM information_schema.SCHEMATA s
         LEFT JOIN information_schema.TABLES t ON t.TABLE_SCHEMA = s.SCHEMA_NAME
        GROUP BY s.SCHEMA_NAME
        ORDER BY s.SCHEMA_NAME`
    )
    return rows
      .filter((r) => !SYSTEM_SCHEMAS.has(r.name))
      .map((r) => ({
        name: r.name,
        size: Number(r.size),
        tables: Number(r.tables),
        usedBy: store.servers.filter((s) => s.database === r.name).map((s) => s.id)
      }))
  }

  async exists(name: string): Promise<boolean> {
    const rows = await this.query<unknown[]>('SELECT 1 FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = ?', [name])
    return rows.length > 0
  }

  async uniqueName(base: string): Promise<string> {
    let name = base
    let n = 2
    while (await this.exists(name)) name = `${base}_${n++}`
    return name
  }

  async create(name: string): Promise<void> {
    assertDbName(name)
    await this.query(`CREATE DATABASE IF NOT EXISTS \`${name}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`)
  }

  async drop(name: string): Promise<void> {
    assertDbName(name)
    await this.query(`DROP DATABASE IF EXISTS \`${name}\``)
  }

  /** Copies every table and view from one schema into a new one, using plain SQL. */
  async clone(from: string, to: string, onProgress?: (fraction: number) => void): Promise<void> {
    assertDbName(from)
    assertDbName(to)
    await this.create(to)
    const conn = await this.getPool().getConnection()
    try {
      await conn.query('SET FOREIGN_KEY_CHECKS = 0')
      const [tables] = await conn.query(
        'SELECT TABLE_NAME AS name, TABLE_TYPE AS type FROM information_schema.TABLES WHERE TABLE_SCHEMA = ?',
        [from]
      )
      const list = tables as { name: string; type: string }[]
      const base = list.filter((t) => t.type === 'BASE TABLE')
      let done = 0
      for (const t of base) {
        await conn.query(`CREATE TABLE \`${to}\`.\`${t.name}\` LIKE \`${from}\`.\`${t.name}\``)
        await conn.query(`INSERT INTO \`${to}\`.\`${t.name}\` SELECT * FROM \`${from}\`.\`${t.name}\``)
        onProgress?.(++done / Math.max(1, list.length))
      }
      for (const v of list.filter((t) => t.type === 'VIEW')) {
        const [rows] = await conn.query(`SHOW CREATE VIEW \`${from}\`.\`${v.name}\``)
        const ddl = (rows as Record<string, string>[])[0]?.['Create View']
        if (!ddl) continue
        const body = ddl.replace(/^CREATE .*? VIEW /i, 'CREATE VIEW ').replaceAll(`\`${from}\`.`, `\`${to}\`.`)
        await conn.query(`USE \`${to}\``)
        await conn.query(body).catch(() => undefined)
      }
      await conn.query('SET FOREIGN_KEY_CHECKS = 1')
    } finally {
      conn.release()
    }
  }

  heidiSqlPath(): string | null {
    const candidates = [
      join(process.env['ProgramFiles'] ?? 'C:\\Program Files', 'HeidiSQL', 'heidisql.exe'),
      join(process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)', 'HeidiSQL', 'heidisql.exe'),
      join(process.env['LOCALAPPDATA'] ?? '', 'Programs', 'HeidiSQL', 'heidisql.exe')
    ]
    return candidates.find((p) => existsSync(p)) ?? null
  }

  openHeidi(database?: string): void {
    const exe = this.heidiSqlPath()
    if (!exe) throw new Error('HeidiSQL is not installed')
    const c = this.connection()
    const args = [`--host=${c.host}`, `--port=${c.port}`, `--user=${c.user}`, `--password=${c.password}`]
    if (database) args.push(`--databases=${database}`)
    spawn(exe, args, { detached: true, stdio: 'ignore' }).unref()
  }

  async dispose(): Promise<void> {
    await this.stop()
    await this.pool?.end().catch(() => undefined)
  }
}

export const database = new Database()
