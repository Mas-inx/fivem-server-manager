import type { DbConnection, ServerMode } from '@shared/types'
import { syncCfg } from '../services/cfg'

/** Settings that belong to one machine and must survive a pull from another. */
export interface LocalSettings {
  mode: ServerMode
  gamePort: number
  txAdminPort: number
  licenseKey: string
  /** This machine's database for the server, null when it has none. */
  database: string | null
  /** mysql_connection_string for `database` on this machine. */
  connectionString: string | null
  db: DbConnection
}

/**
 * Puts this machine's port, license key and database back into a pulled server.cfg. Standalone
 * configs get missing lines added, as the manager does on start. txAdmin configs only have existing
 * lines rewritten: txAdmin owns them and receives its ports through TXHOST_* instead.
 */
export function applyLocalCfg(cfg: string, local: LocalSettings): string {
  return syncCfg(
    cfg,
    {
      gamePort: local.gamePort,
      licenseKey: local.licenseKey || undefined,
      connectionString: local.connectionString ?? undefined
    },
    { insertMissing: local.mode === 'standalone' }
  )
}

/** Environment txAdmin is started with; always built from this machine's settings, never from synced files. */
export function txHostEnv(txDataPath: string, local: LocalSettings): Record<string, string> {
  const env: Record<string, string> = {
    TXHOST_DATA_PATH: txDataPath,
    TXHOST_TXA_PORT: String(local.txAdminPort),
    TXHOST_FXS_PORT: String(local.gamePort),
    TXHOST_GAME_NAME: 'fivem',
    TXHOST_PROVIDER_NAME: 'Server Manager',
    TXHOST_IGNORE_DEPRECATED_CONFIGS: 'true'
  }
  // txAdmin refuses to boot when this variable is malformed, so only pass real keys through.
  if (/^cfxk_\w+_\w+$/.test(local.licenseKey)) env.TXHOST_DEFAULT_CFXKEY = local.licenseKey
  if (local.database) {
    Object.assign(env, {
      TXHOST_DEFAULT_DBHOST: local.db.host,
      TXHOST_DEFAULT_DBPORT: String(local.db.port),
      TXHOST_DEFAULT_DBUSER: local.db.user,
      TXHOST_DEFAULT_DBPASS: local.db.password,
      TXHOST_DEFAULT_DBNAME: local.database
    })
  }
  return env
}

const toSlash = (p: string): string => p.replace(/\\/g, '/').replace(/\/+$/, '')

/**
 * Rewrites absolute paths inside txAdmin's config.json from one folder to another, so a txData
 * copied or pulled from elsewhere points at this machine's server data. Paths compare without case.
 */
export function rebasePaths(value: unknown, fromRoot: string, toRoot: string): unknown {
  const from = toSlash(fromRoot).toLowerCase()
  const to = toSlash(toRoot)
  const rewrite = (v: unknown): unknown => {
    if (typeof v === 'string') {
      const s = toSlash(v)
      const lower = s.toLowerCase()
      if (lower === from || lower.startsWith(`${from}/`)) {
        const rebased = to + s.slice(from.length)
        return v.includes('\\') ? rebased.replace(/\//g, '\\') : rebased + (v.endsWith('/') ? '/' : '')
      }
      return v
    }
    if (Array.isArray(v)) return v.map(rewrite)
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, rewrite(x)]))
    return v
  }
  return rewrite(value)
}
