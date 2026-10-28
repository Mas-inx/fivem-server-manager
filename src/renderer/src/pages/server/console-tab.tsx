import { ArrowDown, Clock, Eraser, FolderOpen, Search } from 'lucide-react'
import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { LogLine, ServerConfig, ServerRuntime } from '@shared/types'
import { isLive } from '@/components/server-actions'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { attempt } from '@/components/ui/toast'
import { Tooltip } from '@/components/ui/tooltip'
import { parseAnsi, stripAnsi } from '@/lib/ansi'
import { api, cn } from '@/lib/utils'
import { useLogs } from '@/store/app'

const ROW = 19
const OVERSCAN = 30
const history = new Map<string, string[]>()

const time = (t: number): string => new Date(t).toLocaleTimeString([], { hour12: false })

const Row = memo(function Row({ line, showTime }: { line: LogLine; showTime: boolean }) {
  const segments = useMemo(() => parseAnsi(line.text), [line.text])
  return (
    <div className="flex h-[19px] items-center whitespace-pre">
      {showTime && <span className="mr-3 shrink-0 text-fg-faint">{time(line.t)}</span>}
      <span
        className={cn(
          line.stream === 'sys' && 'text-fg-subtle',
          line.stream === 'err' && 'text-err',
          line.stream === 'out' && 'text-fg-muted'
        )}
      >
        {line.stream === 'sys' && <span className="text-fg-faint">◆ </span>}
        {segments.map((s, i) => (
          <span key={i} style={s.color ? { color: s.color } : undefined} className={cn(s.bold && 'font-semibold', s.dim && 'opacity-60')}>
            {s.text}
          </span>
        ))}
      </span>
    </div>
  )
})

function LogView({ lines, showTime }: { lines: LogLine[]; showTime: boolean }) {
  const ref = useRef<HTMLDivElement>(null)
  const [range, setRange] = useState({ start: 0, end: 120 })
  const [stuck, setStuck] = useState(true)
  const stuckRef = useRef(true)

  const measure = (): void => {
    const el = ref.current
    if (!el) return
    const start = Math.max(0, Math.floor(el.scrollTop / ROW) - OVERSCAN)
    const end = Math.min(lines.length, Math.ceil((el.scrollTop + el.clientHeight) / ROW) + OVERSCAN)
    setRange((r) => (r.start === start && r.end === end ? r : { start, end }))
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < ROW * 2
    stuckRef.current = atBottom
    setStuck(atBottom)
  }

  useLayoutEffect(() => {
    const el = ref.current
    if (el && stuckRef.current) el.scrollTop = el.scrollHeight
    measure()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lines])

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(() => measure())
    ro.observe(el)
    return () => ro.disconnect()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const visible = lines.slice(range.start, range.end)
  return (
    <div className="relative min-h-0 flex-1">
      <div ref={ref} onScroll={measure} className="absolute inset-0 overflow-auto font-mono text-[12px] selectable">
        <div style={{ height: lines.length * ROW + 24, minWidth: 'max-content' }} className="relative px-5 pt-3">
          <div style={{ transform: `translateY(${range.start * ROW}px)` }}>
            {visible.map((l, i) => (
              <Row key={range.start + i} line={l} showTime={showTime} />
            ))}
          </div>
        </div>
      </div>
      {!stuck && (
        <button
          onClick={() => {
            const el = ref.current
            if (el) el.scrollTop = el.scrollHeight
          }}
          className="absolute right-5 bottom-4 flex h-7 animate-pop-in items-center gap-1.5 rounded-full bg-overlay px-3 text-xs text-fg-muted shadow-pop hover:text-fg"
        >
          <ArrowDown size={12} />
          Latest
        </button>
      )}
    </div>
  )
}

