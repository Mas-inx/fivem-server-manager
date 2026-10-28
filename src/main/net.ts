import { net } from 'electron'
import { once } from 'node:events'
import { createWriteStream, promises as fs } from 'node:fs'
import { dirname } from 'node:path'
import extract from 'extract-zip'

export interface DownloadProgress {
  received: number
  total: number
  /** Bytes per second, smoothed. */
  speed: number
}

export async function fetchText(url: string, timeoutMs = 15000): Promise<string> {
  const res = await net.fetch(url, { signal: AbortSignal.timeout(timeoutMs) })
  if (!res.ok) throw new Error(`Request to ${new URL(url).host} failed (${res.status})`)
  return res.text()
}

export async function fetchJson<T>(url: string, timeoutMs = 15000): Promise<T> {
  return JSON.parse(await fetchText(url, timeoutMs)) as T
}

/** Streams `url` to `dest`, writing to a .part file first so a failed download never looks complete. */
export async function download(url: string, dest: string, onProgress?: (p: DownloadProgress) => void): Promise<void> {
  await fs.mkdir(dirname(dest), { recursive: true })
  const part = `${dest}.part`
  const res = await net.fetch(url)
  if (!res.ok || !res.body) throw new Error(`Download failed (${res.status} ${res.statusText})`)
  const total = Number(res.headers.get('content-length')) || 0
  const file = createWriteStream(part)
  const reader = res.body.getReader()
  let received = 0
  let speed = 0
  let windowStart = Date.now()
  let windowBytes = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      received += value.byteLength
      windowBytes += value.byteLength
      const now = Date.now()
      if (now - windowStart >= 500) {
        const inst = (windowBytes * 1000) / (now - windowStart)
        speed = speed ? speed * 0.6 + inst * 0.4 : inst
        windowStart = now
        windowBytes = 0
        onProgress?.({ received, total, speed })
      }
      if (!file.write(value)) await once(file, 'drain')
    }
    await new Promise<void>((resolve, reject) => file.end((err?: Error | null) => (err ? reject(err) : resolve())))
  } catch (err) {
    file.destroy()
    await fs.rm(part, { force: true })
    throw err
  }
  if (total && received !== total) {
    await fs.rm(part, { force: true })
    throw new Error('Download was interrupted, please try again')
  }
  onProgress?.({ received, total: total || received, speed })
  await fs.rm(dest, { force: true })
  await fs.rename(part, dest)
}

export async function unzip(file: string, dir: string, onProgress?: (fraction: number) => void): Promise<void> {
  await fs.mkdir(dir, { recursive: true })
  let n = 0
  let lastReport = 0
  await extract(file, {
    dir,
    onEntry: (_entry, zip) => {
      n++
      const now = Date.now()
      if (onProgress && (now - lastReport > 100 || n === zip.entryCount)) {
        lastReport = now
        onProgress(n / zip.entryCount)
      }
    }
  })
}
