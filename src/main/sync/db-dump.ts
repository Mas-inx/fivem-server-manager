import { spawn } from 'node:child_process'
import { createReadStream } from 'node:fs'
import type { DbConnection } from '@shared/types'

/** The password goes through MYSQL_PWD so it never appears on a command line or in a process list. */
function run(tool: string, args: string[], conn: DbConnection, stdinFile?: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(tool, [`--host=${conn.host}`, `--port=${conn.port}`, `--user=${conn.user}`, ...args], {
      env: { ...process.env, MYSQL_PWD: conn.password },
      windowsHide: true,
      stdio: [stdinFile ? 'pipe' : 'ignore', 'ignore', 'pipe']
    })
    let stderr = ''
    child.stderr?.setEncoding('utf8')
    child.stderr?.on('data', (d: string) => {
      if (stderr.length < 8000) stderr += d
    })
    if (stdinFile && child.stdin) {
      const input = createReadStream(stdinFile)
      input.on('error', (e) => {
        child.kill()
        reject(e)
      })
      child.stdin.on('error', () => undefined)
      input.pipe(child.stdin)
    }
    child.on('error', (e) => reject(new Error(`Could not run ${tool}: ${e.message}`)))
    child.on('close', (code) => {
      if (code === 0) resolve()
      else reject(new Error(stderr.trim().split(/\r?\n/).slice(-2).join(' ') || `Database tool exited with code ${code}`))
    })
  })
}

/** Writes a repeatable dump (no dump date, rows in key order) so unchanged data dedups between pushes. */
export function dumpDatabase(tool: string, conn: DbConnection, database: string, file: string): Promise<void> {
  return run(
    tool,
    [
      '--single-transaction',
      '--quick',
      '--routines',
      '--triggers',
      '--events',
      '--hex-blob',
      '--skip-dump-date',
      '--order-by-primary',
      '--default-character-set=utf8mb4',
      `--result-file=${file}`,
      database
    ],
    conn
  )
}

export function importDatabase(tool: string, conn: DbConnection, database: string, file: string): Promise<void> {
  return run(tool, ['--default-character-set=utf8mb4', database], conn, file)
}
