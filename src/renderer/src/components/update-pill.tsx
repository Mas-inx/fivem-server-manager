import * as Popover from '@radix-ui/react-popover'
import { ArrowUpCircle, ExternalLink } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { isLive } from '@/components/server-actions'
import { Button } from '@/components/ui/button'
import { toast } from '@/components/ui/toast'
import { api } from '@/lib/utils'
import { useApp } from '@/store/app'

export const RELEASES_URL = 'https://github.com/Mas-inx/fivem-server-manager/releases'

export async function installUpdate(): Promise<void> {
  if (!(await api.updates.install())) toast({ kind: 'error', title: 'There is no downloaded update to install yet' })
}

/** Appears in the title bar once a new version has downloaded. */
export function UpdatePill() {
  const update = useApp((s) => s.update)
  const running = useApp((s) => Object.values(s.runtime).filter(isLive).length)
  const [installing, setInstalling] = useState(false)
  const announced = useRef<string | null>(null)

  useEffect(() => {
    if (update?.status === 'ready' && update.version && announced.current !== update.version) {
      announced.current = update.version
      toast({ kind: 'info', title: `Version ${update.version} is ready`, description: 'Restart from the title bar to install it.' })
    }
  }, [update?.status, update?.version])

  if (update?.status !== 'ready') return null
  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button className="no-drag flex h-7 items-center gap-1.5 rounded-[7px] bg-inverse px-2.5 text-xs font-medium text-inverse-fg transition-colors hover:bg-inverse-hover">
          <ArrowUpCircle size={13} strokeWidth={2} />
          Update ready
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content align="end" sideOffset={6} className="z-50 w-[340px] animate-pop-in rounded-[12px] bg-overlay p-4 shadow-pop">
          <div className="text-[13px] font-medium text-fg">Version {update.version} is ready</div>
          <div className="mt-0.5 text-xs text-fg-subtle">You are on {update.current}. It installs in a few seconds and the app reopens.</div>
          {update.notes && (
            <div className="mt-3 max-h-[180px] overflow-y-auto rounded-[8px] bg-sunken px-3 py-2.5 text-xs leading-[18px] whitespace-pre-wrap text-fg-muted shadow-[inset_0_0_0_1px_var(--line)] selectable">
              {update.notes}
            </div>
          )}
          {running > 0 && (
            <div className="mt-3 text-xs leading-[18px] text-warn">
              {running} running server{running === 1 ? ' is' : 's are'} stopped before the update installs.
            </div>
          )}
          <div className="mt-4 flex items-center justify-between">
            <button
              onClick={() => void api.app.openExternal(`${RELEASES_URL}/tag/v${update.version}`)}
              className="flex items-center gap-1 text-xs text-fg-subtle hover:text-fg"
            >
              Release notes <ExternalLink size={11} />
            </button>
            <Button
              variant="primary"
              size="sm"
              loading={installing}
              onClick={async () => {
                setInstalling(true)
                await installUpdate()
                setInstalling(false)
              }}
            >
              Restart and update
            </Button>
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}
