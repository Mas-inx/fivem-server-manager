import { spawn } from 'node:child_process'
import { killTree, LineSplitter } from '../util'

/** How to reach a repository: where it is, the credentials restic reads from its environment, and -o options. */
export interface ResticTarget {
  repository: string
  password: string
  /** Extra environment, such as AWS_ACCESS_KEY_ID. Never put on the command line. */
  env: Record<string, string>
  options: string[]
}

export class SyncCancelled extends Error {
  constructor() {
    super('Cancelled')
    this.name = 'SyncCancelled'
  }
}

export class ResticError extends Error {
  constructor(
    message: string,
    readonly code: number | null
  ) {
    super(message)
    this.name = 'ResticError'
  }
}

/** restic exit codes, from its documentation. */
const EXIT = { incomplete: 3, noRepo: 10, locked: 11, wrongPassword: 12 } as const

export interface RunOptions {
  cwd?: string
  signal?: AbortSignal
  /** Receives each JSON message as it arrives. */
  onMessage?: (msg: Record<string, unknown>) => void
  /** Treat exit code 3 (some source files could not be read) as success. */
  allowIncomplete?: boolean
}

const STRIP = /^(RESTIC_|AWS_|B2_|AZURE_|GOOGLE_|OS_|ST_|RCLONE_)/

export class Restic {
  constructor(
    private readonly bin: string,
    private readonly target: ResticTarget,
    private readonly cacheDir?: string
  ) {}

  private env(): NodeJS.ProcessEnv {
    // Start from a clean slate so credentials from the user's shell never leak into a run.
    const env: NodeJS.ProcessEnv = {}
    for (const [k, v] of Object.entries(process.env)) if (!STRIP.test(k)) env[k] = v
    Object.assign(env, this.target.env, {
      RESTIC_REPOSITORY: this.target.repository,
      RESTIC_PASSWORD: this.target.password,
      RESTIC_PROGRESS_FPS: '2'
    })
    if (this.cacheDir) env.RESTIC_CACHE_DIR = this.cacheDir
    return env
  }

  /** Removes credentials from text that is about to be shown or logged. */
  private scrub(text: string): string {
    let out = text
    for (const secret of [this.target.password, ...Object.values(this.target.env)]) {
      if (secret && secret.length >= 6) out = out.split(secret).join('***')
    }
    return out
  }

  /** Runs restic with --json and returns every JSON message it printed. */
  run(args: string[], opts: RunOptions = {}): Promise<Record<string, unknown>[]> {
    return new Promise((resolve, reject) => {
      if (opts.signal?.aborted) return reject(new SyncCancelled())
      const child = spawn(this.bin, [...this.target.options, '--json', '--retry-lock', '2m', ...args], {
        cwd: opts.cwd,
        env: this.env(),
        windowsHide: true
      })
      const messages: Record<string, unknown>[] = []
      let stderr = ''
      let errorMessage: string | null = null
      const out = new LineSplitter()
      const err = new LineSplitter()
      const onLine = (line: string, fromErr: boolean): void => {
        const t = line.trim()
        if (!t) return
        if (t.startsWith('{') || t.startsWith('[')) {
          try {
            const parsed = JSON.parse(t) as Record<string, unknown> | Record<string, unknown>[]
            for (const msg of Array.isArray(parsed) ? parsed : [parsed]) {
              if (msg.message_type === 'exit_error' || msg.message_type === 'error') {
                const m = (msg.message as string) ?? ((msg.error as { message?: string })?.message ?? '')
                if (msg.message_type === 'exit_error' || !errorMessage) errorMessage = m
              }
              messages.push(msg)
              opts.onMessage?.(msg)
            }
            return
          } catch {
            /* plain text */
          }
        }
        if (fromErr && stderr.length < 64_000) stderr += `${t}\n`
      }
      child.stdout.setEncoding('utf8')
      child.stderr.setEncoding('utf8')
      child.stdout.on('data', (d: string) => out.push(d).forEach((l) => onLine(l, false)))
      child.stderr.on('data', (d: string) => err.push(d).forEach((l) => onLine(l, true)))

      let cancelled = false
      const onAbort = (): void => {
        cancelled = true
        if (child.pid) void killTree(child.pid)
      }
      opts.signal?.addEventListener('abort', onAbort, { once: true })

      child.on('error', (e) => {
        opts.signal?.removeEventListener('abort', onAbort)
        reject(new ResticError(`Could not start the sync engine: ${e.message}`, null))
      })
      child.on('close', (code) => {
        opts.signal?.removeEventListener('abort', onAbort)
        out.flush().forEach((l) => onLine(l, false))
        err.flush().forEach((l) => onLine(l, true))
        // A cancel that arrives after restic finished does not undo the finished work.
        if (code === 0 || (code === EXIT.incomplete && opts.allowIncomplete)) return resolve(messages)
        if (cancelled) return reject(new SyncCancelled())
        const detail = this.scrub((errorMessage ?? stderr.trim().split('\n').slice(-3).join(' ')) || `exit code ${code}`)
        const friendly =
          code === EXIT.noRepo
            ? 'The remote has no sync repository yet'
            : code === EXIT.wrongPassword
              ? 'The repository password is wrong'
              : code === EXIT.locked
                ? 'The remote is locked by another machine; try again in a minute'
                : null
        reject(new ResticError(friendly ? `${friendly} (${detail})` : detail.replace(/^Fatal:\s*/, ''), code))
      })
    })
  }

  /** True when the repository exists and the password opens it. */
  async exists(): Promise<boolean> {
    try {
      await this.run(['cat', 'config'])
      return true
    } catch (err) {
      if (err instanceof ResticError && err.code === EXIT.noRepo) return false
      throw err
    }
  }

  async init(): Promise<void> {
    await this.run(['init'])
  }

  /** Removes locks left by restic processes that no longer exist (for example after a cancel). */
  async unlock(): Promise<void> {
    await this.run(['unlock']).catch(() => undefined)
  }
}
