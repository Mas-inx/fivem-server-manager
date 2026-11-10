import { describe, expect, it } from 'vitest'
import type { SyncRemote } from '../../src/shared/types'
import { decodeConnectionCode, encodeConnectionCode, hubUrl, r2Endpoint, resticTarget } from '../../src/main/sync/target'

const base: SyncRemote = {
  id: 'r1',
  name: 'R2',
  kind: 'r2',
  endpoint: 'abc123',
  bucket: 'fivem-sync',
  prefix: '/servers/',
  region: '',
  host: '',
  port: 22,
  user: '',
  path: '',
  keyFile: '',
  certPem: '',
  createdAt: 0
}
const secrets = { accessKeyId: 'AKIDEXAMPLE', secretAccessKey: 'secretsecret', repoPassword: 'repo-password-123' }

describe('resticTarget', () => {
  it('builds an R2 repository with keys only in the environment', () => {
    const t = resticTarget(base, secrets)
    expect(t.repository).toBe('s3:https://abc123.r2.cloudflarestorage.com/fivem-sync/servers')
    expect(t.env).toMatchObject({ AWS_ACCESS_KEY_ID: 'AKIDEXAMPLE', AWS_SECRET_ACCESS_KEY: 'secretsecret', AWS_DEFAULT_REGION: 'auto' })
    expect(t.options.join(' ')).not.toContain('secret')
  })

  it('accepts a full R2 endpoint URL', () => {
    expect(r2Endpoint('https://abc.r2.cloudflarestorage.com/')).toBe('https://abc.r2.cloudflarestorage.com')
  })

  it('builds SFTP and folder repositories', () => {
    const sftp = resticTarget({ ...base, kind: 'sftp', host: 'vps.example', user: 'admin', path: '/srv/fsm', port: 2222, keyFile: 'C:\\Users\\me\\.ssh\\id ed' }, secrets)
    expect(sftp.repository).toBe('sftp:admin@vps.example:/srv/fsm')
    expect(sftp.options[1]).toBe('sftp.args=-o BatchMode=yes -o StrictHostKeyChecking=accept-new -p 2222 -i "C:\\Users\\me\\.ssh\\id ed"')
    expect(resticTarget({ ...base, kind: 'local', path: 'E:\\sync' }, secrets).repository).toBe('E:\\sync')
  })
})

describe('hub (rest-server) remotes', () => {
  const hub = { ...base, kind: 'rest' as const, endpoint: '203.0.113.7', user: 'fsm', certPem: '-----BEGIN CERTIFICATE-----' }

  it('reach the hub over https with the pinned CA and credentials from the environment', () => {
    const t = resticTarget(hub, { ...secrets, restPassword: 'hubpass-123' }, 'C:/certs/hub.pem')
    expect(t.repository).toBe('rest:https://203.0.113.7:8000/')
    expect(t.env).toEqual({ RESTIC_REST_USERNAME: 'fsm', RESTIC_REST_PASSWORD: 'hubpass-123' })
    expect(t.options).toEqual(['--cacert', 'C:/certs/hub.pem'])
    expect(t.repository).not.toContain('hubpass')
  })

  it('normalise addresses', () => {
    expect(hubUrl('hub.example.com:9000')).toBe('https://hub.example.com:9000/')
    expect(hubUrl('https://hub.example.com/')).toBe('https://hub.example.com:8000/')
    expect(hubUrl('https://[2001:db8::1]:8443')).toBe('https://[2001:db8::1]:8443/')
  })

  it('carry the certificate and hub password in the connection code', () => {
    const input = decodeConnectionCode(encodeConnectionCode(hub, { ...secrets, restPassword: 'hubpass-123' }))
    expect(input).toMatchObject({ kind: 'rest', endpoint: '203.0.113.7', user: 'fsm', restPassword: 'hubpass-123', certPem: hub.certPem })
  })
})

describe('connection codes', () => {
  it('carry the remote and its keys to another machine', () => {
    const code = encodeConnectionCode(base, secrets)
    expect(code.startsWith('fsmsync1.')).toBe(true)
    const input = decodeConnectionCode(`  ${code.slice(0, 20)}\n${code.slice(20)}  `)
    expect(input).toMatchObject({ kind: 'r2', bucket: 'fivem-sync', endpoint: 'abc123', ...secrets })
  })

  it('refuse anything else', () => {
    expect(() => decodeConnectionCode('hello')).toThrow(/not a connection code/)
    expect(() => decodeConnectionCode('fsmsync1.!!!')).toThrow()
  })
})
