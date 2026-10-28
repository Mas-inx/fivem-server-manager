import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import type { Api } from '@shared/api'

type Result<T> = { ok: true; value: T } | { ok: false; error: string }

async function call<T>(channel: string, ...args: unknown[]): Promise<T> {
  const res = (await ipcRenderer.invoke(channel, ...args)) as Result<T>
  if (!res.ok) throw new Error(res.error)
  return res.value
}

function subscribe<T>(channel: string, cb: (payload: T) => void): () => void {
  const listener = (_e: IpcRendererEvent, payload: T): void => cb(payload)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

const api: Api = {
  app: {
    info: () => call('app:info'),
    setTitleBarTheme: (theme) => ipcRenderer.send('app:titlebar', theme),
    openExternal: (url) => call('app:openExternal', url),
    openPath: (path) => call('app:openPath', path),
    showItemInFolder: (path) => call('app:showItemInFolder', path),
    openInEditor: (path) => call('app:openInEditor', path),
    pickFolder: (title, defaultPath) => call('app:pickFolder', title, defaultPath)
  },
  settings: {
    get: () => call('settings:get'),
    update: (patch) => call('settings:update', patch)
  },
  servers: {
    list: () => call('servers:list'),
    runtime: () => call('servers:runtime'),
    create: (input) => call('servers:create', input),
    probeImport: (path) => call('servers:probeImport', path),
    import: (input) => call('servers:import', input),
    duplicate: (input) => call('servers:duplicate', input),
    update: (id, patch) => call('servers:update', id, patch),
    remove: (id, deleteFiles) => call('servers:remove', id, deleteFiles),
    start: (id) => call('servers:start', id),
    stop: (id) => call('servers:stop', id),
    restart: (id) => call('servers:restart', id),
    startAll: () => call('servers:startAll'),
    stopAll: () => call('servers:stopAll'),
    command: (id, command) => call('servers:command', id, command),
    logs: (id) => call('servers:logs', id),
    clearLogs: (id) => call('servers:clearLogs', id),
    players: (id) => call('servers:players', id),
    files: (id) => call('servers:files', id),
    listConfigs: (id) => call('servers:listConfigs', id),
    readFile: (id, path) => call('servers:readFile', id, path),
    writeFile: (id, path, content) => call('servers:writeFile', id, path, content),
    resources: (id) => call('servers:resources', id),
    setResourceEnsured: (id, name, ensured) => call('servers:setResourceEnsured', id, name, ensured),
    resourceAction: (id, action, name) => call('servers:resourceAction', id, action, name),
    suggestPorts: () => call('servers:suggestPorts'),
    checkPorts: (ports, excludeId) => call('servers:checkPorts', ports, excludeId),
    connectionString: (id) => call('servers:connectionString', id)
  },
  artifacts: {
    catalog: (platform, refresh) => call('artifacts:catalog', platform, refresh),
    installed: () => call('artifacts:installed'),
    install: (platform, build) => call('artifacts:install', platform, build),
    remove: (platform, build) => call('artifacts:remove', platform, build)
  },
  db: {
    status: () => call('db:status'),
    install: () => call('db:install'),
    start: () => call('db:start'),
    stop: () => call('db:stop'),
    startOnFreePort: () => call('db:startOnFreePort'),
    list: () => call('db:list'),
    create: (name) => call('db:create', name),
    drop: (name) => call('db:drop', name),
    test: (connection) => call('db:test', connection),
    openHeidi: (database) => call('db:openHeidi', database),
    logs: () => call('db:logs')
  },
  updates: {
    state: () => call('updates:state'),
    check: () => call('updates:check'),
    install: () => call('updates:install')
  },
  tasks: {
    list: () => call('tasks:list'),
    dismiss: (id) => call('tasks:dismiss', id)
  },
  on: {
    servers: (cb) => subscribe('event:servers', cb),
    runtime: (cb) => subscribe('event:runtime', cb),
    logs: (cb) => subscribe('event:logs', cb),
    tasks: (cb) => subscribe('event:tasks', cb),
    db: (cb) => subscribe('event:db', cb),
    settings: (cb) => subscribe('event:settings', cb),
    toast: (cb) => subscribe('event:toast', cb),
    navigate: (cb) => subscribe('event:navigate', cb),
    update: (cb) => subscribe('event:update', cb)
  }
}

contextBridge.exposeInMainWorld('api', api)
