import { spawn } from 'node:child_process'

/** Name of the inbound rule the hub adds; one rule, replaced when the port changes. */
export const FIREWALL_RULE = 'FiveM-Server-Manager-Sync-Hub'

function validPort(port: number): number {
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid port')
  return port
}

/**
 * PowerShell that replaces the hub's inbound rule with one for `port`. Start-Process -Verb RunAs
 * shows Windows' own administrator prompt; nothing changes unless the user approves it there.
 */
export function firewallScript(port: number): string {
  const p = validPort(port)
  const cmd = `netsh advfirewall firewall delete rule name=${FIREWALL_RULE} >nul 2>&1 & netsh advfirewall firewall add rule name=${FIREWALL_RULE} dir=in action=allow protocol=TCP localport=${p} profile=any`
  return `$p = Start-Process -FilePath cmd.exe -ArgumentList '/c ${cmd}' -Verb RunAs -Wait -WindowStyle Hidden -PassThru; exit $p.ExitCode`
}

/** Reads the rule's ports without needing administrator rights. Language-independent, unlike netsh output. */
export function firewallCheckScript(): string {
  return `$r = Get-NetFirewallRule -DisplayName '${FIREWALL_RULE}' -ErrorAction SilentlyContinue | Where-Object { $_.Enabled -eq 'True' -and $_.Direction -eq 'Inbound' -and $_.Action -eq 'Allow' }; if ($r) { ($r | Get-NetFirewallPortFilter).LocalPort }`
}

function powershell(script: string): Promise<{ code: number | null; stdout: string }> {
  return new Promise((resolve) => {
    // -EncodedCommand avoids every quoting problem between Node, cmd and PowerShell.
    const encoded = Buffer.from(script, 'utf16le').toString('base64')
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded], { windowsHide: true })
    let stdout = ''
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (d: string) => (stdout += d))
    child.on('error', () => resolve({ code: null, stdout: '' }))
    child.on('close', (code) => resolve({ code, stdout }))
  })
}

export async function firewallOpenFor(port: number): Promise<boolean | null> {
  const res = await powershell(firewallCheckScript())
  if (res.code === null) return null
  return res.stdout
    .split(/\s+/)
    .filter(Boolean)
    .some((p) => p === String(port) || p.toLowerCase() === 'any')
}

export async function openFirewallPort(port: number): Promise<void> {
  const res = await powershell(firewallScript(port))
  if (res.code !== 0) throw new Error('Windows did not open the port. The administrator prompt was declined or the rule could not be added.')
}