export function ConsoleTab({ server, runtime }: { server: ServerConfig; runtime: ServerRuntime | undefined }) {
  const logs = useLogs((s) => s.logs[server.id])
  const load = useLogs((s) => s.load)
  const clear = useLogs((s) => s.clear)
  const [query, setQuery] = useState('')
  const [showTime, setShowTime] = useState(false)
  const [command, setCommand] = useState('')
  const [cursor, setCursor] = useState(-1)
  const inputRef = useRef<HTMLInputElement>(null)
  const live = isLive(runtime)

  useEffect(() => {
    void load(server.id)
  }, [server.id, load])

  const lines = useMemo(() => {
    const all = logs ?? []
    if (!query.trim()) return all
    const q = query.toLowerCase()
    return all.filter((l) => stripAnsi(l.text).toLowerCase().includes(q))
  }, [logs, query])

  const send = async (): Promise<void> => {
    const cmd = command.trim()
    if (!cmd) return
    const h = history.get(server.id) ?? []
    history.set(server.id, [cmd, ...h.filter((x) => x !== cmd)].slice(0, 50))
    setCommand('')
    setCursor(-1)
    await attempt(() => api.servers.command(server.id, cmd), 'Command failed')
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>): void => {
    const h = history.get(server.id) ?? []
    if (e.key === 'Enter') void send()
    else if (e.key === 'ArrowUp' && h.length) {
      e.preventDefault()
      const next = Math.min(h.length - 1, cursor + 1)
      setCursor(next)
      setCommand(h[next])
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      const next = cursor - 1
      setCursor(next)
      setCommand(next >= 0 ? h[next] : '')
    }
  }

  return (
    <div className="flex h-full flex-col bg-sunken/50">
      <div className="flex h-12 shrink-0 items-center gap-2 border-b border-line px-5">
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filter output"
          leading={<Search size={13} />}
          className="w-[260px]"
        />
        {query && (
          <span className="text-xs text-fg-subtle tabular">
            {lines.length} match{lines.length === 1 ? '' : 'es'}
          </span>
        )}
        <div className="flex-1" />
        <Tooltip content={showTime ? 'Hide timestamps' : 'Show timestamps'}>
          <Button
            variant="ghost"
            square
            size="sm"
            className={cn(showTime && 'bg-active text-fg')}
            onClick={() => setShowTime((v) => !v)}
            icon={<Clock size={14} strokeWidth={1.75} />}
          />
        </Tooltip>
        <Tooltip content="Clear">
          <Button variant="ghost" square size="sm" onClick={() => clear(server.id)} icon={<Eraser size={14} strokeWidth={1.75} />} />
        </Tooltip>
        <Tooltip content="Open log files">
          <Button
            variant="ghost"
            square
            size="sm"
            onClick={() => void attempt(async () => api.app.openPath((await api.servers.files(server.id)).logsPath))}
            icon={<FolderOpen size={14} strokeWidth={1.75} />}
          />
        </Tooltip>
      </div>

      {lines.length ? (
        <LogView lines={lines} showTime={showTime} />
      ) : (
        <div className="flex flex-1 items-center justify-center text-[13px] text-fg-faint">
          {query ? 'Nothing matches that filter' : live ? 'Waiting for output' : 'Start the server to see its output here'}
        </div>
      )}

      <div
        className="flex h-12 shrink-0 items-center gap-2.5 border-t border-line bg-panel px-5"
        onClick={() => inputRef.current?.focus()}
      >
        <span className={cn('font-mono text-[13px]', live ? 'text-fg-muted' : 'text-fg-faint')}>›</span>
        <input
          ref={inputRef}
          value={command}
          disabled={!live}
          onChange={(e) => setCommand(e.target.value)}
          onKeyDown={onKeyDown}
          spellCheck={false}
          placeholder={
            !live
              ? 'Server is not running'
              : server.mode === 'txadmin'
                ? 'Send a command to the server (txAdmin Live Console also works)'
                : 'Type a command, for example: refresh, ensure chat, status'
          }
          className="h-full flex-1 bg-transparent font-mono text-[12.5px] text-fg placeholder:font-sans placeholder:text-[13px] placeholder:text-fg-faint focus-visible:outline-none disabled:cursor-not-allowed"
        />
      </div>
    </div>
  )
}
