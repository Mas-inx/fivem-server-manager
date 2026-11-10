/**
 * End-to-end sync through a hub: restic's rest-server on this machine with the app's own CA and
 * server certificate, an htpasswd login and append-only mode, exactly as the hub service runs it.
 * Run with: npm run test:e2e   (FSM_REST_SERVER_BIN / FSM_RESTIC_BIN to use local binaries)
 */
import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync, promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { hashSync } from 'bcryptjs'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { SyncRemote } from '../../src/shared/types'
import { DEFAULT_IGNORE } from '../../src/main/sync/ignore'
import { pushFolder, restoreFolder } from '../../src/main/sync/engine'
import { checkHub } from '../../src/main/sync/hub-check'
import { Restic } from '../../src/main/sync/restic'
import { resticTarget, type RemoteSecrets } from '../../src/main/sync/target'
import { createCa, createServerCert } from '../../src/main/sync/x509'
import { fmt, getBinary, MB, seconds, sha256, writeRandom } from './helpers'

const WORK = join(tmpdir(), `fsm-hub-e2e-${Date.now()}`)
const PORT = 18000 + Math.floor(Math.random() * 1000)
const A = join(WORK, 'pc', 'server-data')
const B = join(WORK, 'rec', 'server-data')
const report: Record<string, string> = {}

const remote = (certPem: string): SyncRemote => ({
  id: 'hub',
  name: 'Hub',
  kind: 'rest',
  endpoint: `127.0.0.1:${PORT}`,
  bucket: '',
  prefix: '',
  region: '',
  host: '',
  port: PORT,
  user: 'fsm',
  path: '',
  keyFile: '',
  certPem,
  createdAt: 0
})
const secrets: RemoteSecrets = { accessKeyId: '', secretAccessKey: '', repoPassword: 'repo-password-e2e', restPassword: 'hub-password-e2e' }
const tags = ['fsm', 'sync:hub-e2e', 'kind:push', 'mode:standalone', 'layout:data']

