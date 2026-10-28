import { app } from 'electron'
import { existsSync, promises as fs } from 'node:fs'
import { join } from 'node:path'
import type { ArtifactBuild, ArtifactCatalog, InstalledArtifact, Platform } from '@shared/types'
import { formatBytes, platformLabel } from '@shared/format'
import { download, fetchJson, fetchText, unzip } from '../net'
import { paths } from '../paths'
import { store } from '../store'
import { tasks } from '../tasks'
import { dirSize, readJson, writeFileAtomic } from '../util'

const CHANGELOG_URL = 'https://changelogs-live.fivem.net/api/changelog/versions/win32/server'
const DOCS_URL = 'https://docs.fivem.net/docs/server-download/?platform=legacy&os=windows'
const CACHE_TTL = 10 * 60 * 1000

interface ChangelogResponse {
  recommended: string
  latest: string
  critical: string
  recommended_download: string
  latest_download: string
  critical_download: string
  recommended_txadmin?: string
  latest_txadmin?: string
  critical_txadmin?: string
  support_policy?: Record<string, string>
}

interface DocsEntry {
  displayName: string
  subtitle: string
  downloadURL: string
}

interface DocsDownloads {
  legacy?: { recommended?: { windows?: DocsEntry[] }; latest?: { windows?: DocsEntry[] } }
  enhanced?: { windows?: DocsEntry[] }
}

interface ArtifactMeta {
  platform: Platform
  build: string
  url: string
  size: number
  installedAt: number
}

const buildOf = (subtitle: string): string | null => subtitle.match(/(\d+)/)?.[1] ?? null
// Legacy artifacts are published as both .7z and .zip; the zip needs no extra tooling to unpack.
const asZip = (url: string): string => url.replace(/server\.7z$/, 'server.zip')
const buildFromUrl = (url: string): string | null => url.match(/\/(\d+)-[0-9a-f]+\/server\.(?:zip|7z)$/)?.[1] ?? null

/** Executable names the server ships as, in order of preference. */
const EXE_CANDIDATES = ['FXServer.exe', 'cfx-server.exe', 'CitizenFX.Server.exe']

class Artifacts {
  private cache = new Map<Platform, ArtifactCatalog>()
  private inflight = new Map<string, Promise<void>>()

  private cacheFile(platform: Platform): string {
    return join(app.getPath('userData'), `catalog-${platform}.json`)
  }

