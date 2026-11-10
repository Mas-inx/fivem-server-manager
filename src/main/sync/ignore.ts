/**
 * The sync ignore list: a small, predictable subset of .gitignore.
 *
 * - `name` matches a file or folder with that name at any depth
 * - a pattern with a `/` before its end is anchored to the top of the synced folder (a leading `/` too)
 * - a trailing `/` matches folders only
 * - `*` matches within one path segment, `**` across segments, `?` one character
 * - `!pattern` re-includes something an earlier line left out; the last matching line wins
 * - `[` and `]` are plain characters, so FiveM `[category]` folders can be written as they are
 * - matching ignores case, like Windows does
 */

export const DEFAULT_IGNORE = `# Files and folders that Sync leaves out. One pattern per line, like .gitignore:
#   name       a file or folder with that name anywhere
#   folder/    folders only
#   /path      from the top of the synced folder only
#   * ** ?     wildcards; !pattern brings back something an earlier line left out
# [ and ] are plain characters, so FiveM [category] folders can be written as they are.

# Rebuilt by FXServer on every start
cache/

# Logs and crash dumps
logs/
crashes/
*.log
*.dmp

# Temporary and system files
*.tmp
*.part
Thumbs.db
desktop.ini
.DS_Store
`

interface Rule {
  negate: boolean
  dirOnly: boolean
  anchored: boolean
  re: RegExp
}

function globToRegex(glob: string): string {
  let out = ''
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i]
    if (c === '*') {
      if (glob[i + 1] === '*') {
        // "**/" matches zero or more folders, a trailing or inner "**" anything at all.
        if (glob[i + 2] === '/') {
          out += '(?:.*/)?'
          i += 2
        } else {
          out += '.*'
          i += 1
        }
      } else out += '[^/]*'
    } else if (c === '?') out += '[^/]'
    else out += c.replace(/[.+^${}()|[\]\\]/g, '\\$&')
  }
  return out
}

export function parseIgnore(text: string): Rule[] {
  const rules: Rule[] = []
  for (const raw of text.split(/\r?\n/)) {
    let line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const negate = line.startsWith('!')
    if (negate) line = line.slice(1).trim()
    line = line.replace(/\\/g, '/')
    const dirOnly = line.endsWith('/')
    line = line.replace(/\/+$/, '')
    if (!line) continue
    const anchored = line.includes('/')
    line = line.replace(/^\/+/, '')
    if (!line) continue
    rules.push({ negate, dirOnly, anchored, re: new RegExp(`^${globToRegex(line)}$`, 'i') })
  }
  return rules
}

export interface IgnoreMatcher {
  /** Whether this exact entry is left out, assuming its parent folders are not. */
  matchesEntry(relPath: string, isDir: boolean): boolean
  /** Whether a path is left out, either itself or through one of its parent folders. */
  ignores(relPath: string, isDir: boolean): boolean
}

const normalize = (p: string): string => p.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')

export function compileIgnore(...texts: string[]): IgnoreMatcher {
  const rules = texts.flatMap(parseIgnore)
  const matchesEntry = (relPath: string, isDir: boolean): boolean => {
    const path = normalize(relPath)
    const name = path.slice(path.lastIndexOf('/') + 1)
    let ignored = false
    for (const r of rules) {
      if (r.dirOnly && !isDir) continue
      if (r.re.test(r.anchored ? path : name)) ignored = !r.negate
    }
    return ignored
  }
  return {
    matchesEntry,
    ignores(relPath, isDir) {
      const parts = normalize(relPath).split('/').filter(Boolean)
      for (let i = 1; i < parts.length; i++) {
        if (matchesEntry(parts.slice(0, i).join('/'), true)) return true
      }
      return parts.length > 0 && matchesEntry(parts.join('/'), isDir)
    }
  }
}

/**
 * Builds restic exclude lines for entries the scan left out. Each line is an absolute path matched
 * literally: on Windows `[` would start a character class and cannot be escaped with `\`, so it is
 * written as `[[]`. `*` and `?` cannot appear in Windows file names.
 */
export function resticExcludes(rootAbs: string, relPaths: string[]): string[] {
  const root = rootAbs.replace(/[\\/]+$/, '')
  return relPaths.map((rel) => `${root}\\${rel.replace(/\//g, '\\')}`.replace(/\[/g, '[[]'))
}
