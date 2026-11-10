import { existsSync, promises as fs } from 'node:fs'
import { join } from 'node:path'
import type { FileChange } from '@shared/types'
import { IGNORE_FILE, parseResticDiff } from '@shared/sync'
import { compileIgnore, DEFAULT_IGNORE, resticExcludes } from './ignore'
import { scanTree, type Manifest } from './manifest'
import { SyncCancelled, type Restic } from './restic'

/** Raw snapshot record from `restic snapshots --json`. */
export interface ResticSnapshot {
  id: string
  short_id: string
  time: string
  hostname: string
  tags?: string[]
  paths: string[]
  summary?: {
    total_files_processed?: number
    total_bytes_processed?: number
    data_added?: number
    data_added_packed?: number
  }
}

export interface EngineProgress {
  phase: string
  fraction: number | null
  bytesDone: number
  bytesTotal: number
  filesDone: number
  filesTotal: number
  /** Seconds left as restic estimates it, when it does. */
  secondsLeft: number | null
}

export interface PushParams {
  restic: Restic
  root: string
  host: string
  tags: string[]
  /** Snapshot to compare against so unchanged files are not read again. */
  parent?: string | null
  /** Folder for the temporary exclude list. */
  tmpDir: string
  signal?: AbortSignal
  onProgress?: (p: EngineProgress) => void
}

export interface PushResult {
  snapshotId: string
  shortId: string
  filesNew: number
  filesChanged: number
  filesUnmodified: number
  totalFiles: number
  totalBytes: number
  /** Bytes added to the repository before and after compression. */
  dataAdded: number
  dataAddedPacked: number
  seconds: number
  /** The files that went into the snapshot, as this machine sees them. */
  manifest: Manifest
}

export async function readIgnoreText(root: string): Promise<string> {
  return fs.readFile(join(root, IGNORE_FILE), 'utf8').catch(() => DEFAULT_IGNORE)
}

/** Creates the default ignore list in a folder that has none, so it is synced and can be edited. */
export async function ensureIgnoreFile(root: string): Promise<void> {
  const file = join(root, IGNORE_FILE)
  if (!existsSync(file)) await fs.writeFile(file, DEFAULT_IGNORE, 'utf8')
}

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0)

/**
 * Snapshots a folder. The scan decides what is ignored and hands restic the exact paths to leave
 * out, so the ignore rules mean the same thing for pushes, conflict checks and deletions.
 */
export async function pushFolder(p: PushParams): Promise<PushResult> {
  await ensureIgnoreFile(p.root)
  p.onProgress?.({ phase: 'Scanning files', fraction: null, bytesDone: 0, bytesTotal: 0, filesDone: 0, filesTotal: 0, secondsLeft: null })
  const matcher = compileIgnore(await readIgnoreText(p.root))
  const scan = await scanTree(p.root, matcher)
  if (p.signal?.aborted) throw new SyncCancelled()

  await fs.mkdir(p.tmpDir, { recursive: true })
  const excludeFile = join(p.tmpDir, `exclude-${process.pid}-${Date.now()}.txt`)
  await fs.writeFile(excludeFile, resticExcludes(p.root, scan.ignored).join('\n'), 'utf8')

  const args = ['backup', '.', '--iexclude-file', excludeFile, '--host', p.host, '--ignore-inode', '--skip-if-unchanged']
  for (const tag of p.tags) args.push('--tag', tag)
  if (p.parent) args.push('--parent', p.parent)

  try {
    const messages = await p.restic.run(args, {
      cwd: p.root,
      signal: p.signal,
      allowIncomplete: true,
      onMessage: (m) => {
        if (m.message_type !== 'status') return
        p.onProgress?.({
          phase: 'Uploading',
          fraction: num(m.percent_done),
          bytesDone: num(m.bytes_done),
          bytesTotal: num(m.total_bytes),
          filesDone: num(m.files_done),
          filesTotal: num(m.total_files),
          secondsLeft: typeof m.seconds_remaining === 'number' ? m.seconds_remaining : null
        })
      }
    })
    const summary = messages.find((m) => m.message_type === 'summary')
    if (!summary) throw new Error('The sync engine finished without a summary')
    let snapshotId = summary.snapshot_id as string | undefined
    // With --skip-if-unchanged an identical push creates no snapshot; the parent stays the latest.
    if (!snapshotId && p.parent) snapshotId = p.parent
    if (!snapshotId) throw new Error('No snapshot was created')
    return {
      snapshotId,
      shortId: snapshotId.slice(0, 8),
      filesNew: num(summary.files_new),
      filesChanged: num(summary.files_changed),
      filesUnmodified: num(summary.files_unmodified),
      totalFiles: num(summary.total_files_processed),
      totalBytes: num(summary.total_bytes_processed),
      dataAdded: num(summary.data_added),
      dataAddedPacked: num(summary.data_added_packed),
      seconds: num(summary.total_duration),
      manifest: scan.files
    }
  } finally {
    await fs.rm(excludeFile, { force: true })
  }
}

export interface RestoreParams {
  restic: Restic
  root: string
  snapshotId: string
  signal?: AbortSignal
  onProgress?: (p: EngineProgress) => void
}

export interface RestoreResult {
  /** Files written because they were missing or different. */
  filesRestored: number
  /** Files already identical, left untouched. */
  filesSkipped: number
  filesDeleted: number
}

export interface SnapshotFile {
  path: string
  size: number
  /** Modification time in whole milliseconds. */
  mtime: number
}

