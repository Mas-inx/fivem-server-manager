import { createHash } from 'node:crypto'
import { createReadStream, existsSync, promises as fs } from 'node:fs'
import { join } from 'node:path'
import { download, unzip } from '../net'
import { paths } from '../paths'
import { RESTIC_SHA256, RESTIC_URL, RESTIC_VERSION } from './pin'

export { RESTIC_VERSION }

export function resticPath(): string {
  // Development and tests can point at a binary they already have.
  if (process.env.FSM_RESTIC_BIN) return process.env.FSM_RESTIC_BIN
  return join(paths.library(), 'tools', `restic-${RESTIC_VERSION}`, 'restic.exe')
}

export function resticInstalled(): boolean {
  return existsSync(resticPath())
}

function sha256(file: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256')
    createReadStream(file)
      .on('data', (d) => hash.update(d))
      .on('error', reject)
      .on('end', () => resolve(hash.digest('hex')))
  })
}

let inflight: Promise<string> | null = null

/** Downloads and verifies restic once; later calls return the installed path. */
export function ensureRestic(onStatus?: (detail: string) => void): Promise<string> {
  if (resticInstalled()) return Promise.resolve(resticPath())
  inflight ??= (async () => {
    const zip = join(paths.downloads(), `restic_${RESTIC_VERSION}_windows_amd64.zip`)
    onStatus?.('Downloading the sync engine')
    await download(RESTIC_URL, zip)
    const actual = await sha256(zip)
    if (actual !== RESTIC_SHA256) {
      await fs.rm(zip, { force: true })
      throw new Error('The sync engine download did not match its published checksum and was discarded')
    }
    const staging = join(paths.downloads(), `restic-${Date.now()}`)
    await unzip(zip, staging)
    const exe = (await fs.readdir(staging)).find((n) => /^restic.*\.exe$/i.test(n))
    if (!exe) throw new Error('The sync engine download has no restic.exe')
    const dest = resticPath()
    await fs.mkdir(join(dest, '..'), { recursive: true })
    await fs.rename(join(staging, exe), dest)
    await fs.rm(staging, { recursive: true, force: true })
    await fs.rm(zip, { force: true })
    return dest
  })().finally(() => {
    inflight = null
  })
  return inflight
}
