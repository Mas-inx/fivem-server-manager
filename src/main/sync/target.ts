import type { SyncRemote, SyncRemoteInput } from '@shared/types'
import type { ResticTarget } from './restic'

export interface RemoteSecrets {
  accessKeyId: string
  secretAccessKey: string
  repoPassword: string
  /** rest: the hub's password. */
  restPassword?: string
}

const trimSlashes = (s: string): string => s.trim().replace(/^\/+|\/+$/g, '')

/** R2 takes either the account id or the full S3 endpoint from the Cloudflare dashboard. */
export function r2Endpoint(endpoint: string): string {
  const e = endpoint.trim().replace(/\/+$/, '')
  if (/^https?:\/\//i.test(e)) return e
  return `https://${e}.r2.cloudflarestorage.com`
}

/** A hub address as typed (host, host:port or a URL) as the https URL restic needs, with a trailing slash. */
export function hubUrl(endpoint: string, defaultPort = 8000): string {
  let e = endpoint.trim().replace(/\/+$/, '')
  if (!/^https?:\/\//i.test(e)) e = `https://${e}`
  const url = new URL(e)
  if (!url.port && url.protocol === 'https:' && !/:\d+$/.test(e)) url.port = String(defaultPort)
  return url.toString().replace(/\/?$/, '/')
}

const quoteArg = (s: string): string => (/[\s"]/.test(s) ? `"${s.replace(/"/g, '\\"')}"` : s)

/**
 * Where restic finds a remote and what it needs to open it. Secrets only ever travel in the
 * environment. `certFile` is the hub's CA certificate written to disk, for rest remotes.
 */
export function resticTarget(remote: SyncRemote, secrets: RemoteSecrets, certFile?: string): ResticTarget {
  const base = { password: secrets.repoPassword, env: {} as Record<string, string>, options: [] as string[] }
  switch (remote.kind) {
    case 'rest':
      return {
        ...base,
        repository: `rest:${hubUrl(remote.endpoint)}`,
        env: { RESTIC_REST_USERNAME: remote.user.trim(), RESTIC_REST_PASSWORD: secrets.restPassword ?? '' },
        options: certFile ? ['--cacert', certFile] : []
      }
    case 'local':
      return { ...base, repository: remote.path.trim() }
    case 'r2':
    case 's3': {
      const endpoint = remote.kind === 'r2' ? r2Endpoint(remote.endpoint) : remote.endpoint.trim().replace(/\/+$/, '') || 'https://s3.amazonaws.com'
      const prefix = trimSlashes(remote.prefix)
      const region = remote.kind === 'r2' ? 'auto' : remote.region.trim()
      const env: Record<string, string> = {
        AWS_ACCESS_KEY_ID: secrets.accessKeyId,
        AWS_SECRET_ACCESS_KEY: secrets.secretAccessKey
      }
      if (region) env.AWS_DEFAULT_REGION = region
      const options = remote.kind === 'r2' ? ['-o', 's3.bucket-lookup=path', '-o', 's3.region=auto'] : region ? ['-o', `s3.region=${region}`] : []
      return {
        ...base,
        repository: `s3:${endpoint}/${trimSlashes(remote.bucket)}${prefix ? `/${prefix}` : ''}`,
        env,
        options
      }
    }
    case 'sftp': {
      // BatchMode stops ssh from waiting on a password prompt nobody can see; keys come from ssh-agent,
      // ~/.ssh, or the key file given here.
      const args = ['-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=accept-new']
      if (remote.port && remote.port !== 22) args.push('-p', String(remote.port))
      if (remote.keyFile.trim()) args.push('-i', quoteArg(remote.keyFile.trim()))
      return {
        ...base,
        repository: `sftp:${remote.user.trim()}@${remote.host.trim()}:${remote.path.trim()}`,
        options: ['-o', `sftp.args=${args.join(' ')}`]
      }
    }
  }
}

/** Checks a remote's fields before anything is saved or contacted. */
export function validateRemote(input: Omit<SyncRemoteInput, 'repoPassword'>): string | null {
  if (!input.name.trim()) return 'Give the remote a name'
  switch (input.kind) {
    case 'rest':
      if (!input.endpoint.trim()) return "Enter the hub's address"
      try {
        hubUrl(input.endpoint)
      } catch {
        return 'That hub address is not valid'
      }
      if (!input.user.trim() || !input.restPassword.trim()) return "Enter the hub's user and password"
      return input.certPem.includes('BEGIN CERTIFICATE') ? null : "Paste the hub's certificate, or use its connection code"
    case 'local':
      return input.path.trim() ? null : 'Choose a folder'
    case 'r2':
    case 's3':
      if (input.kind === 'r2' && !input.endpoint.trim()) return 'Enter the R2 account id or endpoint'
      if (!input.bucket.trim()) return 'Enter the bucket name'
      if (!input.accessKeyId.trim() || !input.secretAccessKey.trim()) return 'Enter the access key id and secret'
      return null
    case 'sftp':
      if (!input.host.trim() || !input.user.trim()) return 'Enter the host and user'
      return input.path.trim() ? null : 'Enter the folder on the host'
  }
}

const CODE_PREFIX = 'fsmsync1.'

type CodePayload = Omit<SyncRemoteInput, 'keyFile'>

/**
 * A connection code carries everything another machine needs to open the same repository, keys
 * and password included, so it is as sensitive as the keys themselves. Key files stay local.
 */
export function encodeConnectionCode(remote: SyncRemote, secrets: RemoteSecrets): string {
  const payload: CodePayload = {
    name: remote.name,
    kind: remote.kind,
    endpoint: remote.endpoint,
    bucket: remote.bucket,
    prefix: remote.prefix,
    region: remote.region,
    host: remote.host,
    port: remote.port,
    user: remote.user,
    path: remote.path,
    certPem: remote.certPem,
    restPassword: secrets.restPassword ?? '',
    accessKeyId: secrets.accessKeyId,
    secretAccessKey: secrets.secretAccessKey,
    repoPassword: secrets.repoPassword
  }
  return CODE_PREFIX + Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')
}

export function decodeConnectionCode(code: string): SyncRemoteInput {
  const trimmed = code.trim().replace(/\s+/g, '')
  if (!trimmed.startsWith(CODE_PREFIX)) throw new Error('That is not a connection code from FiveM Server Manager')
  let payload: Partial<CodePayload>
  try {
    payload = JSON.parse(Buffer.from(trimmed.slice(CODE_PREFIX.length), 'base64url').toString('utf8')) as Partial<CodePayload>
  } catch {
    throw new Error('The connection code is damaged; copy it again')
  }
  if (!payload.kind || !['rest', 'r2', 's3', 'sftp', 'local'].includes(payload.kind) || !payload.repoPassword) {
    throw new Error('The connection code is incomplete; copy it again')
  }
  return {
    name: payload.name ?? 'Remote',
    kind: payload.kind,
    endpoint: payload.endpoint ?? '',
    bucket: payload.bucket ?? '',
    prefix: payload.prefix ?? '',
    region: payload.region ?? '',
    host: payload.host ?? '',
    port: payload.port ?? 22,
    user: payload.user ?? '',
    path: payload.path ?? '',
    keyFile: '',
    certPem: payload.certPem ?? '',
    restPassword: payload.restPassword ?? '',
    accessKeyId: payload.accessKeyId ?? '',
    secretAccessKey: payload.secretAccessKey ?? '',
    repoPassword: payload.repoPassword
  }
}
