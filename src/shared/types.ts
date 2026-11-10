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
  /** Applies universal admins and the shared config to this server. */
  shared: boolean
  /** txAdmin account names the manager added, so removed admins can be cleaned up. */
  syncedAdmins: string[]
  notes: string
  createdAt: number
  lastStartedAt: number | null
  /** Sync settings; null when the server is not synced. */
  sync: ServerSyncConfig | null
  /** What this machine last pushed or pulled. Kept per machine, never synced. */
  syncState: ServerSyncState | null
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
  admins: UniversalAdmin[]
  /** Principals universal admins are added to, separated by spaces. */
  adminPrincipals: string
  /** cfg lines executed by every server after its own server.cfg. */
  sharedConfig: string
  onboarded: boolean
  /** Name this machine uses on snapshots it pushes. */
  syncMachineName: string
  /** This machine as the sync hub: a rest-server the other machines push to and pull from. */
  syncHub: HubSettings
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
  shared?: boolean
}

export type UpdateStatus = 'idle' | 'unsupported' | 'checking' | 'up-to-date' | 'downloading' | 'ready' | 'error'

export interface UpdateState {
  status: UpdateStatus
  /** The version running now. */
  current: string
  /** The newer version found, while it downloads and once it is ready to install. */
  version?: string
  /** Download progress, 0..1. */
  progress?: number
  /** Release notes as plain text. */
  notes?: string
  error?: string
  /** When the last check finished (ms). */
  checkedAt?: number
}

export type ResourceAction = 'refresh' | 'restart' | 'start' | 'stop' | 'ensure'

/** Someone who is an admin on every server that uses the shared settings. */
export interface UniversalAdmin {
  id: string
  /** Display name, also used as their txAdmin username. */
  name: string
  /** Player identifiers such as fivem:123, license:abc, discord:123, steam:1100001… */
  identifiers: string[]
  /** In-game permissions through add_principal in the managed config. */
  ace: boolean
  /** An account in txAdmin's panel on txAdmin servers (needs a fivem: or discord: identifier). */
  panel: boolean
}

export const IDENTIFIER_PATTERN = /^(fivem|license2?|discord|steam|xbl|live):[A-Za-z0-9]+$/
export const TXADMIN_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{1,18}[A-Za-z0-9]$/

// ---------------------------------------------------------------------------------------------
// Sync

/** rest: a hub on one of your own machines (restic rest-server over HTTPS). */
export type SyncRemoteKind = 'rest' | 'r2' | 's3' | 'sftp' | 'local'

/** A storage remote as the renderer sees it; keys and the repo password never leave the main process. */
export interface SyncRemote {
  id: string
  name: string
  kind: SyncRemoteKind
  /** rest: hub address (https://host:port); r2: account id or endpoint URL; s3: endpoint URL. */
  endpoint: string
  bucket: string
  /** Folder inside the bucket. */
  prefix: string
  region: string
  /** sftp */
  host: string
  port: number
  user: string
  /** sftp: folder on the host; local: folder on this machine or a network share. */
  path: string
  /** sftp: private key file, empty to use ssh-agent or ~/.ssh. */
  keyFile: string
  /** rest: the hub's own CA certificate (PEM). Only servers signed by it are trusted. */
  certPem: string
  createdAt: number
}

export interface SyncRemoteInput {
  name: string
  kind: SyncRemoteKind
  endpoint: string
  bucket: string
  prefix: string
  region: string
  host: string
  port: number
  user: string
  path: string
  keyFile: string
  certPem: string
  /** rest: the hub's password for `user`. */
  restPassword: string
  accessKeyId: string
  secretAccessKey: string
  /** Blank creates a strong random password. Needed to open an existing repository. */
  repoPassword: string
}

export interface ServerSyncConfig {
  /** Shared by every copy of this server, on every machine. */
  id: string
  remoteId: string
  includeDatabase: boolean
}

export interface ServerSyncState {
  /** Snapshot this machine last pushed or pulled, the base for conflict checks. */
  base: string | null
  lastAction: 'push' | 'pull' | 'clone' | 'restore' | null
  lastAt: number | null
  /** Set when a push was cancelled or failed part-way; pushing again resumes it. */
  interrupted: boolean
}

export type SyncSnapshotKind = 'push' | 'pre-pull'

export interface SyncSnapshot {
  id: string
  shortId: string
  time: number
  machine: string
  kind: SyncSnapshotKind
  syncId: string
  name: string
  platform: Platform | null
  build: string | null
  mode: ServerMode | null
  hasDatabase: boolean
  files: number
  bytes: number
  /** Bytes this snapshot added to the remote, after dedup and compression. */
  added: number
}

export interface FileChange {
  path: string
  change: 'added' | 'removed' | 'modified'
}

export type SyncCheckState = 'no-remote-copy' | 'never-synced' | 'in-sync' | 'local-changed' | 'remote-changed' | 'diverged'

export interface SyncCheck {
  state: SyncCheckState
  base: string | null
  latest: SyncSnapshot | null
  local: FileChange[]
  remote: FileChange[]
  /** True when the remote change list could not be read (for example the base snapshot was removed). */
  remoteUnknown: boolean
}

export type SyncOp = 'push' | 'pull' | 'clone' | 'restore'

export interface SyncProgress {
  serverId: string
  op: SyncOp
  phase: string
  /** 0..1, null while unknown. */
  fraction: number | null
  bytesDone: number
  bytesTotal: number
  filesDone: number
  filesTotal: number
  /** Bytes per second, smoothed. */
  speed: number
  /** Seconds left, null while unknown. */
  eta: number | null
  startedAt: number
}

export interface RemoteServerEntry {
  syncId: string
  name: string
  latest: SyncSnapshot
  snapshots: number
}

export interface SyncPushOptions {
  includeDatabase: boolean
  /** Skips the conflict check (the user saw the warning and chose to continue). */
  force: boolean
}

export interface SyncPullOptions {
  /** Restore this snapshot instead of the latest push. */
  snapshotId?: string
  importDatabase: boolean
  force: boolean
}

export interface SyncCloneInput {
  remoteId: string
  syncId: string
  snapshotId?: string
  name: string
  gamePort: number
  txAdminPort: number
  importDatabase: boolean
}

export interface SyncEngineInfo {
  version: string
  installed: boolean
}

export type SyncResult =
  | { status: 'done'; snapshot: SyncSnapshot | null; restorePoint?: string; message: string }
  | { status: 'conflict'; check: SyncCheck }

export interface HubSettings {
  enabled: boolean
  port: number
  /** Where the repository lives. Every machine's history ends up here. */
  dataPath: string
  /** Address the other machines use to reach this one (public IP or DNS name). */
  publicAddress: string
  /** Clients can add snapshots but never delete or rewrite them. */
  appendOnly: boolean
  autoStart: boolean
}

export type HubSetupInput = Omit<HubSettings, 'enabled'>

export interface HubStatus {
  version: string
  configured: boolean
  running: boolean
  starting: boolean
  settings: HubSettings
  /** Addresses this machine has, public ones first, to offer as the public address. */
  addresses: string[]
  /** Null when Windows could not be asked. */
  firewallOpen: boolean | null
  repoBytes: number | null
  diskFree: number | null
  error: string | null
}
