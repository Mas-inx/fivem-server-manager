/** Helpers for reading and rewriting server.cfg without disturbing the user's own formatting. */

export interface CfgTemplateOptions {
  name: string
  gamePort: number
  maxClients: number
  licenseKey: string
  connectionString: string | null
}

const quote = (s: string): string => `"${s.replace(/"/g, "'")}"`

export function cfgTemplate(o: CfgTemplateOptions): string {
  return `# Network endpoints. The port is kept in sync with the manager's server settings.
endpoint_add_tcp "0.0.0.0:${o.gamePort}"
endpoint_add_udp "0.0.0.0:${o.gamePort}"

# Default resources
ensure mapmanager
ensure chat
ensure spawnmanager
ensure sessionmanager
ensure basic-gamemode
ensure hardcap
ensure rconlog

# Server identity
sv_hostname ${quote(o.name)}
sets sv_projectName ${quote(o.name)}
sets sv_projectDesc "A FiveM server"
sets tags "default"
sets locale "en-US"
sv_maxclients ${o.maxClients}
set onesync on

# Uncomment to hide this server from the public server list
#sv_master1 ""

# Steam Web API key, needed for Steam identifiers
set steam_webApiKey ""
${o.connectionString ? `\n# Database\nset mysql_connection_string ${quote(o.connectionString)}\n` : ''}
# Permissions
add_ace group.admin command allow
add_ace group.admin command.quit deny
# add_principal identifier.fivem:YOUR_ID group.admin

# License key from https://portal.cfx.re
sv_licenseKey ${quote(o.licenseKey || 'changeme')}
`
}

export interface CfgSync {
  gamePort?: number
  maxClients?: number
  licenseKey?: string
  connectionString?: string | null
}

const isComment = (line: string): boolean => /^\s*(#|\/\/)/.test(line)

/** Applies managed values to an existing config, inserting lines only where it makes sense. */
export function syncCfg(content: string, sync: CfgSync): string {
  const eol = content.includes('\r\n') ? '\r\n' : '\n'
  const lines = content.split(/\r?\n/)
  let endpoints = false
  let slots = false
  let license = false
  let mysql = false

  const out = lines.map((line) => {
    if (isComment(line)) return line
    if (sync.gamePort) {
      const m = line.match(/^(\s*endpoint_add_(?:tcp|udp)\s+")([^"]*?):(\d+)(".*)$/)
      if (m) {
        endpoints = true
        return `${m[1]}${m[2]}:${sync.gamePort}${m[4]}`
      }
    }
    if (sync.maxClients) {
      const m = line.match(/^(\s*sv_maxclients\s+)(\d+)(.*)$/i)
      if (m) {
        slots = true
        return `${m[1]}${sync.maxClients}${m[3]}`
      }
    }
    if (sync.licenseKey) {
      const m = line.match(/^(\s*sv_licenseKey\s+)("[^"]*"|\S+)(.*)$/i)
      if (m) {
        license = true
        return `${m[1]}${quote(sync.licenseKey)}${m[3]}`
      }
    }
    if (sync.connectionString) {
      const m = line.match(/^(\s*set\s+mysql_connection_string\s+)("[^"]*"|\S+)(.*)$/i)
      if (m) {
        mysql = true
        return `${m[1]}${quote(sync.connectionString)}${m[3]}`
      }
    }
    return line
  })

  const head: string[] = []
  if (sync.gamePort && !endpoints) {
    head.push(`endpoint_add_tcp "0.0.0.0:${sync.gamePort}"`, `endpoint_add_udp "0.0.0.0:${sync.gamePort}"`, '')
  }
  if (sync.connectionString && !mysql) head.push(`set mysql_connection_string ${quote(sync.connectionString)}`, '')
  const tail: string[] = []
  if (sync.maxClients && !slots) tail.push(`sv_maxclients ${sync.maxClients}`)
  if (sync.licenseKey && !license) tail.push(`sv_licenseKey ${quote(sync.licenseKey)}`)

  const body = [...head, ...out]
  if (tail.length) {
    while (body.length && body[body.length - 1] === '') body.pop()
    body.push('', ...tail, '')
  }
  return body.join(eol)
}

/** Replaces only the database name inside an existing mysql_connection_string. */
export function retargetDatabase(content: string, from: string, to: string): string {
  return content.replace(/^(\s*set\s+mysql_connection_string\s+")([^"]*)(".*)$/gim, (_all, a, conn: string, c) => {
    const next = conn
      .replace(new RegExp(`(/)${from}(\\?|$)`), `$1${to}$2`)
      .replace(new RegExp(`(database=)${from}(;|$)`, 'i'), `$1${to}$2`)
    return `${a}${next}${c}`
  })
}

export interface EnsureState {
  names: Set<string>
  categories: Set<string>
}

export function ensuredResources(content: string): EnsureState {
  const names = new Set<string>()
  const categories = new Set<string>()
  for (const line of content.split(/\r?\n/)) {
    if (isComment(line)) continue
    const m = line.match(/^\s*(?:ensure|start)\s+("?)([^\s"]+)\1/i)
    if (!m) continue
    const name = m[2]
    if (name.startsWith('[') && name.endsWith(']')) categories.add(name)
    else names.add(name)
  }
  return { names, categories }
}

export function setEnsured(content: string, name: string, ensured: boolean): string {
  const eol = content.includes('\r\n') ? '\r\n' : '\n'
  const lines = content.split(/\r?\n/)
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const matcher = new RegExp(`^\\s*(?:ensure|start)\\s+"?${escaped}"?\\s*(#.*)?$`, 'i')
  if (!ensured) return lines.filter((l) => !matcher.test(l)).join(eol)
  if (lines.some((l) => matcher.test(l))) return content
  // Insert after the last ensure/start line so new resources load after existing ones.
  let idx = -1
  lines.forEach((l, i) => {
    if (!isComment(l) && /^\s*(?:ensure|start)\s+/i.test(l)) idx = i
  })
  if (idx === -1) {
    while (lines.length && lines[lines.length - 1] === '') lines.pop()
    lines.push('', `ensure ${name}`, '')
  } else {
    lines.splice(idx + 1, 0, `ensure ${name}`)
  }
  return lines.join(eol)
}
