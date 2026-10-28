export type Platform = 'legacy' | 'enhanced'
export type ServerMode = 'txadmin' | 'standalone'
export type ServerStatus = 'stopped' | 'starting' | 'running' | 'stopping' | 'crashed'
export type ThemePreference = 'dark' | 'light' | 'system'

export interface TxAdminAccount {
  username: string
  password: string
}

/** Persisted definition of a server. */
export interface ServerConfig {
  id: string
  name: string
  slug: string
  /** Absolute path to the server's folder. */
  root: string
  platform: Platform
  build: string
  mode: ServerMode
  gamePort: number
  txAdminPort: number
  maxClients: number
  licenseKey: string
  /** Database name on the configured database server, if any. */
  database: string | null
  autoStart: boolean
  autoRestart: boolean
  launchArgs: string
  /** Standalone only: absolute path to server-data (folder containing server.cfg). */
  dataPath: string | null
  /** txAdmin only: txData location when it lives outside `root` (imported servers). */
  txDataPath: string | null
  txAdmin: TxAdminAccount | null
  notes: string
  createdAt: number
  lastStartedAt: number | null
}

/** Live state of a server, owned by the main process. */
export interface ServerRuntime {
  id: string
  status: ServerStatus
  pid: number | null
  startedAt: number | null
  exitCode: number | null
  gameOnline: boolean
  txAdminOnline: boolean
  players: number
  maxPlayers: number
  cpu: number
  memory: number
  crashes: number
  message: string | null
}

export interface PlayerInfo {
  id: number
  name: string
  ping: number
  identifiers: string[]
}

export interface LogLine {
  t: number
  text: string
  stream: 'out' | 'err' | 'sys'
}

export interface LogBatch {
  id: string
  lines: LogLine[]
}

export interface ArtifactBuild {
  build: string
  url: string
  txAdmin?: string
  /** ISO date after which the build is no longer supported, null = indefinitely. */
  supportedUntil?: string | null
}

export interface ArtifactCatalog {
  platform: Platform
  recommended: string | null
  latest: string | null
  critical: string | null
  builds: ArtifactBuild[]
  fetchedAt: number
}

export interface InstalledArtifact {
  platform: Platform
  build: string
  path: string
  size: number
  installedAt: number
  usedBy: string[]
}

export type DbMode = 'managed' | 'external'

export interface DbConnection {
  host: string
  port: number
  user: string
  password: string
}

export interface DbSettings {
  mode: DbMode
  external: DbConnection
  managedPort: number
  managedPassword: string
  managedVersion: string | null
  autoStart: boolean
}

export interface DbStatus {
  mode: DbMode
  installed: boolean
  running: boolean
  starting: boolean
  reachable: boolean
  version: string | null
  serverVersion: string | null
  port: number
  host: string
  dataDir: string | null
  error: string | null
}

export interface DatabaseInfo {
  name: string
  size: number
  tables: number
  usedBy: string[]
}

export interface AppSettings {
  libraryPath: string
  theme: ThemePreference
  defaultLicenseKey: string
  launchOnStartup: boolean
  startMinimized: boolean
  closeToTray: boolean
  confirmStop: boolean
  db: DbSettings
  onboarded: boolean
}

export interface TaskInfo {
  id: string
  title: string
  detail: string | null
  progress: number | null
  state: 'running' | 'done' | 'error'
  error: string | null
  startedAt: number
  finishedAt: number | null
}

export type DatabaseChoice =
  | { kind: 'none' }
  | { kind: 'create'; name: string }
  | { kind: 'existing'; name: string }

export interface CreateServerInput {
  name: string
  platform: Platform
  build: string
  mode: ServerMode
  gamePort: number
  txAdminPort: number
  maxClients: number
  licenseKey: string
  database: DatabaseChoice
  autoStart: boolean
  autoRestart: boolean
}

export interface ImportServerInput {
  name: string
  path: string
  platform: Platform
  build: string
  gamePort: number
  txAdminPort: number
  copy: boolean
}

export interface ImportProbe {
  path: string
  mode: ServerMode | null
  dataPath: string | null
  cfgFound: boolean
  txDataFound: boolean
  suggestedName: string
}

export interface DuplicateServerInput {
  sourceId: string
  name: string
  database: 'share' | 'clone' | 'empty' | 'none'
}

export interface ResourceInfo {
  name: string
  category: string | null
  path: string
  ensured: boolean
  /** Set when the resource is started through its [category] rather than by name. */
  viaCategory: string | null
}

export interface ServerFiles {
  root: string
  dataPath: string | null
  cfgPath: string | null
  txDataPath: string | null
  logsPath: string
}

export interface PortCheck {
  port: number
  free: boolean
  usedBy: string | null
}

export interface AppInfo {
  version: string
  electron: string
  platform: string
  userData: string
  heidiSqlPath: string | null
}

export interface ToastEvent {
  kind: 'info' | 'success' | 'error'
  title: string
  description?: string
}

export interface ServerPatch {
  name?: string
  build?: string
  platform?: Platform
  gamePort?: number
  txAdminPort?: number
  maxClients?: number
  licenseKey?: string
  database?: string | null
  autoStart?: boolean
  autoRestart?: boolean
  launchArgs?: string
  notes?: string
  txAdmin?: TxAdminAccount | null
}
