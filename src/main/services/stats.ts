import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { cpus } from 'node:os'
import { LineSplitter } from '../util'

interface Row {
  p: number
  pp: number
  ws: number
  t: number
}

export interface Usage {
  cpu: number
  memory: number
}

// One long-lived PowerShell keeps sampling cheap: each tick is a single CIM query instead of a process spawn.
const SCRIPT = `
$ErrorActionPreference = 'SilentlyContinue'
while ($true) {
  $line = [Console]::In.ReadLine()
  if ($null -eq $line) { break }
  $filter = ($line.Split(',') | ForEach-Object { "Name='$_'" }) -join ' OR '
  $rows = @(Get-CimInstance Win32_Process -Filter $filter | ForEach-Object {
    [pscustomobject]@{ p = $_.ProcessId; pp = $_.ParentProcessId; ws = $_.WorkingSetSize; t = [int64]$_.KernelModeTime + [int64]$_.UserModeTime }
  })
  [Console]::Out.WriteLine((ConvertTo-Json -InputObject $rows -Compress))
  [Console]::Out.Flush()
}
`

const PROCESS_NAMES = ['FXServer.exe', 'cfx-server.exe', 'CitizenFX.Server.exe', 'mariadbd.exe', 'mysqld.exe']

class Stats {
  private ps: ChildProcessWithoutNullStreams | null = null
  private waiting: ((rows: Row[] | null) => void) | null = null
  private prev = new Map<number, { t: number; at: number }>()
  private rows: Row[] = []
  private cores = Math.max(1, cpus().length)
  private usage = new Map<number, Usage>()

  private ensure(): ChildProcessWithoutNullStreams {
    if (this.ps && this.ps.exitCode === null) return this.ps
    const encoded = Buffer.from(SCRIPT, 'utf16le').toString('base64')
    const ps = spawn(
      'powershell.exe',
      ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded],
      { windowsHide: true }
    )
    const splitter = new LineSplitter()
    ps.stdout.setEncoding('utf8')
    ps.stdout.on('data', (chunk: string) => {
      for (const line of splitter.push(chunk)) {
        if (!line.trim()) continue
        let rows: Row[] | null = null
        try {
          const parsed = JSON.parse(line)
          rows = Array.isArray(parsed) ? parsed : [parsed]
        } catch {
          rows = null
        }
        const cb = this.waiting
        this.waiting = null
        cb?.(rows)
      }
    })
    ps.on('exit', () => {
      this.ps = null
      this.waiting?.(null)
      this.waiting = null
    })
    ps.on('error', () => undefined)
    this.ps = ps
    return ps
  }

  /** Refreshes the process table. Resolves quietly if PowerShell is slow or unavailable. */
  async sample(): Promise<void> {
    if (this.waiting) return
    const ps = this.ensure()
    const rows = await new Promise<Row[] | null>((resolve) => {
      const timer = setTimeout(() => {
        this.waiting = null
        resolve(null)
      }, 6000)
      this.waiting = (r) => {
        clearTimeout(timer)
        resolve(r)
      }
      ps.stdin.write(PROCESS_NAMES.join(',') + '\n')
    })
    if (!rows) return
    const now = Date.now()
    const next = new Map<number, { t: number; at: number }>()
    this.usage.clear()
    for (const r of rows) {
      const before = this.prev.get(r.p)
      let cpu = 0
      if (before && now > before.at) {
        // CPU times are in 100ns units; normalise to a share of all cores.
        cpu = ((r.t - before.t) / ((now - before.at) * 1e4) / this.cores) * 100
      }
      next.set(r.p, { t: r.t, at: now })
      this.usage.set(r.p, { cpu: Math.max(0, Math.min(100, cpu)), memory: r.ws })
    }
    this.prev = next
    this.rows = rows
  }

  /** Total usage for a process and all of its descendants. */
  tree(pid: number): Usage {
    const total: Usage = { cpu: 0, memory: 0 }
    const queue = [pid]
    const seen = new Set<number>()
    while (queue.length) {
      const cur = queue.shift()!
      if (seen.has(cur)) continue
      seen.add(cur)
      const u = this.usage.get(cur)
      if (u) {
        total.cpu += u.cpu
        total.memory += u.memory
      }
      for (const r of this.rows) if (r.pp === cur && !seen.has(r.p)) queue.push(r.p)
    }
    return total
  }

  dispose(): void {
    this.ps?.kill()
    this.ps = null
  }
}

export const stats = new Stats()