  private async docsDownloads(): Promise<DocsDownloads | null> {
    try {
      const html = await fetchText(DOCS_URL)
      const m = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/)
      if (!m) return null
      return (JSON.parse(m[1]).props?.pageProps ?? null) as DocsDownloads | null
    } catch {
      return null
    }
  }

  async catalog(platform: Platform, refresh = false): Promise<ArtifactCatalog> {
    const cached = this.cache.get(platform)
    if (!refresh && cached && Date.now() - cached.fetchedAt < CACHE_TTL) return cached
    try {
      const catalog = platform === 'legacy' ? await this.fetchLegacy() : await this.fetchEnhanced()
      this.cache.set(platform, catalog)
      await writeFileAtomic(this.cacheFile(platform), JSON.stringify(catalog)).catch(() => undefined)
      return catalog
    } catch (err) {
      const disk = cached ?? (await readJson<ArtifactCatalog>(this.cacheFile(platform)))
      if (disk) return disk
      throw err
    }
  }

  private async fetchLegacy(): Promise<ArtifactCatalog> {
    const [changelog, docs] = await Promise.all([fetchJson<ChangelogResponse>(CHANGELOG_URL), this.docsDownloads()])
    const policy = changelog.support_policy ?? {}
    const builds = new Map<string, ArtifactBuild>()
    const add = (build: string | null, url: string, txAdmin?: string): void => {
      if (!build || builds.has(build)) return
      const until = policy[build]
      builds.set(build, {
        build,
        url: asZip(url),
        txAdmin,
        supportedUntil: until ? (until.startsWith('9999') ? null : until) : undefined
      })
    }
    add(changelog.latest, changelog.latest_download, changelog.latest_txadmin)
    add(changelog.recommended, changelog.recommended_download, changelog.recommended_txadmin)
    for (const e of [...(docs?.legacy?.latest?.windows ?? []), ...(docs?.legacy?.recommended?.windows ?? [])]) {
      add(buildOf(e.subtitle) ?? buildFromUrl(e.downloadURL), e.downloadURL)
    }
    add(changelog.critical, changelog.critical_download, changelog.critical_txadmin)
    return {
      platform: 'legacy',
      recommended: changelog.recommended,
      latest: changelog.latest,
      critical: changelog.critical,
      builds: [...builds.values()].sort((a, b) => Number(b.build) - Number(a.build)),
      fetchedAt: Date.now()
    }
  }

  private async fetchEnhanced(): Promise<ArtifactCatalog> {
    const docs = await this.docsDownloads()
    const entries = docs?.enhanced?.windows ?? []
    if (!entries.length) throw new Error('Could not load FiveM Enhanced builds')
    const builds = entries
      .map((e) => ({ build: buildOf(e.subtitle) ?? '0', url: e.downloadURL }))
      .sort((a, b) => Number(b.build) - Number(a.build))
    return {
      platform: 'enhanced',
      recommended: builds[0].build,
      latest: builds[0].build,
      critical: null,
      builds,
      fetchedAt: Date.now()
    }
  }

  async installed(): Promise<InstalledArtifact[]> {
    const out: InstalledArtifact[] = []
    for (const platform of ['legacy', 'enhanced'] as Platform[]) {
      const dir = paths.artifacts(platform)
      const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => [])
      for (const e of entries) {
        if (!e.isDirectory() || !/^\d+$/.test(e.name)) continue
        const path = join(dir, e.name)
        const meta = await readJson<ArtifactMeta>(join(path, '.meta.json'))
        if (!this.exeIn(path)) continue
        out.push({
          platform,
          build: e.name,
          path,
          size: meta?.size ?? 0,
          installedAt: meta?.installedAt ?? 0,
          usedBy: store.servers.filter((s) => s.platform === platform && s.build === e.name).map((s) => s.id)
        })
      }
    }
    return out.sort((a, b) => Number(b.build) - Number(a.build))
  }

  private exeIn(dir: string): string | null {
    for (const name of EXE_CANDIDATES) {
      const p = join(dir, name)
      if (existsSync(p)) return p
    }
    return null
  }

  exePath(platform: Platform, build: string): string | null {
    return this.exeIn(paths.artifact(platform, build))
  }

  isInstalled(platform: Platform, build: string): boolean {
    return this.exePath(platform, build) !== null
  }

  /** Downloads and unpacks a build. Concurrent calls for the same build share one download. */
  install(platform: Platform, build: string): Promise<void> {
    const key = `${platform}:${build}`
    const running = this.inflight.get(key)
    if (running) return running
    if (this.isInstalled(platform, build)) return Promise.resolve()
    const job = this.doInstall(platform, build).finally(() => this.inflight.delete(key))
    this.inflight.set(key, job)
    return job
  }

  private async doInstall(platform: Platform, build: string): Promise<void> {
    let entry = (await this.catalog(platform)).builds.find((b) => b.build === build)
    if (!entry) entry = (await this.catalog(platform, true)).builds.find((b) => b.build === build)
    if (!entry) throw new Error(`Build ${build} is not available for download`)
    const url = entry.url

    await tasks.run(`${platformLabel(platform)} build ${build}`, async (task) => {
      const zip = join(paths.downloads(), `${platform}-${build}.zip`)
      const dest = paths.artifact(platform, build)
      const staging = `${dest}.extracting`
      task.update({ detail: 'Connecting', progress: 0 })
      await download(url, zip, ({ received, total, speed }) => {
        task.update({
          progress: total ? (received / total) * 0.85 : null,
          detail: total
            ? `${formatBytes(received)} of ${formatBytes(total)} · ${formatBytes(speed)}/s`
            : `${formatBytes(received)} · ${formatBytes(speed)}/s`
        })
      })
      task.update({ detail: 'Unpacking', progress: 0.85 })
      await fs.rm(staging, { recursive: true, force: true })
      await unzip(zip, staging, (f) => task.update({ progress: 0.85 + f * 0.15 }))
      if (!this.exeIn(staging)) throw new Error('The downloaded build does not contain a server executable')
      await fs.rm(dest, { recursive: true, force: true })
      await fs.rename(staging, dest)
      const meta: ArtifactMeta = { platform, build, url, size: await dirSize(dest), installedAt: Date.now() }
      await writeFileAtomic(join(dest, '.meta.json'), JSON.stringify(meta, null, 2))
      await fs.rm(zip, { force: true })
    })
  }

  async remove(platform: Platform, build: string): Promise<void> {
    const users = store.servers.filter((s) => s.platform === platform && s.build === build)
    if (users.length) throw new Error(`Build ${build} is still used by ${users.map((s) => s.name).join(', ')}`)
    await fs.rm(paths.artifact(platform, build), { recursive: true, force: true })
  }
}

export const artifacts = new Artifacts()
