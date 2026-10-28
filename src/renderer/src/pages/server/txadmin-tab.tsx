import * as Popover from '@radix-ui/react-popover'
import { ArrowLeft, ArrowRight, ExternalLink, KeyRound, LayoutPanelLeft, RotateCw } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router'
import type { ServerConfig, ServerRuntime } from '@shared/types'
import { isLive, useServerControl } from '@/components/server-actions'
import { Button } from '@/components/ui/button'
import { CopyButton, EmptyState, Spinner } from '@/components/ui/misc'
import { attempt } from '@/components/ui/toast'
import { Tooltip } from '@/components/ui/tooltip'
import { api } from '@/lib/utils'

interface WebviewEl extends HTMLElement {
  goBack(): void
  goForward(): void
  reload(): void
  canGoBack(): boolean
  canGoForward(): boolean
  getURL(): string
  executeJavaScript(code: string): Promise<unknown>
}

/** Signs in with the account seeded through TXHOST_DEFAULT_ACCOUNT so the panel opens ready to use. */
function autoLoginScript(username: string, password: string, next: string): string {
  return `(async () => {
    if (!location.pathname.startsWith('/login')) return 'skip';
    const res = await fetch('/auth/password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(${JSON.stringify({ username, password })})
    });
    const data = await res.json().catch(() => ({}));
    if (data && !data.error) { location.href = ${JSON.stringify(next)}; return 'ok'; }
    return 'failed';
  })()`
}

function Credentials({ server }: { server: ServerConfig }) {
  if (!server.txAdmin) return null
  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <Button variant="ghost" size="sm" icon={<KeyRound size={13} strokeWidth={1.75} />}>
          Login
        </Button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content align="end" sideOffset={6} className="z-50 w-[280px] animate-pop-in rounded-[12px] bg-overlay p-3 shadow-pop">
          <div className="text-[13px] font-medium text-fg">txAdmin account</div>
          <div className="mt-0.5 text-xs leading-[18px] text-fg-subtle">
            Created on first start. Change it inside txAdmin any time; the manager only uses it to sign you in.
          </div>
          <div className="mt-3 space-y-1.5">
            {[
              ['Username', server.txAdmin.username],
              ['Password', server.txAdmin.password]
            ].map(([k, v]) => (
              <div key={k} className="flex items-center justify-between rounded-[7px] bg-sunken px-2.5 py-1.5 shadow-[inset_0_0_0_1px_var(--line)]">
                <span className="text-xs text-fg-subtle">{k}</span>
                <span className="flex items-center gap-1 font-mono text-xs text-fg selectable">
                  {v}
                  <CopyButton value={v} className="h-5 w-5" />
                </span>
              </div>
            ))}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}

export function TxAdminTab({ server, runtime }: { server: ServerConfig; runtime: ServerRuntime | undefined }) {
  const ref = useRef<WebviewEl>(null)
  const ctl = useServerControl(server)
  const [url, setUrl] = useState('')
  const [nav, setNav] = useState({ back: false, forward: false })
  const [loading, setLoading] = useState(true)
  const [params] = useSearchParams()
  const base = `http://127.0.0.1:${server.txAdminPort}`
  // Other tabs can deep-link into the panel, e.g. ?to=/server/console for the Live Console.
  const startPath = params.get('to')?.startsWith('/') ? params.get('to')! : '/'
  const ready = runtime?.txAdminOnline
  const live = isLive(runtime)

  useEffect(() => {
    const wv = ref.current
    if (!wv || !ready) return
    let triedLogin = false
    // txAdmin is a single-page app: it lands on "/" and only then routes to /login in-page,
    // so the sign-in check runs on every navigation rather than just on dom-ready.
    const sync = (): void => {
      try {
        const current = wv.getURL()
        setUrl(current)
        setNav({ back: wv.canGoBack(), forward: wv.canGoForward() })
        if (server.txAdmin && !triedLogin && new URL(current).pathname.startsWith('/login')) {
          triedLogin = true
          void wv.executeJavaScript(autoLoginScript(server.txAdmin.username, server.txAdmin.password, startPath)).catch(() => undefined)
        }
      } catch {
        /* not attached yet */
      }
    }
    const onReady = (): void => {
      sync()
      setLoading(false)
    }
    const onStart = (): void => setLoading(true)
    wv.addEventListener('dom-ready', onReady)
    wv.addEventListener('did-navigate', sync)
    wv.addEventListener('did-navigate-in-page', sync)
    wv.addEventListener('did-start-loading', onStart)
    wv.addEventListener('did-stop-loading', () => setLoading(false))
    return () => {
      wv.removeEventListener('dom-ready', onReady)
      wv.removeEventListener('did-navigate', sync)
      wv.removeEventListener('did-navigate-in-page', sync)
      wv.removeEventListener('did-start-loading', onStart)
    }
  }, [ready, server.txAdmin, startPath])

  if (!live) {
    return (
      <EmptyState
        className="h-full"
        icon={<LayoutPanelLeft size={18} strokeWidth={1.75} />}
        title="txAdmin is not running"
        description="Start the server to open its txAdmin panel right here."
      >
        <Button variant="primary" loading={ctl.busy === 'start'} onClick={() => void ctl.start()}>
          Start server
        </Button>
      </EmptyState>
    )
  }

  if (!ready) {
    return (
      <EmptyState className="h-full" icon={<Spinner size={16} />} title="Starting txAdmin" description="This usually takes a few seconds." />
    )
  }

  const path = url.startsWith(base) ? url.slice(base.length) || '/' : url
  return (
    <div className="flex h-full flex-col">
      <div className="flex h-11 shrink-0 items-center gap-1 border-b border-line px-3">
        <Tooltip content="Back">
          <Button variant="ghost" square size="sm" disabled={!nav.back} onClick={() => ref.current?.goBack()} icon={<ArrowLeft size={14} />} />
        </Tooltip>
        <Tooltip content="Forward">
          <Button
            variant="ghost"
            square
            size="sm"
            disabled={!nav.forward}
            onClick={() => ref.current?.goForward()}
            icon={<ArrowRight size={14} />}
          />
        </Tooltip>
        <Tooltip content="Reload">
          <Button variant="ghost" square size="sm" onClick={() => ref.current?.reload()} icon={<RotateCw size={13} />} />
        </Tooltip>
        <div className="ml-2 flex h-7 min-w-0 flex-1 items-center gap-2 rounded-[7px] bg-sunken px-2.5 font-mono text-xs text-fg-subtle shadow-[inset_0_0_0_1px_var(--line)]">
          {loading ? <Spinner size={11} /> : <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-ok" />}
          <span className="truncate selectable">
            <span className="text-fg-faint">127.0.0.1:{server.txAdminPort}</span>
            {path}
          </span>
        </div>
        <div className="ml-1 flex items-center gap-1">
          <Credentials server={server} />
          <Tooltip content="Open in browser">
            <Button
              variant="ghost"
              square
              size="sm"
              onClick={() => void attempt(() => api.app.openExternal(url || base))}
              icon={<ExternalLink size={14} />}
            />
          </Tooltip>
        </div>
      </div>
      <webview ref={ref} src={base + startPath} partition={`persist:txadmin-${server.id}`} className="min-h-0 flex-1 bg-panel" />
    </div>
  )
}
