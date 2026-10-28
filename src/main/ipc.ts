import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { spawn } from 'node:child_process'
import type { AppSettings } from '@shared/types'
import { store } from './store'
import { tasks } from './tasks'
import { lifecycle } from './lifecycle'
import { checkForUpdates, installUpdate, updateState } from './updater'
import { errorMessage } from './util'
import { artifacts } from './services/artifacts'
import { database } from './services/database'
import { checkPorts, suggestPorts } from './services/ports'
import { runner } from './services/runner'
import { serverFiles } from './services/server-files'
import { servers } from './services/servers'

type Handler = (...args: never[]) => unknown

/**
 * Every handler resolves to `{ ok, value | error }` so the renderer receives the original
 * error message instead of Electron's "Error invoking remote method" wrapper.
 */
function handle(channel: string, fn: Handler): void {
  ipcMain.handle(channel, async (_e, ...args) => {
    try {
      return { ok: true, value: await (fn as (...a: unknown[]) => unknown)(...args) }
    } catch (err) {
      return { ok: false, error: errorMessage(err) }
    }
  })
}

function applyLoginItem(settings: AppSettings): void {
  if (!app.isPackaged) return
  app.setLoginItemSettings({ openAtLogin: settings.launchOnStartup, args: ['--hidden'] })
}

export function registerIpc(getWindow: () => BrowserWindow | null): void {
  // App
  handle('app:info', () => ({
    version: app.getVersion(),
    electron: process.versions.electron,
    platform: `${process.platform} ${process.getSystemVersion()}`,
    userData: app.getPath('userData'),
    heidiSqlPath: database.heidiSqlPath()
  }))
  ipcMain.on('app:titlebar', (_e, theme: 'dark' | 'light') => {
    const win = getWindow()
    if (!win || win.isDestroyed()) return
    win.setTitleBarOverlay(
      theme === 'dark' ? { color: '#0c0c0d', symbolColor: '#a1a1aa' } : { color: '#f4f4f5', symbolColor: '#52525b' }
    )
    win.setBackgroundColor(theme === 'dark' ? '#0c0c0d' : '#f4f4f5')
  })
  handle('app:openExternal', (url: string) => {
    if (!/^(https?|fivem):\/\//.test(url)) throw new Error('Unsupported link')
    return shell.openExternal(url)
  })
  handle('app:openPath', async (path: string) => {
    const err = await shell.openPath(path)
    if (err) throw new Error(err)
  })
  handle('app:showItemInFolder', (path: string) => shell.showItemInFolder(path))
  handle('app:openInEditor', (path: string) => {
    // Prefer VS Code when it's on PATH, otherwise fall back to the default app.
    return new Promise<void>((resolve) => {
      const p = spawn('code', [path], { shell: true, windowsHide: true, detached: true, stdio: 'ignore' })
      p.on('error', () => void shell.openPath(path).then(() => resolve()))
      p.on('exit', (code) => {
        if (code !== 0) void shell.openPath(path)
        resolve()
      })
      p.unref()
    })
  })
  handle('app:pickFolder', async (title: string, defaultPath?: string) => {
    const win = getWindow()
    const opts = { title, defaultPath, properties: ['openDirectory', 'createDirectory'] as ('openDirectory' | 'createDirectory')[] }
    const res = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
    return res.canceled ? null : res.filePaths[0]
  })

  // Settings
  handle('settings:get', () => store.settings)
  handle('settings:update', async (patch: Partial<AppSettings>) => {
    const before = store.settings
    const next = store.updateSettings(patch)
    if (patch.launchOnStartup !== undefined) applyLoginItem(next)
    if (patch.db) {
      if (before.db.mode === 'managed' && next.db.mode === 'external') await database.stop()
      void database.probe()
    }
    if (patch.admins || patch.adminPrincipals !== undefined || patch.sharedConfig !== undefined) {
      void runner.applySharedEverywhere()
    }
    return next
  })

  // Servers
  handle('servers:list', () => servers.list())
  handle('servers:runtime', () => runner.runtimeMap())
  handle('servers:create', (input) => servers.create(input))
  handle('servers:probeImport', (path: string) => servers.probeImport(path))
  handle('servers:import', (input) => servers.import(input))
  handle('servers:duplicate', (input) => servers.duplicate(input))
  handle('servers:update', (id: string, patch) => servers.update(id, patch))
  handle('servers:remove', (id: string, deleteFiles: boolean) => servers.remove(id, deleteFiles))
  handle('servers:start', (id: string) => runner.start(id))
  handle('servers:stop', (id: string) => runner.stop(id))
  handle('servers:restart', (id: string) => runner.restart(id))
  handle('servers:startAll', async () => {
    for (const s of store.servers) {
      if (!runner.isRunning(s.id)) await runner.start(s.id).catch(() => undefined)
    }
  })
  handle('servers:stopAll', () => runner.stopAll())
  handle('servers:command', (id: string, command: string) => runner.command(id, command))
  handle('servers:logs', (id: string) => runner.logs(id))
  handle('servers:clearLogs', (id: string) => runner.clearLogs(id))
  handle('servers:players', (id: string) => runner.players(id))
  handle('servers:files', (id: string) => serverFiles(store.server(id)))
  handle('servers:listConfigs', (id: string) => servers.listConfigs(id))
  handle('servers:readFile', (id: string, path: string) => servers.readFile(id, path))
  handle('servers:writeFile', (id: string, path: string, content: string) => servers.writeFile(id, path, content))
  handle('servers:resources', (id: string) => servers.resources(id))
  handle('servers:setResourceEnsured', (id: string, name: string, ensured: boolean) =>
    servers.setResourceEnsured(id, name, ensured)
  )
  handle('servers:resourceAction', (id: string, action, name?: string) => runner.resourceAction(id, action, name))
  handle('servers:suggestPorts', () => suggestPorts())
  handle('servers:checkPorts', (ports: number[], excludeId?: string) => checkPorts(ports, excludeId))
  handle('servers:connectionString', (id: string) => servers.connectionString(id))

  // Artifacts
  handle('artifacts:catalog', (platform, refresh?: boolean) => artifacts.catalog(platform, refresh))
  handle('artifacts:installed', () => artifacts.installed())
  handle('artifacts:install', (platform, build: string) => artifacts.install(platform, build))
  handle('artifacts:remove', (platform, build: string) => artifacts.remove(platform, build))

  // Database
  handle('db:status', () => database.status())
  handle('db:install', () => database.install())
  handle('db:start', () => database.start())
  handle('db:stop', () => database.stop())
  handle('db:startOnFreePort', () => database.startOnFreePort())
  handle('db:list', () => database.list())
  handle('db:create', (name: string) => database.create(name))
  handle('db:drop', (name: string) => database.drop(name))
  handle('db:test', (conn) => database.test(conn))
  handle('db:openHeidi', (name?: string) => database.openHeidi(name))
  handle('db:logs', () => database.getLogs())

  // Updates
  handle('updates:state', () => updateState())
  handle('updates:check', () => checkForUpdates())
  handle('updates:install', () => installUpdate(() => (lifecycle.quitting = true)))

  // Tasks
  handle('tasks:list', () => tasks.list())
  handle('tasks:dismiss', (id: string) => tasks.dismiss(id))
}
