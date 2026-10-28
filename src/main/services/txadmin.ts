import type { ServerConfig } from '@shared/types'

/** Actions accepted by txAdmin's POST /fxserver/commands route. */
export type TxCommand = 'refresh_res' | 'restart_res' | 'start_res' | 'stop_res' | 'ensure_res'

interface Session {
  cookie: string
  csrf: string
}

interface ToastResponse {
  type?: 'success' | 'warning' | 'error' | 'info'
  msg?: string
  logout?: boolean
  error?: string
}

/**
 * txAdmin does not forward the host's stdin to the game server, so commands for txAdmin
 * servers go through its web API, signed in with the account the manager seeded.
 */
class TxAdminClient {
  private sessions = new Map<string, Session>()

  private base(server: ServerConfig): string {
    return `http://127.0.0.1:${server.txAdminPort}`
  }

  private async login(server: ServerConfig): Promise<Session> {
    if (!server.txAdmin) throw new Error("Add this server's txAdmin login in its settings first")
    const res = await fetch(`${this.base(server)}/auth/password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: server.txAdmin.username, password: server.txAdmin.password }),
      signal: AbortSignal.timeout(8000)
    })
    const data = (await res.json().catch(() => ({}))) as { error?: string; csrfToken?: string }
    if (data.error || !data.csrfToken) {
      throw new Error(data.error ? `txAdmin sign-in failed: ${data.error}` : 'txAdmin sign-in failed')
    }
    const cookie = res.headers
      .getSetCookie()
      .map((c) => c.split(';')[0])
      .join('; ')
    const session = { cookie, csrf: data.csrfToken }
    this.sessions.set(server.id, session)
    return session
  }

  async command(server: ServerConfig, action: TxCommand, parameter = ''): Promise<string | null> {
    for (let attempt = 0; attempt < 2; attempt++) {
      const session = this.sessions.get(server.id) ?? (await this.login(server))
      const res = await fetch(`${this.base(server)}/fxserver/commands`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: session.cookie,
          'x-txadmin-csrftoken': session.csrf
        },
        body: JSON.stringify({ action, parameter }),
        signal: AbortSignal.timeout(8000)
      })
      const data = (await res.json().catch(() => ({}))) as ToastResponse
      if (data.logout || res.status === 401) {
        // Session expired or txAdmin restarted: sign in again once.
        this.sessions.delete(server.id)
        continue
      }
      if (data.type === 'error' || data.error) throw new Error(stripHtml(data.msg ?? data.error ?? 'txAdmin refused the command'))
      return data.msg ? stripHtml(data.msg) : null
    }
    throw new Error('txAdmin keeps rejecting the session; check the login in server settings')
  }

  forget(id: string): void {
    this.sessions.delete(id)
  }
}

const stripHtml = (s: string): string => s.replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, '').trim()

export const txadmin = new TxAdminClient()
