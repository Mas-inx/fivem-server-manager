import { existsSync, promises as fs } from 'node:fs'
import { isAbsolute, join, normalize, relative, resolve } from 'node:path'
import type { ServerConfig, ServerFiles } from '@shared/types'
import { readJson } from '../util'

interface TxConfig {
  server?: { dataPath?: string | null; cfgPath?: string | null }
  fxRunner?: { serverDataPath?: string | null; cfgPath?: string | null }
}

export function txDataPath(server: ServerConfig): string {
  return server.txDataPath ?? join(server.root, 'txData')
}

/** Profiles inside txData; txAdmin creates "default" unless told otherwise. */
export async function txProfiles(txData: string): Promise<string[]> {
  const entries = await fs.readdir(txData, { withFileTypes: true }).catch(() => [])
  const profiles = entries.filter((e) => e.isDirectory() && existsSync(join(txData, e.name, 'config.json'))).map((e) => e.name)
  return profiles.sort((a, b) => (a === 'default' ? -1 : b === 'default' ? 1 : a.localeCompare(b)))
}

/** Reads where txAdmin deployed the server data, supporting both the v7 and v8 config layouts. */
export async function txServerPaths(txData: string): Promise<{ dataPath: string; cfgPath: string } | null> {
  for (const profile of await txProfiles(txData)) {
    const cfg = await readJson<TxConfig>(join(txData, profile, 'config.json'))
    const dataPath = cfg?.server?.dataPath ?? cfg?.fxRunner?.serverDataPath
    if (!dataPath) continue
    const cfgRel = cfg?.server?.cfgPath ?? cfg?.fxRunner?.cfgPath ?? 'server.cfg'
    const dp = normalize(dataPath)
    return { dataPath: dp, cfgPath: isAbsolute(cfgRel) ? normalize(cfgRel) : join(dp, cfgRel) }
  }
  return null
}

export async function serverFiles(server: ServerConfig): Promise<ServerFiles> {
  const logsPath = join(server.root, 'logs')
  if (server.mode === 'standalone') {
    const dataPath = server.dataPath ?? join(server.root, 'server-data')
    return { root: server.root, dataPath, cfgPath: join(dataPath, 'server.cfg'), txDataPath: null, logsPath }
  }
  const txData = txDataPath(server)
  const deployed = await txServerPaths(txData)
  return {
    root: server.root,
    dataPath: deployed?.dataPath ?? null,
    cfgPath: deployed?.cfgPath ?? null,
    txDataPath: txData,
    logsPath
  }
}

/** Resolves a path the renderer asked for, refusing anything outside the server's folders. */
export function safeResolve(files: ServerFiles, requested: string): string {
  const target = resolve(files.dataPath ?? files.root, requested)
  const allowed = [files.root, files.dataPath, files.txDataPath].filter(Boolean) as string[]
  const ok = allowed.some((base) => {
    const rel = relative(base, target)
    return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
  })
  if (!ok) throw new Error('That file is outside of this server')
  return target
}
