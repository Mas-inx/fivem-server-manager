import type { FileChange, SyncCheckState, SyncOp } from './types'

/** Where a snapshot's files live inside a server: the whole server folder, its server-data, or its txData. */
export type SyncLayout = 'root' | 'data' | 'txdata'

/** Folder inside the synced tree that holds the snapshot's own metadata and database dump. */
export const SYNC_DIR = '.fxsync'
export const IGNORE_FILE = '.fxsyncignore'

export interface ConflictInput {
  /** Snapshot this machine last pushed or pulled. */
  base: string | null
  /** Newest pushed snapshot on the remote. */
  latest: string | null
  /** Files changed here since `base`. */
  local: FileChange[]
}

const sameSnapshot = (a: string, b: string): boolean => {
  const x = a.toLowerCase()
  const y = b.toLowerCase()
  return x.startsWith(y) || y.startsWith(x)
}

/**
 * Compares this machine's copy with the remote. The remote has changed when its newest push is not
 * the snapshot this machine last synced; the local copy has changed when files differ from the
 * state recorded at that sync.
 */
export function classifySync({ base, latest, local }: ConflictInput): SyncCheckState {
  if (!latest) return 'no-remote-copy'
  if (!base) return 'never-synced'
  const remoteChanged = !sameSnapshot(base, latest)
  const localChanged = local.length > 0
  if (remoteChanged && localChanged) return 'diverged'
  if (remoteChanged) return 'remote-changed'
  if (localChanged) return 'local-changed'
  return 'in-sync'
}

/** Paths changed on both sides, compared the way Windows does (case-insensitive). */
export function overlappingChanges(local: FileChange[], remote: FileChange[]): string[] {
  const theirs = new Set(remote.map((c) => c.path.toLowerCase()))
  return local.filter((c) => theirs.has(c.path.toLowerCase())).map((c) => c.path)
}

/**
 * Whether an operation should stop and ask first. A push over newer remote work, or a pull over
 * local edits, loses something unless the user means it.
 */
export function needsConfirmation(op: Extract<SyncOp, 'push' | 'pull'>, state: SyncCheckState): boolean {
  if (state === 'diverged') return true
  if (op === 'push') return state === 'remote-changed'
  return state === 'local-changed' || state === 'never-synced'
}

/** Turns `restic diff --json` change records into file changes, skipping folders and the sync folder. */
export function parseResticDiff(records: { message_type?: string; path?: string; modifier?: string }[]): FileChange[] {
  const out: FileChange[] = []
  for (const r of records) {
    if (r.message_type !== 'change' || !r.path || r.path.endsWith('/')) continue
    const path = r.path.replace(/^\/+/, '')
    if (path.toLowerCase().startsWith(`${SYNC_DIR}/`)) continue
    const change = r.modifier === '+' ? 'added' : r.modifier === '-' ? 'removed' : 'modified'
    out.push({ path, change })
  }
  return out
}

/** Restic tags may not contain commas, so free text goes in URI-encoded. */
export const encodeTag = (value: string): string => encodeURIComponent(value)
export const decodeTag = (value: string): string => {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}
