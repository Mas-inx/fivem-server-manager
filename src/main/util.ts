import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { promises as fs, existsSync } from 'node:fs'
import { join } from 'node:path'

export const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

export function id(): string {
  return randomBytes(6).toString('hex')
}

export function slugify(name: string): string {
  const slug = name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
  return slug || 'server'
}

/** Database identifiers are restricted to a safe subset so they never need escaping. */
export function dbName(name: string): string {
  const base = slugify(name).replace(/-/g, '_')
  return /^[0-9]/.test(base) ? `fx_${base}` : base
}

export function password(length = 16): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789'
  const bytes = randomBytes(length)
  let out = ''
  for (let i = 0; i < length; i++) out += alphabet[bytes[i] % alphabet.length]
  return out
}

export async function uniqueDir(parent: string, base: string): Promise<string> {
  let name = base
  let n = 2
  while (existsSync(join(parent, name))) name = `${base}-${n++}`
  return name
}

export async function dirSize(dir: string): Promise<number> {
  let total = 0
  const walk = async (d: string): Promise<void> => {
    let entries: import('node:fs').Dirent[]
    try {
      entries = await fs.readdir(d, { withFileTypes: true })
    } catch {
      return
    }
    await Promise.all(
      entries.map(async (e) => {
        const p = join(d, e.name)
        if (e.isDirectory()) await walk(p)
        else if (e.isFile()) {
          // Read the size before touching `total`; `total += await …` would lose concurrent updates.
          const { size } = await fs.stat(p).catch(() => ({ size: 0 }))
          total += size
        }
      })
    )
  }
  await walk(dir)
  return total
}

export async function readJson<T>(file: string): Promise<T | null> {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8')) as T
  } catch {
    return null
  }
}

export async function writeFileAtomic(file: string, data: string): Promise<void> {
  const tmp = `${file}.${process.pid}.tmp`
  await fs.writeFile(tmp, data, 'utf8')
  await fs.rename(tmp, file)
}

/** Kills a process and every process it spawned. */
export function killTree(pid: number): Promise<void> {
  return new Promise((resolve) => {
    const p = spawn('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true })
    p.on('exit', () => resolve())
    p.on('error', () => resolve())
  })
}

/** Splits a stream of chunks into complete lines, holding back partial ones. */
export class LineSplitter {
  private rest = ''
  push(chunk: string): string[] {
    const text = this.rest + chunk
    const parts = text.split(/\r?\n/)
    this.rest = parts.pop() ?? ''
    return parts
  }
  flush(): string[] {
    const r = this.rest
    this.rest = ''
    return r ? [r] : []
  }
}

export class RingBuffer<T> {
  private items: T[] = []
  constructor(private readonly max: number) {}
  push(...values: T[]): void {
    this.items.push(...values)
    if (this.items.length > this.max) this.items.splice(0, this.items.length - this.max)
  }
  all(): T[] {
    return this.items.slice()
  }
  clear(): void {
    this.items = []
  }
}

/** Splits a command line into arguments, honouring double quotes. */
export function splitArgs(input: string): string[] {
  const out: string[] = []
  const re = /"([^"]*)"|(\S+)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(input))) out.push(m[1] ?? m[2])
  return out
}

export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message
  return String(err)
}

export function throttle<A extends unknown[]>(fn: (...args: A) => void, ms: number): (...args: A) => void {
  let last = 0
  let timer: NodeJS.Timeout | null = null
  let pending: A | null = null
  return (...args: A) => {
    const now = Date.now()
    if (now - last >= ms) {
      last = now
      fn(...args)
      return
    }
    pending = args
    if (!timer) {
      timer = setTimeout(() => {
        timer = null
        last = Date.now()
        if (pending) fn(...pending)
        pending = null
      }, ms - (now - last))
    }
  }
}
