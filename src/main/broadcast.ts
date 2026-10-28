import { BrowserWindow } from 'electron'
import type { ToastEvent } from '@shared/types'

/** Sends an event to every open renderer window. */
export function broadcast(channel: string, payload: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(channel, payload)
  }
}

export function toast(event: ToastEvent): void {
  broadcast('event:toast', event)
}