describe('sync through a hub (rest-server, TLS, append-only)', () => {
  let server: ChildProcess
  let restic: Restic
  let resticBin: string
  let caFile: string
  let first = ''
  let second = ''

  beforeAll(async () => {
    await fs.mkdir(join(WORK, 'hub'), { recursive: true })
    resticBin = await getBinary('restic')
    const rs = await getBinary('rest-server')
    const ca = createCa('FSM hub e2e CA')
    const leaf = createServerCert({ ...ca, commonName: 'FSM hub e2e CA' }, ['127.0.0.1', 'localhost'])
    caFile = join(WORK, 'hub', 'ca.pem')
    await fs.writeFile(caFile, ca.certPem)
    await fs.writeFile(join(WORK, 'hub', 'tls.crt'), leaf.certPem + ca.certPem)
    await fs.writeFile(join(WORK, 'hub', 'tls.key'), leaf.keyPem)
    await fs.writeFile(join(WORK, 'hub', '.htpasswd'), `fsm:${hashSync(secrets.restPassword!, 10)}\n`)
    server = spawn(rs, [
      '--path', join(WORK, 'hub', 'data'),
      '--listen', `127.0.0.1:${PORT}`,
      '--tls', '--tls-cert', join(WORK, 'hub', 'tls.crt'), '--tls-key', join(WORK, 'hub', 'tls.key'),
      '--htpasswd-file', join(WORK, 'hub', '.htpasswd'),
      '--append-only'
    ], { windowsHide: true })
    await new Promise((r) => setTimeout(r, 1500))
    restic = new Restic(resticBin, resticTarget(remote(ca.certPem), secrets, caFile), join(WORK, 'cache'))
    await restic.init()

    // A 400 MB server: scripts plus stream files.
    await fs.mkdir(A, { recursive: true })
    await fs.writeFile(join(A, '.fxsyncignore'), DEFAULT_IGNORE)
    await fs.writeFile(join(A, 'server.cfg'), 'endpoint_add_tcp "0.0.0.0:30120"\nsv_maxclients 48\n')
    for (let r = 0; r < 20; r++) {
      await fs.mkdir(join(A, `resources/[core]/res_${r}`), { recursive: true })
      for (let f = 0; f < 20; f++) await fs.writeFile(join(A, `resources/[core]/res_${r}/f${f}.lua`), `print(${r}, ${f})\n`.repeat(50))
    }
    await fs.mkdir(join(A, 'resources/[maps]/m/stream'), { recursive: true })
    for (let i = 0; i < 8; i++) await writeRandom(join(A, `resources/[maps]/m/stream/s${i}.ytd`), 50 * MB)
  })

  afterAll(async () => {
    server?.kill()
    console.log('\n=== Hub end-to-end report ===')
    for (const [k, v] of Object.entries(report)) console.log(`${k.padEnd(30)} ${v}`)
    await fs.writeFile(join(tmpdir(), 'fsm-hub-e2e-report.json'), JSON.stringify(report, null, 2)).catch(() => undefined)
    await new Promise((r) => setTimeout(r, 500))
    await fs.rm(WORK, { recursive: true, force: true }).catch(() => undefined)
  })

  it('pushes over HTTPS to the hub, then only changes', async () => {
    let t = Date.now()
    const p1 = await pushFolder({ restic, root: A, host: 'pc', tags, tmpDir: join(WORK, 'tmp') })
    first = p1.snapshotId
    report['First push (400 MB)'] = `${seconds(Date.now() - t)}, ${fmt(p1.dataAddedPacked)} stored`
    await fs.appendFile(join(A, 'resources/[core]/res_1/f1.lua'), 'print("edit")\n')
    t = Date.now()
    const p2 = await pushFolder({ restic, root: A, host: 'pc', tags, parent: p1.snapshotId, tmpDir: join(WORK, 'tmp') })
    report['Second push (small edit)'] = `${seconds(Date.now() - t)}, ${fmt(p2.dataAddedPacked)} uploaded`
    second = p2.snapshotId
    expect(p2.filesChanged).toBe(1)
    expect(p2.dataAddedPacked).toBeLessThan(MB)
  })

  it('pulls on a second machine through the hub', async () => {
    const t = Date.now()
    await restoreFolder({ restic, root: B, snapshotId: second })
    report['Clone through the hub'] = seconds(Date.now() - t)
    expect(await sha256(join(B, 'resources/[maps]/m/stream/s3.ytd'))).toBe(await sha256(join(A, 'resources/[maps]/m/stream/s3.ytd')))
    expect(await fs.readFile(join(B, 'resources/[core]/res_1/f1.lua'), 'utf8')).toContain('edit')
  })

  it('refuses deleting snapshots in append-only mode', async () => {
    await expect(restic.run(['forget', first])).rejects.toThrow()
    const left = await restic.run(['snapshots'])
    expect(left.some((s) => String(s.id) === first)).toBe(true)
  })

  it('trusts only the hub certificate it was given, and says so in seconds', async () => {
    const other = createCa('Someone else')
    const t = Date.now()
    const res = await checkHub(`https://127.0.0.1:${PORT}/`, 'fsm', secrets.restPassword!, other.certPem)
    expect(res).toMatchObject({ ok: false, reason: 'certificate' })
    const good = await checkHub(`https://127.0.0.1:${PORT}/`, 'fsm', secrets.restPassword!, await fs.readFile(caFile, 'utf8'))
    expect(good).toEqual({ ok: true, repository: true })
    report['Wrong certificate detected'] = seconds(Date.now() - t)
  })

  it('rejects a wrong hub password and reports a closed port', async () => {
    const ca = await fs.readFile(caFile, 'utf8')
    expect(await checkHub(`https://127.0.0.1:${PORT}/`, 'fsm', 'nope-nope', ca)).toMatchObject({ ok: false, reason: 'login' })
    expect(await checkHub(`https://127.0.0.1:${PORT + 1}/`, 'fsm', secrets.restPassword!, ca)).toMatchObject({ ok: false, reason: 'unreachable' })
    expect(existsSync(join(WORK, 'hub', 'data', 'config'))).toBe(true)
  })
})
