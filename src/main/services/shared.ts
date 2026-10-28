import { existsSync, promises as fs } from 'node:fs'
import { join } from 'node:path'
import { hashSync } from 'bcryptjs'
import type { ServerConfig, UniversalAdmin } from '@shared/types'
import { store } from '../store'
import { password, readJson, writeFileAtomic } from '../util'
import { serverFiles, txDataPath } from './server-files'

/** The file every server execs for universal admins and shared config. */
export const MANAGED_CFG = 'server-manager.cfg'
const EXEC_LINE = `exec ${MANAGED_CFG}`

function principals(): string[] {
  return store.settings.adminPrincipals.split(/[\s,]+/).filter((p) => /^[\w.]+$/.test(p))
}

export function managedCfg(server: ServerConfig): string {
  const lines = [
    '# Managed by FiveM Server Manager. Edit universal admins and shared config in the app;',
    '# changes made directly in this file are overwritten.',
    ''
  ]
  if (!server.shared) {
    lines.push('# This server does not use the shared settings.')
    return lines.join('\n') + '\n'
  }
  const admins = store.settings.admins.filter((a) => a.ace)
  if (admins.length) {
    lines.push('## Admins')
    for (const admin of admins) {
      for (const id of admin.identifiers) {
        for (const group of principals()) lines.push(`add_principal identifier.${id} ${group} # ${admin.name}`)
      }
    }
    lines.push('')
  }
  const shared = store.settings.sharedConfig.trim()
  if (shared) lines.push('## Shared config', shared, '')
  return lines.join('\n') + '\n'
}

/** Writes the managed cfg next to server.cfg and makes sure server.cfg execs it. */
export async function applyShared(server: ServerConfig): Promise<boolean> {
  const files = await serverFiles(server)
  if (!files.dataPath || !files.cfgPath || !existsSync(files.cfgPath)) return false
  const target = join(files.dataPath, MANAGED_CFG)
  const content = managedCfg(server)
  const current = await fs.readFile(target, 'utf8').catch(() => null)
  if (current !== content) await writeFileAtomic(target, content)

  const cfg = await fs.readFile(files.cfgPath, 'utf8')
  const eol = cfg.includes('\r\n') ? '\r\n' : '\n'
  const hasExec = cfg.split(/\r?\n/).some((l) => l.trim() === EXEC_LINE)
  if (!hasExec) {
    // Last, so shared settings and admins apply after the server's own config.
    const body = cfg.replace(/\s+$/, '')
    await fs.writeFile(files.cfgPath, `${body}${eol}${eol}# Universal admins and shared config from FiveM Server Manager${eol}${EXEC_LINE}${eol}`, 'utf8')
  }
  return true
}

interface TxAdminEntry {
  $schema?: number
  name: string
  master: boolean
  password_hash: string
  password_temporary?: boolean
  providers: Record<string, { id: string; identifier: string; data: Record<string, unknown> }>
  permissions: string[]
}

function toTxAdmin(admin: UniversalAdmin): TxAdminEntry | null {
  const fivem = admin.identifiers.find((i) => i.startsWith('fivem:'))
  const discord = admin.identifiers.find((i) => i.startsWith('discord:'))
  if (!fivem && !discord) return null
  const providers: TxAdminEntry['providers'] = {}
  if (fivem) providers.citizenfx = { id: admin.name, identifier: fivem, data: {} }
  if (discord) providers.discord = { id: discord.slice('discord:'.length), identifier: discord, data: {} }
  return {
    $schema: 1,
    name: admin.name,
    master: false,
    // They sign in with Cfx.re; the random password only exists because txAdmin requires one.
    password_hash: hashSync(password(24), 11),
    password_temporary: true,
    providers,
    permissions: ['all_permissions']
  }
}

/**
 * Merges universal admins into txAdmin's admins.json. txAdmin restores this file if it changes
 * while running, so this only runs while the server is stopped (right before it starts).
 * The master account and admins created inside txAdmin are never touched.
 */
export async function syncTxAdmins(server: ServerConfig): Promise<void> {
  if (server.mode !== 'txadmin') return
  const dir = txDataPath(server)
  const file = join(dir, 'admins.json')
  let list = existsSync(file) ? await readJson<TxAdminEntry[]>(file) : null
  if (existsSync(file) && !Array.isArray(list)) return

  if (!list) {
    // First boot: create the file ourselves so universal admins exist from the start.
    if (!server.txAdmin) return
    list = [
      {
        $schema: 1,
        name: server.txAdmin.username,
        master: true,
        password_hash: hashSync(server.txAdmin.password, 11),
        providers: {},
        permissions: []
      }
    ]
  }

  const ours = new Set(server.syncedAdmins.map((n) => n.toLowerCase()))
  const wanted = server.shared ? store.settings.admins.filter((a) => a.panel) : []
  const wantedNames = new Set(wanted.map((a) => a.name.toLowerCase()))

  // Drop accounts we added earlier that are no longer on the list.
  list = list.filter((a) => a.master || !ours.has(a.name.toLowerCase()) || wantedNames.has(a.name.toLowerCase()))

  const synced: string[] = []
  for (const admin of wanted) {
    const entry = toTxAdmin(admin)
    if (!entry) continue
    const key = admin.name.toLowerCase()
    const existing = list.find((a) => a.name.toLowerCase() === key)
    if (existing && (existing.master || !ours.has(key))) continue
    const taken = list.some(
      (a) =>
        a.name.toLowerCase() !== key &&
        Object.values(a.providers).some((p) => Object.values(entry.providers).some((e) => e.identifier === p.identifier))
    )
    if (taken) continue
    if (existing) {
      existing.providers = entry.providers
      existing.permissions = entry.permissions
    } else list.push(entry)
    synced.push(admin.name)
  }

  await fs.mkdir(dir, { recursive: true })
  const next = JSON.stringify(list, null, 2)
  const current = await fs.readFile(file, 'utf8').catch(() => null)
  if (current !== next) await writeFileAtomic(file, next)
  store.updateServer(server.id, { syncedAdmins: synced })
}
