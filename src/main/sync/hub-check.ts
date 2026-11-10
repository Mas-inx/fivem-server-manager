import { request } from 'node:https'

export type HubCheck = { ok: true; repository: boolean } | { ok: false; reason: 'unreachable' | 'certificate' | 'login' | 'other'; message: string }

/**
 * One quick request to a hub before restic talks to it. restic keeps retrying network and TLS
 * errors for many minutes; this answers in seconds, with the reason in words.
 */
export function checkHub(url: string, user: string, password: string, caPem: string, timeoutMs = 8000): Promise<HubCheck> {
  return new Promise((resolve) => {
    const target = new URL('config', url)
    const req = request(
      target,
      {
        method: 'HEAD',
        ca: caPem || undefined,
        timeout: timeoutMs,
        headers: { Authorization: `Basic ${Buffer.from(`${user}:${password}`).toString('base64')}` }
      },
      (res) => {
        res.resume()
        const code = res.statusCode ?? 0
        if (code === 200) resolve({ ok: true, repository: true })
        else if (code === 404) resolve({ ok: true, repository: false })
        else if (code === 401 || code === 403) resolve({ ok: false, reason: 'login', message: 'The hub rejected the user or password' })
        else resolve({ ok: false, reason: 'other', message: `The hub answered with HTTP ${code}` })
      }
    )
    req.on('timeout', () => req.destroy(Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' })))
    req.on('error', (err: NodeJS.ErrnoException) => {
      const code = err.code ?? ''
      if (/CERT|SELF_SIGNED|UNABLE_TO|ERR_TLS|HOSTNAME|ALTNAME/i.test(code) || /certificate/i.test(err.message)) {
        resolve({ ok: false, reason: 'certificate', message: `The hub's certificate is not the one this machine trusts (${code || err.message}). Paste a fresh connection code from the hub.` })
      } else {
        resolve({
          ok: false,
          reason: 'unreachable',
          message: `Cannot reach the hub at ${target.host} (${code || err.message}). Check that it is running and that the port is open in its firewall and at the VPS provider.`
        })
      }
    })
    req.end()
  })
}
