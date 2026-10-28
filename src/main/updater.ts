import { app } from 'electron'
import electronUpdater, { type UpdateInfo } from 'electron-updater'
import type { UpdateState } from '@shared/types'
import { broadcast } from './broadcast'

/**
 * Updates from the GitHub Releases page. electron-updater reads latest.yml from the newest
 * release, downloads the installer in the background (only changed blocks when it can) and
 * installs it silently on the next restart, right away if the user asks.
 *
 * FSM_UPDATE_URL points the updater at another feed (a folder served over HTTP with
 * latest.yml and an installer) to try the whole flow locally.
 */

const { autoUpdater } = electronUpdater

const FIRST_CHECK = 15_000
const CHECK_EVERY = 4 * 60 * 60_000

let state: UpdateState = { status: 'idle', current: app.getVersion() }
let started = false

function set(patch: Partial<UpdateState>): void {
  state = { ...state, ...patch }
  broadcast('event:update', state)
}

export const updateState = (): UpdateState => state

/** GitHub release notes arrive as HTML; the app shows them as plain text. */
function notesOf(info: Pick<UpdateInfo, 'releaseNotes'>): string | undefined {
  const raw = Array.isArray(info.releaseNotes)
    ? info.releaseNotes.map((n) => n.note ?? '').join('\n\n')
    : (info.releaseNotes ?? '')
  const text = raw
    .replace(/<\/(p|li|h\d|div)>|<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  return text ? text.slice(0, 4000) : undefined
}

function friendly(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err)
  if (/ERR_INTERNET_DISCONNECTED|ERR_NAME_NOT_RESOLVED|ENOTFOUND|ECONNREFUSED|ETIMEDOUT|ERR_CONNECTION|ERR_NETWORK/i.test(message)) {
    return "Couldn't reach GitHub. Check your connection and try again."
  }
  if (/latest\.yml|No published versions|HttpError: 404|status 404/i.test(message)) {
    return 'The Releases page has no update for this version yet.'
  }
  if (/sha512 checksum mismatch/i.test(message)) {
    return "The download didn't match the release checksum, so it was discarded. Try again later."
  }
  return message.split('\n')[0].slice(0, 240)
}

/** Starts watching for updates. Development builds report "unsupported"; only installed apps update. */
export function initUpdater(): void {
  if (started) return
  started = true
  const feed = process.env.FSM_UPDATE_URL
  if (!app.isPackaged && !feed) {
    set({ status: 'unsupported' })
    return
  }
  if (feed) {
    autoUpdater.setFeedURL({ provider: 'generic', url: feed })
    autoUpdater.forceDevUpdateConfig = !app.isPackaged
  }
  autoUpdater.logger = null
  autoUpdater.autoDownload = true
  // A test feed installs only when asked, never just because the app quit.
  autoUpdater.autoInstallOnAppQuit = !feed
  autoUpdater.allowPrerelease = false

  autoUpdater.on('checking-for-update', () => set({ status: 'checking', error: undefined }))
  autoUpdater.on('update-not-available', () =>
    set({ status: 'up-to-date', checkedAt: Date.now(), version: undefined, progress: undefined })
  )
  autoUpdater.on('update-available', (info) =>
    set({ status: 'downloading', version: info.version, notes: notesOf(info), progress: 0, checkedAt: Date.now() })
  )
  autoUpdater.on('download-progress', (p) => set({ status: 'downloading', progress: Math.min(1, Math.max(0, p.percent / 100)) }))
  autoUpdater.on('update-downloaded', (info) =>
    set({ status: 'ready', version: info.version, notes: notesOf(info) ?? state.notes, progress: 1 })
  )
  autoUpdater.on('error', (err) => {
    if (state.status !== 'ready') set({ status: 'error', error: friendly(err), checkedAt: Date.now() })
  })

  // Isolated test profiles stay off the network unless they bring their own feed.
  if (process.env.FSM_USER_DATA && !feed) return
  setTimeout(() => void checkForUpdates(), FIRST_CHECK)
  setInterval(() => void checkForUpdates(), CHECK_EVERY).unref()
}

/** Checks now; a newer version starts downloading by itself. */
export async function checkForUpdates(): Promise<UpdateState> {
  if (!started || ['unsupported', 'checking', 'downloading', 'ready'].includes(state.status)) return state
  try {
    await autoUpdater.checkForUpdates()
  } catch (err) {
    set({ status: 'error', error: friendly(err), checkedAt: Date.now() })
  }
  return state
}

/** Quits, installs the downloaded version silently and reopens the app. */
export function installUpdate(beforeInstall: () => void): boolean {
  if (state.status !== 'ready') return false
  beforeInstall()
  setImmediate(() => autoUpdater.quitAndInstall(true, true))
  return true
}
