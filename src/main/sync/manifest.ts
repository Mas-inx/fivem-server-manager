import { promises as fs, type Dirent } from 'node:fs'
import { join } from 'node:path'
import { gunzipSync, gzipSync } from 'node:zlib'
import type { FileChange } from '@shared/types'
import { SYNC_DIR } from '@shared/sync'
import type { IgnoreMatcher } from './ignore'

export interface FileEntry {
  size: number
  /** Modification time in whole milliseconds. */
  mtime: number
}

/** Files of a synced folder by relative path ("/"-separated, original case). */
export type Manifest = Map<string, FileEntry>

export interface ScanResult {
  files: Manifest
  /** Folders kept (not ignored), relative. */
  dirs: string[]
  /** Entries the ignore list left out; folders are listed once and not descended into. */
  ignored: string[]
}

const CONCURRENCY = 32

/**
 * Walks a synced folder, honouring the ignore list. The sync folder (.fxsync) is never part of the
 * manifest: it only carries the snapshot's metadata and database dump.
 */
export async function scanTree(root: string, matcher: IgnoreMatcher): Promise<ScanResult> {
  const files: Manifest = new Map()
  const dirs: string[] = []
  const ignored: string[] = []
  const queue: string[] = ['']
  const statQueue: [string, string][] = []

  while (queue.length) {
    const rel = queue.pop()!
    let entries: Dirent[]
    try {
      entries = await fs.readdir(rel ? join(root, rel) : root, { withFileTypes: true })
    } catch {
      continue
    }
    for (const e of entries) {
      const childRel = rel ? `${rel}/${e.name}` : e.name
      if (!rel && e.name.toLowerCase() === SYNC_DIR) continue
      if (e.isSymbolicLink()) continue
      const isDir = e.isDirectory()
      if (!isDir && !e.isFile()) continue
      if (matcher.matchesEntry(childRel, isDir)) {
        ignored.push(childRel)
        continue
      }
      if (isDir) {
        dirs.push(childRel)
        queue.push(childRel)
      } else statQueue.push([childRel, join(root, childRel)])
    }
  }

  for (let i = 0; i < statQueue.length; i += CONCURRENCY) {
    await Promise.all(
      statQueue.slice(i, i + CONCURRENCY).map(async ([rel, abs]) => {
        const st = await fs.stat(abs).catch(() => null)
        if (st) files.set(rel, { size: st.size, mtime: Math.trunc(st.mtimeMs) })
      })
    )
  }
  return { files, dirs, ignored }
}

/** Changes from `before` to `after`, comparing size and modification time; paths compare without case. */
export function diffManifest(before: Manifest, after: Manifest): FileChange[] {
  const lower = new Map<string, [string, FileEntry]>()
  for (const [p, e] of before) lower.set(p.toLowerCase(), [p, e])
  const out: FileChange[] = []
  for (const [p, e] of after) {
    const key = p.toLowerCase()
    const prev = lower.get(key)
    if (!prev) out.push({ path: p, change: 'added' })
    else {
      if (prev[1].size !== e.size || prev[1].mtime !== e.mtime) out.push({ path: p, change: 'modified' })
      lower.delete(key)
    }
  }
  for (const [, [p]] of lower) out.push({ path: p, change: 'removed' })
  return out.sort((a, b) => a.path.localeCompare(b.path))
}

interface ManifestFile {
  version: 1
  snapshot: string | null
  files: [string, number, number][]
}

export function encodeManifest(snapshot: string | null, files: Manifest): Buffer {
  const data: ManifestFile = { version: 1, snapshot, files: [...files].map(([p, e]) => [p, e.size, e.mtime]) }
  return gzipSync(JSON.stringify(data))
}

export function decodeManifest(buf: Buffer): { snapshot: string | null; files: Manifest } {
  const data = JSON.parse(gunzipSync(buf).toString('utf8')) as ManifestFile
  return { snapshot: data.snapshot, files: new Map(data.files.map(([p, size, mtime]) => [p, { size, mtime }])) }
}
