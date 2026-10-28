import { createSocket } from 'node:dgram'
import { createServer } from 'node:net'
import type { PortCheck } from '@shared/types'
import { store } from '../store'

function tcpFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const srv = createServer()
    srv.once('error', () => resolve(false))
    srv.once('listening', () => srv.close(() => resolve(true)))
    srv.listen(port, '0.0.0.0')
  })
}

function udpFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const sock = createSocket('udp4')
    sock.once('error', () => {
      sock.close()
      resolve(false)
    })
    sock.bind(port, '0.0.0.0', () => sock.close(() => resolve(true)))
  })
}

export async function portFree(port: number, udp = false): Promise<boolean> {
  if (!(await tcpFree(port))) return false
  return udp ? udpFree(port) : true
}

function claimedBy(port: number, excludeId?: string): string | null {
  const s = store.servers.find((x) => x.id !== excludeId && (x.gamePort === port || x.txAdminPort === port))
  return s ? s.name : null
}

export async function checkPorts(ports: number[], excludeId?: string): Promise<PortCheck[]> {
  return Promise.all(
    ports.map(async (port) => {
      const usedBy = claimedBy(port, excludeId)
      if (usedBy) return { port, free: false, usedBy }
      return { port, free: await portFree(port, true), usedBy: null }
    })
  )
}

async function nextFree(start: number, taken: Set<number>, udp: boolean): Promise<number> {
  for (let port = start; port < start + 500; port++) {
    if (taken.has(port)) continue
    if (await portFree(port, udp)) return port
  }
  throw new Error(`No free port found near ${start}`)
}

/** Picks ports that are neither bound right now nor assigned to another server. */
export async function suggestPorts(): Promise<{ gamePort: number; txAdminPort: number }> {
  const taken = new Set(store.servers.flatMap((s) => [s.gamePort, s.txAdminPort]))
  const gamePort = await nextFree(30120, taken, true)
  taken.add(gamePort)
  const txAdminPort = await nextFree(40120, taken, false)
  return { gamePort, txAdminPort }
}
