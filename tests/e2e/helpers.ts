import { createHash, randomFillSync } from 'node:crypto'
import { createReadStream, existsSync, promises as fs } from 'node:fs'
import { join } from 'node:path'
import extract from 'extract-zip'
import { REST_SERVER_SHA256, REST_SERVER_URL, REST_SERVER_VERSION, RESTIC_SHA256, RESTIC_URL, RESTIC_VERSION } from '../../src/main/sync/pin'

export const MB = 1024 * 1024

/** The pinned binary from FSM_RESTIC_BIN / FSM_REST_SERVER_BIN, or downloaded and checked into node_modules/.cache. */
export async function getBinary(kind: 'restic' | 'rest-server'): Promise<string> {
  const env = kind === 'restic' ? process.env.FSM_RESTIC_BIN : process.env.FSM_REST_SERVER_BIN
  if (env) return env
  const [version, url, sha] = kind === 'restic' ? [RESTIC_VERSION, RESTIC_URL, RESTIC_SHA256] : [REST_SERVER_VERSION, REST_SERVER_URL, REST_SERVER_SHA256]
  const dir = join(process.cwd(), 'node_modules', '.cache', `${kind}-${version}`)
  const exe = join(dir, `${kind}.exe`)
  if (existsSync(exe)) return exe
  await fs.mkdir(dir, { recursive: true })
  const res = await fetch(url)
  if (!res.ok) throw new Error(`${kind} download failed: ${res.status}`)
  const buf = Buffer.from(await res.arrayBuffer())
  if (createHash('sha256').update(buf).digest('hex') !== sha) throw new Error(`${kind} checksum mismatch`)
  const zip = join(dir, 'download.zip')
  await fs.writeFile(zip, buf)
  await extract(zip, { dir })
  const find = async (d: string): Promise<string | null> => {
    for (const e of await fs.readdir(d, { withFileTypes: true })) {
      const p = join(d, e.name)
      if (e.isDirectory()) {
        const f = await find(p)
        if (f) return f
      } else if (e.name.startsWith(kind) && e.name.endsWith('.exe') && p !== exe) return p
    }
    return null
  }
  await fs.rename((await find(dir))!, exe)
  return exe
}

export function sha256(file: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const h = createHash('sha256')
    createReadStream(file)
      .on('data', (d) => h.update(d))
      .on('error', reject)
      .on('end', () => resolve(h.digest('hex')))
  })
}

export async function writeRandom(file: string, bytes: number): Promise<void> {
  const fh = await fs.open(file, 'w')
  const chunk = Buffer.alloc(4 * MB)
  try {
    for (let left = bytes; left > 0; left -= chunk.length) {
      randomFillSync(chunk)
      await fh.write(chunk, 0, Math.min(chunk.length, left))
    }
  } finally {
    await fh.close()
  }
}

export const fmt = (bytes: number): string => (bytes >= 1024 * MB ? `${(bytes / 1024 / MB).toFixed(2)} GB` : `${(bytes / MB).toFixed(2)} MB`)
export const seconds = (ms: number): string => `${(ms / 1000).toFixed(1)} s`
