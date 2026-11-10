import { X509Certificate } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { createCa, createServerCert } from '../../src/main/sync/x509'

describe('hub certificates', () => {
  const ca = createCa('FiveM Server Manager hub CA')
  const server = createServerCert({ ...ca, commonName: 'FiveM Server Manager hub CA' }, ['203.0.113.7', 'hub.example.com', '127.0.0.1', '::1', 'localhost'])
  const caCert = new X509Certificate(ca.certPem)
  const leaf = new X509Certificate(server.certPem)

  it('makes a CA that signs the server certificate', () => {
    expect(caCert.ca).toBe(true)
    expect(caCert.verify(caCert.publicKey)).toBe(true)
    expect(leaf.ca).toBe(false)
    expect(leaf.verify(caCert.publicKey)).toBe(true)
    expect(leaf.checkIssued(caCert)).toBe(true)
  })

  it('covers every address the hub is reached on', () => {
    expect(leaf.checkIP('203.0.113.7')).toBe('203.0.113.7')
    expect(leaf.checkIP('127.0.0.1')).toBe('127.0.0.1')
    expect(leaf.checkIP('::1')).toBe('::1')
    expect(leaf.checkHost('hub.example.com')).toBe('hub.example.com')
    expect(leaf.checkHost('other.example.com')).toBeUndefined()
  })

  it('is valid now and for years', () => {
    expect(new Date(leaf.validFrom).getTime()).toBeLessThan(Date.now())
    expect(new Date(leaf.validTo).getTime()).toBeGreaterThan(Date.now() + 5 * 365 * 24 * 3600 * 1000)
  })
})
