import type {
  AppInfo,
  AppSettings,
  ArtifactCatalog,
  CreateServerInput,
  DatabaseInfo,
  DbConnection,
  DbStatus,
  DuplicateServerInput,
  ImportProbe,
  ImportServerInput,
  InstalledArtifact,
  LogBatch,
  LogLine,
  Platform,
  PlayerInfo,
  PortCheck,
  ResourceInfo,
  ServerConfig,
  ServerFiles,
  ServerPatch,
  ServerRuntime,
  TaskInfo,
  ToastEvent
} from './types'

export type Unsubscribe = () => void

/** The surface exposed to the renderer as `window.api`. */
export interface Api {
  app: {
    info(): Promise<AppInfo>
    setTitleBarTheme(theme: 'dark' | 'light'): void
    openExternal(url: string): Promise<void>
    openPath(path: string): Promise<void>
    showItemInFolder(path: string): Promise<void>
    openInEditor(path: string): Promise<void>
    pickFolder(title: string, defaultPath?: string): Promise<string | null>
  }
  settings: {
    get(): Promise<AppSettings>
    update(patch: Partial<AppSettings>): Promise<AppSettings>
  }
  servers: {
    list(): Promise<ServerConfig[]>
    runtime(): Promise<Record<string, ServerRuntime>>
    create(input: CreateServerInput): Promise<ServerConfig>
    probeImport(path: string): Promise<ImportProbe>
    import(input: ImportServerInput): Promise<ServerConfig>
    duplicate(input: DuplicateServerInput): Promise<ServerConfig>
    update(id: string, patch: ServerPatch): Promise<ServerConfig>
    remove(id: string, deleteFiles: boolean): Promise<void>
    start(id: string): Promise<void>
    stop(id: string): Promise<void>
    restart(id: string): Promise<void>
    startAll(): Promise<void>
    stopAll(): Promise<void>
    command(id: string, command: string): Promise<void>
    logs(id: string): Promise<LogLine[]>
    clearLogs(id: string): Promise<void>
    players(id: string): Promise<PlayerInfo[]>
    files(id: string): Promise<ServerFiles>
    listConfigs(id: string): Promise<string[]>
    readFile(id: string, path: string): Promise<string>
    writeFile(id: string, path: string, content: string): Promise<void>
    resources(id: string): Promise<ResourceInfo[]>
    setResourceEnsured(id: string, name: string, ensured: boolean): Promise<void>
    suggestPorts(): Promise<{ gamePort: number; txAdminPort: number }>
    checkPorts(ports: number[], excludeId?: string): Promise<PortCheck[]>
    connectionString(id: string): Promise<string | null>
  }
  artifacts: {
    catalog(platform: Platform, refresh?: boolean): Promise<ArtifactCatalog>
    installed(): Promise<InstalledArtifact[]>
    install(platform: Platform, build: string): Promise<void>
    remove(platform: Platform, build: string): Promise<void>
  }
  db: {
    status(): Promise<DbStatus>
    install(): Promise<void>
    start(): Promise<void>
    stop(): Promise<void>
    startOnFreePort(): Promise<number>
    list(): Promise<DatabaseInfo[]>
    create(name: string): Promise<void>
    drop(name: string): Promise<void>
    test(connection: DbConnection): Promise<{ ok: boolean; version?: string; error?: string }>
    openHeidi(database?: string): Promise<void>
    logs(): Promise<LogLine[]>
  }
  tasks: {
    list(): Promise<TaskInfo[]>
    dismiss(id: string): Promise<void>
  }
  on: {
    servers(cb: (servers: ServerConfig[]) => void): Unsubscribe
    runtime(cb: (runtime: Record<string, ServerRuntime>) => void): Unsubscribe
    logs(cb: (batch: LogBatch) => void): Unsubscribe
    tasks(cb: (tasks: TaskInfo[]) => void): Unsubscribe
    db(cb: (status: DbStatus) => void): Unsubscribe
    settings(cb: (settings: AppSettings) => void): Unsubscribe
    toast(cb: (toast: ToastEvent) => void): Unsubscribe
    navigate(cb: (path: string) => void): Unsubscribe
  }
}