/** Lists a snapshot's files and folders, keyed by relative path in lower case. */
export async function snapshotEntries(restic: Restic, snapshotId: string, signal?: AbortSignal): Promise<{ files: Map<string, SnapshotFile>; dirs: Set<string> }> {
  const files = new Map<string, SnapshotFile>()
  const dirs = new Set<string>()
  await restic.run(['ls', snapshotId], {
    signal,
    onMessage: (m) => {
      if (m.message_type !== 'node' && m.struct_type !== 'node') return
      const path = String(m.path ?? '').replace(/^\/+/, '')
      if (!path) return
      if (m.type === 'dir') dirs.add(path.toLowerCase())
      else if (m.type === 'file') files.set(path.toLowerCase(), { path, size: num(m.size), mtime: Date.parse(String(m.mtime)) })
    }
  })
  return { files, dirs }
}

/** Above this many changed files a full restore is simpler than listing every one of them. */
const MAX_INCLUDES = 20_000
const STAT_CONCURRENCY = 32

/**
 * Makes a folder match a snapshot. Files whose size and modification time already match are not
 * touched at all; the rest are restored, and files that are not in the snapshot are deleted unless
 * the ignore list (before or after the restore) leaves them out.
 */
export async function restoreFolder(p: RestoreParams & { tmpDir?: string }): Promise<RestoreResult> {
  await fs.mkdir(p.root, { recursive: true })
  const ignoreBefore = await readIgnoreText(p.root)
  p.onProgress?.({ phase: 'Reading snapshot', fraction: null, bytesDone: 0, bytesTotal: 0, filesDone: 0, filesTotal: 0, secondsLeft: null })
  const entries = await snapshotEntries(p.restic, p.snapshotId, p.signal)

  p.onProgress?.({ phase: 'Comparing files', fraction: null, bytesDone: 0, bytesTotal: 0, filesDone: 0, filesTotal: 0, secondsLeft: null })
  const all = [...entries.files.values()]
  const changed: SnapshotFile[] = []
  for (let i = 0; i < all.length; i += STAT_CONCURRENCY) {
    await Promise.all(
      all.slice(i, i + STAT_CONCURRENCY).map(async (f) => {
        const st = await fs.stat(join(p.root, f.path)).catch(() => null)
        if (!st || !st.isFile() || st.size !== f.size || Math.trunc(st.mtimeMs) !== f.mtime) changed.push(f)
      })
    )
  }
  if (p.signal?.aborted) throw new SyncCancelled()

  let restored = 0
  if (changed.length) {
    const args = ['restore', p.snapshotId, '--target', '.', '--overwrite', 'if-changed']
    let includeFile: string | null = null
    if (changed.length < all.length && changed.length <= MAX_INCLUDES) {
      // Literal paths; on Windows "[" would start a character class, so it is written as "[[]".
      const dir = p.tmpDir ?? p.root
      await fs.mkdir(dir, { recursive: true })
      includeFile = join(dir, `include-${process.pid}-${Date.now()}.txt`)
      await fs.writeFile(includeFile, changed.map((f) => `/${f.path}`.replace(/\[/g, '[[]')).join('\n'), 'utf8')
      args.push('--include-file', includeFile)
    }
    try {
      await p.restic.run(args, {
        cwd: p.root,
        signal: p.signal,
        onMessage: (m) => {
          if (m.message_type !== 'status') return
          p.onProgress?.({
            phase: 'Downloading',
            fraction: num(m.percent_done),
            bytesDone: num(m.bytes_restored) + num(m.bytes_skipped),
            bytesTotal: num(m.total_bytes),
            filesDone: num(m.files_restored) + num(m.files_skipped),
            filesTotal: num(m.total_files),
            secondsLeft: typeof m.seconds_remaining === 'number' ? m.seconds_remaining : null
          })
        }
      })
      restored = changed.length
    } finally {
      if (includeFile) await fs.rm(includeFile, { force: true })
    }
  }

  p.onProgress?.({ phase: 'Removing old files', fraction: null, bytesDone: 0, bytesTotal: 0, filesDone: 0, filesTotal: 0, secondsLeft: null })
  const matcher = compileIgnore(ignoreBefore, await readIgnoreText(p.root))
  const local = await scanTree(p.root, matcher)
  let deleted = 0
  for (const rel of local.files.keys()) {
    if (entries.files.has(rel.toLowerCase())) continue
    await fs.rm(join(p.root, rel), { force: true })
    deleted++
  }
  // Folders that are gone from the snapshot and now empty; deepest first.
  for (const rel of local.dirs.sort((a, b) => b.length - a.length)) {
    if (entries.dirs.has(rel.toLowerCase())) continue
    await fs.rmdir(join(p.root, rel)).catch(() => undefined)
  }
  return { filesRestored: restored, filesSkipped: all.length - restored, filesDeleted: deleted }
}

export async function listSnapshots(restic: Restic, tags: string[] = [], signal?: AbortSignal): Promise<ResticSnapshot[]> {
  const args = ['snapshots']
  // One --tag with a comma list means "has all of these".
  if (tags.length) args.push('--tag', tags.join(','))
  const messages = await restic.run(args, { signal })
  return (messages as unknown as ResticSnapshot[]).filter((s) => typeof s.id === 'string')
}

export async function diffSnapshots(restic: Restic, from: string, to: string, signal?: AbortSignal): Promise<FileChange[]> {
  const messages = await restic.run(['diff', from, to], { signal })
  return parseResticDiff(messages as { message_type?: string; path?: string; modifier?: string }[])
}
