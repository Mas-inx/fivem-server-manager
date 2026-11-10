/**
 * End-to-end sync between two server folders through a local-folder remote, with a fake server of
 * about FSM_E2E_GB gigabytes (default 1.5). Run with: npm run test:e2e
 *
 * FSM_RESTIC_BIN   use this restic.exe instead of downloading the pinned one
 * FSM_E2E_DIR      work folder (default: a new folder in %TEMP%)
 * FSM_E2E_KEEP=1   keep the work folder afterwards
 */
import { randomFillSync } from 'node:crypto'
import { existsSync, promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { classifySync } from '../../src/shared/sync'
import { diffSnapshots, listSnapshots, pushFolder, restoreFolder, type PushResult } from '../../src/main/sync/engine'
import { compileIgnore, DEFAULT_IGNORE } from '../../src/main/sync/ignore'
import { diffManifest, scanTree } from '../../src/main/sync/manifest'
import { applyLocalCfg } from '../../src/main/sync/overrides'
import { Restic, SyncCancelled } from '../../src/main/sync/restic'
import { fmt, getBinary, MB, seconds, sha256, writeRandom } from './helpers'

const GB = Number(process.env.FSM_E2E_GB ?? 1.5)
const WORK = process.env.FSM_E2E_DIR ?? join(tmpdir(), `fsm-sync-e2e-${Date.now()}`)
const A = join(WORK, 'pc', 'server-data')
const B = join(WORK, 'vps', 'server-data')
const REPO = join(WORK, 'remote')
const TMP = join(WORK, 'tmp')

const report: Record<string, string | number> = {}

/** A server-data folder shaped like a real one: many small scripts, a few hundred stream files, a cache. */
async function makeFakeServer(root: string, totalBytes: number): Promise<{ files: number; bytes: number }> {
  let files = 0
  let bytes = 0
  const write = async (rel: string, data: string | Buffer): Promise<void> => {
    const p = join(root, rel)
    await fs.mkdir(join(p, '..'), { recursive: true })
    await fs.writeFile(p, data)
    files++
    bytes += Buffer.byteLength(data)
  }
  await write(
    'server.cfg',
    [
      'endpoint_add_tcp "0.0.0.0:30120"',
      'endpoint_add_udp "0.0.0.0:30120"',
      'set mysql_connection_string "mysql://root:pcpass@127.0.0.1:3306/pc_db?charset=utf8mb4"',
      'sv_maxclients 48',
      'ensure [core]',
      'ensure [maps]',
      'sv_licenseKey "cfxk_pc_key"',
      ''
    ].join('\r\n')
  )
  await write('.fxsyncignore', DEFAULT_IGNORE)
  // ~6,000 script and UI files across 60 resources in two categories.
  for (let r = 0; r < 60; r++) {
    const res = `resources/[core]/res_${r}`
    await write(`${res}/fxmanifest.lua`, `fx_version 'cerulean'\ngame 'gta5'\nclient_script 'client/*.lua'\nserver_script 'server/*.lua'\n`)
    for (let f = 0; f < 100; f++) {
      const side = f % 2 ? 'client' : 'server'
      const body = Array.from({ length: 40 + (f % 60) }, (_, i) => `local value_${i} = GetHashKey("res_${r}_${f}_${i}") -- line ${i}`).join('\n')
      await write(`${res}/${side}/file_${f}.lua`, body)
    }
  }
  // Stream files of 4..40 MB until the size is reached.
  let n = 0
  while (bytes < totalBytes) {
    const size = Math.min(totalBytes - bytes, (4 + ((n * 7) % 37)) * MB)
    const rel = `resources/[maps]/map_${n % 12}/stream/asset_${n}.${n % 3 ? 'ytd' : 'ydr'}`
    await fs.mkdir(join(root, rel, '..'), { recursive: true })
    await writeRandom(join(root, rel), size)
    files++
    bytes += size
    n++
  }
  // Things the ignore list leaves out.
  await fs.mkdir(join(root, 'cache', 'files'), { recursive: true })
  await writeRandom(join(root, 'cache', 'files', 'resource.rpf'), 64 * MB)
  await fs.mkdir(join(root, 'logs'), { recursive: true })
  await fs.writeFile(join(root, 'logs', 'fxserver.log'), 'log line\n'.repeat(1000))
  return { files, bytes }
}

const local = (port: number, key: string, db: string) =>
  ({
    mode: 'standalone' as const,
    gamePort: port,
    txAdminPort: port + 10000,
    licenseKey: key,
    database: db,
    connectionString: `mysql://root:pw@127.0.0.1:3306/${db}?charset=utf8mb4`,
    db: { host: '127.0.0.1', port: 3306, user: 'root', password: 'pw' }
  }) satisfies Parameters<typeof applyLocalCfg>[1]

async function applyMachine(root: string, port: number, key: string, db: string): Promise<void> {
  const file = join(root, 'server.cfg')
  await fs.writeFile(file, applyLocalCfg(await fs.readFile(file, 'utf8'), local(port, key, db)))
}

const tags = (kind: string): string[] => ['fsm', 'sync:e2e-server', `kind:${kind}`, 'mode:standalone', 'layout:data']

describe(`sync end to end (${GB} GB fake server)`, () => {
  let restic: Restic
  let push1: PushResult
  let push2: PushResult
  const matcher = compileIgnore(DEFAULT_IGNORE)

  beforeAll(async () => {
    await fs.mkdir(WORK, { recursive: true })
    const bin = await getBinary('restic')
    restic = new Restic(bin, { repository: REPO, password: 'e2e-password-not-secret', env: {}, options: [] }, join(WORK, 'cache'))
    await restic.init()
    const t = Date.now()
    const made = await makeFakeServer(A, GB * 1024 * MB)
    report['Fake server'] = `${made.files} files, ${fmt(made.bytes)} (made in ${seconds(Date.now() - t)})`
  })

  afterAll(async () => {
    console.log('\n=== Sync end-to-end report ===')
    for (const [k, v] of Object.entries(report)) console.log(`${k.padEnd(34)} ${v}`)
    await fs.writeFile(join(tmpdir(), 'fsm-sync-e2e-report.json'), JSON.stringify(report, null, 2)).catch(() => undefined)
    if (!process.env.FSM_E2E_KEEP) await fs.rm(WORK, { recursive: true, force: true })
  })

  it('first push uploads the whole server, leaving ignored files out', async () => {
    const t = Date.now()
    push1 = await pushFolder({ restic, root: A, host: 'pc', tags: tags('push'), tmpDir: TMP })
    report['First push'] = `${seconds(Date.now() - t)}, ${fmt(push1.dataAddedPacked)} stored for ${fmt(push1.totalBytes)} of files`
    const snaps = await listSnapshots(restic, ['sync:e2e-server'])
    expect(snaps).toHaveLength(1)
    expect(push1.manifest.has('cache/files/resource.rpf')).toBe(false)
    const ls = await restic.run(['ls', push1.snapshotId])
    expect(ls.some((m) => String(m.path).startsWith('/cache'))).toBe(false)
    expect(ls.some((m) => String(m.path).startsWith('/logs'))).toBe(false)
  })

  it('clones onto the second machine and keeps its own settings', async () => {
    const t = Date.now()
    await restoreFolder({ restic, root: B, snapshotId: push1.snapshotId })
    await applyMachine(B, 30130, 'cfxk_vps_key', 'vps_db')
    report['Clone to second folder'] = seconds(Date.now() - t)
    const a = await scanTree(A, matcher)
    const b = await scanTree(B, matcher)
    const differences = diffManifest(a.files, b.files).filter((c) => c.path !== 'server.cfg')
    expect(differences).toEqual([])
    const big = [...a.files].sort((x, y) => y[1].size - x[1].size)[0][0]
    expect(await sha256(join(B, big))).toBe(await sha256(join(A, big)))
    const cfg = await fs.readFile(join(B, 'server.cfg'), 'utf8')
    expect(cfg).toContain('0.0.0.0:30130')
    expect(cfg).toContain('cfxk_vps_key')
    expect(cfg).toContain('/vps_db?')
  })

  it('second push after a small edit uploads only a little', async () => {
    // Edit a script, add a file, delete a file, and change 1 MB in the middle of a stream file.
    await fs.appendFile(join(A, 'resources/[core]/res_3/client/file_1.lua'), '\nprint("edited on the pc")\n')
    await fs.writeFile(join(A, 'resources/[core]/res_3/client/new_file.lua'), 'print("new")\n')
    await fs.rm(join(A, 'resources/[core]/res_4/server/file_2.lua'))
    const stream = join(A, 'resources/[maps]/map_1/stream/asset_1.ytd')
    const st = await fs.stat(stream)
    const fh = await fs.open(stream, 'r+')
    await fh.write(randomFillSync(Buffer.alloc(MB)), 0, MB, Math.floor(st.size / 2))
    await fh.close()

    const t = Date.now()
    push2 = await pushFolder({ restic, root: A, host: 'pc', tags: tags('push'), parent: push1.snapshotId, tmpDir: TMP })
    report['Second push (small edit)'] = `${seconds(Date.now() - t)}, ${fmt(push2.dataAddedPacked)} uploaded (${push2.filesNew} new, ${push2.filesChanged} changed, ${push2.filesUnmodified} unchanged)`
    expect(push2.filesChanged).toBe(2)
    expect(push2.filesNew).toBe(1)
    expect(push2.dataAddedPacked).toBeLessThan(8 * MB)
  })

  it('warns when both copies changed and lists the files', async () => {
    const before = await scanTree(B, matcher)
    // The second machine edits something too, and drops a file into its ignored cache.
    await fs.writeFile(join(B, 'resources/[core]/stray.lua'), 'print("only on the vps")\n')
    await fs.mkdir(join(B, 'cache'), { recursive: true })
    await fs.writeFile(join(B, 'cache', 'keep.bin'), 'ignored, must survive a pull')
    const after = await scanTree(B, matcher)
    const localChanges = diffManifest(before.files, after.files)
    const remoteChanges = await diffSnapshots(restic, push1.snapshotId, push2.snapshotId)
    expect(localChanges).toEqual([{ path: 'resources/[core]/stray.lua', change: 'added' }])
    expect(remoteChanges.map((c) => `${c.change} ${c.path}`).sort()).toEqual([
      'added resources/[core]/res_3/client/new_file.lua',
      'modified resources/[core]/res_3/client/file_1.lua',
      'modified resources/[maps]/map_1/stream/asset_1.ytd',
      'removed resources/[core]/res_4/server/file_2.lua'
    ])
    expect(classifySync({ base: push1.snapshotId, latest: push2.snapshotId, local: localChanges })).toBe('diverged')
    expect(classifySync({ base: push1.snapshotId, latest: push2.snapshotId, local: [] })).toBe('remote-changed')
  })

  it('pulls: restore point first, then only changed files, stray files removed, ignored files kept', async () => {
    let t = Date.now()
    const pre = await pushFolder({ restic, root: B, host: 'vps', tags: tags('pre-pull'), parent: push1.snapshotId, tmpDir: TMP })
    report['Restore point before pull'] = `${seconds(Date.now() - t)}, ${fmt(pre.dataAddedPacked)} uploaded`
    t = Date.now()
    const res = await restoreFolder({ restic, root: B, snapshotId: push2.snapshotId })
    await applyMachine(B, 30130, 'cfxk_vps_key', 'vps_db')
    report['Pull'] = `${seconds(Date.now() - t)}, ${res.filesRestored} files written, ${res.filesSkipped} unchanged, ${res.filesDeleted} deleted`

    expect(existsSync(join(B, 'resources/[core]/stray.lua'))).toBe(false)
    expect(existsSync(join(B, 'resources/[core]/res_4/server/file_2.lua'))).toBe(false)
    expect(existsSync(join(B, 'resources/[core]/res_3/client/new_file.lua'))).toBe(true)
    expect(await fs.readFile(join(B, 'cache', 'keep.bin'), 'utf8')).toBe('ignored, must survive a pull')
    const stream = 'resources/[maps]/map_1/stream/asset_1.ytd'
    expect(await sha256(join(B, stream))).toBe(await sha256(join(A, stream)))
    expect(await fs.readFile(join(B, 'server.cfg'), 'utf8')).toContain('0.0.0.0:30130')
    expect(res.filesDeleted).toBe(2)

    // The restore point undoes the pull.
    t = Date.now()
    await restoreFolder({ restic, root: B, snapshotId: pre.snapshotId })
    report['Undo pull from restore point'] = seconds(Date.now() - t)
    expect(existsSync(join(B, 'resources/[core]/stray.lua'))).toBe(true)
    expect(existsSync(join(B, 'resources/[core]/res_3/client/new_file.lua'))).toBe(false)
    await restoreFolder({ restic, root: B, snapshotId: push2.snapshotId })
  })

  it('pushes from the second machine and the first sees it as a remote change', async () => {
    await fs.appendFile(join(B, 'resources/[core]/res_9/server/file_8.lua'), '\n-- tweak from the vps\n')
    const t = Date.now()
    const push3 = await pushFolder({ restic, root: B, host: 'vps', tags: tags('push'), parent: push2.snapshotId, tmpDir: TMP })
    report['Push from second machine'] = `${seconds(Date.now() - t)}, ${fmt(push3.dataAddedPacked)} uploaded`
    expect(push3.filesChanged).toBeGreaterThanOrEqual(1)
    const remote = await diffSnapshots(restic, push2.snapshotId, push3.snapshotId)
    expect(remote.map((c) => c.path)).toContain('resources/[core]/res_9/server/file_8.lua')
    expect(classifySync({ base: push2.snapshotId, latest: push3.snapshotId, local: [] })).toBe('remote-changed')
  })

  it('a cancelled push can be pushed again', async () => {
    const NEW = 1024 * MB
    await writeRandom(join(A, 'resources/[maps]/map_0/stream/big_new.ytd'), NEW)
    const abort = new AbortController()
    let seen = 0
    let timer: NodeJS.Timeout | null = null
    const started = Date.now()
    const run = pushFolder({
      restic,
      root: A,
      host: 'pc',
      tags: tags('push'),
      parent: push2.snapshotId,
      tmpDir: TMP,
      signal: abort.signal,
      onProgress: (p) => {
        seen = p.bytesDone
        // Cancel two seconds after the upload starts, part-way through the new 1 GB file.
        if (p.phase === 'Uploading' && !timer) timer = setTimeout(() => abort.abort(), 2000)
      }
    })
    await expect(run).rejects.toBeInstanceOf(SyncCancelled)
    const cancelledAfter = Date.now() - started
    await restic.unlock()
    const t = Date.now()
    const resumed = await pushFolder({ restic, root: A, host: 'pc', tags: tags('push'), parent: push2.snapshotId, tmpDir: TMP })
    report['Cancel, then push again'] =
      `cancelled after ${seconds(cancelledAfter)} (${fmt(seen)} processed); the next push took ${seconds(Date.now() - t)} and uploaded ${fmt(resumed.dataAddedPacked)} for the new ${fmt(NEW)} file`
    expect(resumed.filesNew).toBe(1)
    const snaps = await listSnapshots(restic, ['sync:e2e-server', 'kind:push'])
    expect(snaps.length).toBe(4)
  })
})
