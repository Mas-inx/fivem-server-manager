import { app, BrowserWindow, dialog, Menu, nativeImage, shell, Tray } from 'electron'
import { join } from 'node:path'
import icon from '../../resources/icon.png?asset'
import trayIcon from '../../resources/tray.png?asset'
import { broadcast } from './broadcast'
import { registerIpc } from './ipc'
import { lifecycle } from './lifecycle'
import { store } from './store'
import { sleep, throttle } from './util'
import { database } from './services/database'
import { initUpdater } from './updater'
import { runner } from './services/runner'

// Development hooks: an isolated profile and a debugging port for automated UI checks.
if (process.env.FSM_USER_DATA) app.setPath('userData', process.env.FSM_USER_DATA)
if (process.env.FSM_DEBUG_PORT) app.commandLine.appendSwitch('remote-debugging-port', process.env.FSM_DEBUG_PORT)

let win: BrowserWindow | null = null
let tray: Tray | null = null
let shuttingDown = false
let cleaned = false

const LOCAL_URL = /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?(\/|$)/

function showWindow(path?: string): void {
  if (!win || win.isDestroyed()) createWindow()
  if (win!.isMinimized()) win!.restore()
  win!.show()
  win!.focus()
  if (path) broadcast('event:navigate', path)
}

function createWindow(): void {
  const hidden = process.argv.includes('--hidden') || store.settings.startMinimized
  win = new BrowserWindow({
    width: 1320,
    height: 840,
    minWidth: 1000,
    minHeight: 640,
    show: false,
    backgroundColor: '#0c0c0d',
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#0c0c0d', symbolColor: '#a1a1aa', height: 44 },
    icon,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      webviewTag: true,
      spellcheck: false
    }
  })

  win.once('ready-to-show', () => {
    if (!hidden || !tray) win?.show()
  })

  win.on('close', (e) => {
    if (lifecycle.quitting) return
    if (store.settings.closeToTray && tray) {
      e.preventDefault()
      win?.hide()
      return
    }
    e.preventDefault()
    void requestQuit()
  })

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })

  // The embedded txAdmin panel may only ever load local pages, without Node access.
  win.webContents.on('will-attach-webview', (e, prefs, params) => {
    delete prefs.preload
    prefs.nodeIntegration = false
    prefs.contextIsolation = true
    if (!LOCAL_URL.test(params.src)) e.preventDefault()
  })
  win.webContents.on('did-attach-webview', (_e, contents) => {
    contents.setWindowOpenHandler(({ url }) => {
      if (/^https?:\/\//.test(url)) void shell.openExternal(url)
      return { action: 'deny' }
    })
    contents.on('will-navigate', (e, url) => {
      if (!LOCAL_URL.test(url)) {
        e.preventDefault()
        void shell.openExternal(url)
      }
    })
  })

  if (process.env.ELECTRON_RENDERER_URL) void win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else void win.loadFile(join(__dirname, '../renderer/index.html'))
}

const updateTray = throttle(() => {
  if (!tray) return
  const runtime = runner.runtimeMap()
  const items = store.servers.map((s): Electron.MenuItemConstructorOptions => {
    const r = runtime[s.id]
    const live = r && r.status !== 'stopped' && r.status !== 'crashed'
    return {
      label: `${s.name}${live ? `  ·  ${r.status === 'running' ? `${r.players} online` : r.status}` : ''}`,
      submenu: [
        { label: 'Open', click: (): void => showWindow(`/servers/${s.id}`) },
        { type: 'separator' as const },
        live
          ? { label: 'Stop', click: (): void => void runner.stop(s.id) }
          : { label: 'Start', click: (): void => void runner.start(s.id).catch(() => undefined) },
        { label: 'Restart', enabled: !!live, click: (): void => void runner.restart(s.id).catch(() => undefined) }
      ]
    }
  })
  const running = runner.runningCount()
  tray.setToolTip(running ? `FiveM Server Manager · ${running} running` : 'FiveM Server Manager')
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Open FiveM Server Manager', click: () => showWindow() },
      { type: 'separator' },
      ...(items.length ? items : [{ label: 'No servers yet', enabled: false }]),
      { type: 'separator' },
      { label: 'Stop all servers', enabled: running > 0, click: () => void runner.stopAll() },
      { label: 'Quit', click: () => void requestQuit() }
    ])
  )
}, 1000)

function createTray(): void {
  const image = nativeImage.createFromPath(trayIcon)
  tray = new Tray(image)
  tray.on('click', () => showWindow())
  updateTray()
}

async function requestQuit(): Promise<void> {
  const running = runner.runningCount()
  if (running > 0 && store.settings.confirmStop) {
    const parent = win && !win.isDestroyed() && win.isVisible() ? win : null
    const options: Electron.MessageBoxOptions = {
      type: 'question',
      buttons: ['Stop servers and quit', 'Cancel'],
      defaultId: 0,
      cancelId: 1,
      title: 'Quit',
      message: `${running} server${running === 1 ? ' is' : 's are'} still running`,
      detail: 'Quitting will stop every running server and the managed database.'
    }
    const res = parent ? await dialog.showMessageBox(parent, options) : await dialog.showMessageBox(options)
    if (res.response !== 0) return
  }
  lifecycle.quitting = true
  app.quit()
}

app.on('before-quit', (e) => {
  lifecycle.quitting = true
  if (cleaned) return
  e.preventDefault()
  if (shuttingDown) return
  shuttingDown = true
  void (async () => {
    await Promise.race([Promise.all([runner.stopAll(), store.flush()]), sleep(15000)])
    await Promise.race([database.dispose(), sleep(16000)])
    runner.dispose()
    cleaned = true
    app.quit()
  })()
})

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => showWindow())

  app.whenReady().then(async () => {
    app.setAppUserModelId('com.fivem-server-manager.app')
    store.load()
    registerIpc(() => win)
    createTray()
    createWindow()
    initUpdater()

    const refresh = (): void => updateTray()
    // Keep the tray menu in step with server state without coupling services to it.
    const origEmit = store.emitServers.bind(store)
    store.emitServers = () => {
      origEmit()
      refresh()
    }
    setInterval(refresh, 3000)

    if (store.settings.db.autoStart) {
      void database
        .ensureRunning()
        .catch(() => undefined)
        .finally(() => void database.probe())
    } else void database.probe()

    // Stagger auto-start so servers don't all hammer the disk at once.
    const autostart = store.servers.filter((s) => s.autoStart)
    for (const s of autostart) {
      await runner.start(s.id).catch(() => undefined)
      await sleep(1500)
    }
  })

  app.on('window-all-closed', () => {
    if (!tray) app.quit()
  })
}
