import { createPrivateKey, generateKeyPairSync, randomBytes, sign, type KeyObject } from 'node:crypto'
import { isIP } from 'node:net'

/**
 * Just enough X.509 to give the sync hub its own certificate authority and a server certificate,
 * without OpenSSL on the machine. The CA certificate travels in the connection code and clients
 * trust only it (restic --cacert), so a changed hub address only needs a new server certificate.
 */

const len = (n: number): Buffer => {
  if (n < 0x80) return Buffer.from([n])
  const bytes: number[] = []
  for (let v = n; v > 0; v >>= 8) bytes.unshift(v & 0xff)
  return Buffer.from([0x80 | bytes.length, ...bytes])
}
const tlv = (tag: number, body: Buffer): Buffer => Buffer.concat([Buffer.from([tag]), len(body.length), body])
const seq = (...items: Buffer[]): Buffer => tlv(0x30, Buffer.concat(items))
const set = (...items: Buffer[]): Buffer => tlv(0x31, Buffer.concat(items))
const ctx = (n: number, body: Buffer): Buffer => tlv(0xa0 | n, body)
const bool = (v: boolean): Buffer => tlv(0x01, Buffer.from([v ? 0xff : 0]))
const octets = (b: Buffer): Buffer => tlv(0x04, b)
const bits = (b: Buffer, unused = 0): Buffer => tlv(0x03, Buffer.concat([Buffer.from([unused]), b]))
const utf8 = (s: string): Buffer => tlv(0x0c, Buffer.from(s, 'utf8'))

function integer(b: Buffer): Buffer {
  let x = b
  while (x.length > 1 && x[0] === 0 && !(x[1] & 0x80)) x = x.subarray(1)
  if (x[0] & 0x80) x = Buffer.concat([Buffer.from([0]), x])
  return tlv(0x02, x)
}

function oid(dotted: string): Buffer {
  const [a, b, ...rest] = dotted.split('.').map(Number)
  const out = [40 * a + b]
  for (const p of rest) {
    const chunk = [p & 0x7f]
    for (let v = Math.floor(p / 128); v > 0; v = Math.floor(v / 128)) chunk.unshift((v & 0x7f) | 0x80)
    out.push(...chunk)
  }
  return tlv(0x06, Buffer.from(out))
}

function time(d: Date): Buffer {
  const p = (n: number): string => String(n).padStart(2, '0')
  const rest = `${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`
  const y = d.getUTCFullYear()
  return y < 2050 ? tlv(0x17, Buffer.from(String(y).slice(2) + rest)) : tlv(0x18, Buffer.from(String(y) + rest))
}

const name = (cn: string): Buffer => seq(set(seq(oid('2.5.4.3'), utf8(cn))))
const ECDSA_SHA256 = seq(oid('1.2.840.10045.4.3.2'))
const ext = (id: string, critical: boolean, value: Buffer): Buffer => seq(oid(id), ...(critical ? [bool(true)] : []), octets(value))

function ipBytes(ip: string): Buffer {
  if (isIP(ip) === 4) return Buffer.from(ip.split('.').map(Number))
  const [head, tail = ''] = ip.split('::')
  const h = head ? head.split(':') : []
  const t = ip.includes('::') && tail ? tail.split(':') : []
  const groups = [...h, ...Array(8 - h.length - t.length).fill('0'), ...t]
  return Buffer.concat(groups.map((g) => Buffer.from(g.padStart(4, '0'), 'hex')))
}

function toPem(der: Buffer): string {
  const b64 = der.toString('base64').match(/.{1,64}/g)!.join('\n')
  return `-----BEGIN CERTIFICATE-----\n${b64}\n-----END CERTIFICATE-----\n`
}

function build(opts: { subject: string; issuer: string; publicKey: KeyObject; signer: KeyObject; years: number; extensions: Buffer[] }): string {
  const now = Date.now()
  const serial = randomBytes(16)
  serial[0] &= 0x7f
  const tbs = seq(
    ctx(0, integer(Buffer.from([2]))),
    integer(serial),
    ECDSA_SHA256,
    name(opts.issuer),
    seq(time(new Date(now - 24 * 3600 * 1000)), time(new Date(now + opts.years * 365 * 24 * 3600 * 1000))),
    name(opts.subject),
    opts.publicKey.export({ type: 'spki', format: 'der' }),
    ctx(3, seq(...opts.extensions))
  )
  const signature = sign('sha256', tbs, opts.signer)
  return toPem(seq(tbs, ECDSA_SHA256, bits(signature)))
}

export interface CertPair {
  certPem: string
  keyPem: string
}

/** A certificate authority that exists only to sign this hub's server certificates. */
export function createCa(commonName: string): CertPair {
  const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
  const certPem = build({
    subject: commonName,
    issuer: commonName,
    publicKey,
    signer: privateKey,
    years: 20,
    extensions: [
      ext('2.5.29.19', true, seq(bool(true))),
      // keyCertSign and cRLSign
      ext('2.5.29.15', true, bits(Buffer.from([0x06]), 1))
    ]
  })
  return { certPem, keyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }) as string }
}

/** A server certificate for the given host names and IP addresses, signed by the hub's CA. */
export function createServerCert(ca: CertPair & { commonName: string }, hosts: string[]): CertPair {
  const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
  const unique = [...new Set(hosts.map((h) => h.trim()).filter(Boolean))]
  const sans = unique.map((h) => (isIP(h) ? tlv(0x87, ipBytes(h)) : tlv(0x82, Buffer.from(h, 'ascii'))))
  const certPem = build({
    subject: unique[0] ?? 'fsm-hub',
    issuer: ca.commonName,
    publicKey,
    signer: createPrivateKey(ca.keyPem),
    years: 10,
    extensions: [
      ext('2.5.29.19', false, seq()),
      // digitalSignature
      ext('2.5.29.15', true, bits(Buffer.from([0x80]), 7)),
      ext('2.5.29.37', false, seq(oid('1.3.6.1.5.5.7.3.1'))),
      ext('2.5.29.17', false, seq(...sans))
    ]
  })
  return { certPem, keyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }) as string }
}
