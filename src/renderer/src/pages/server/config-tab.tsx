import { Code2, FileCode2, FolderOpen, Info } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import type { ServerConfig, ServerRuntime } from '@shared/types'
import { CfgEditor } from '@/components/cfg-editor'
import { Button } from '@/components/ui/button'
import { EmptyState, Kbd, Spinner } from '@/components/ui/misc'
import { attempt, toast } from '@/components/ui/toast'
import { useAsync } from '@/lib/hooks'
import { api, cn } from '@/lib/utils'

export function ConfigTab({ server, runtime }: { server: ServerConfig; runtime: ServerRuntime | undefined }) {
  const files = useAsync(() => api.servers.files(server.id), [server.id])
  const list = useAsync(() => api.servers.listConfigs(server.id), [server.id, files.data?.dataPath])
  const [file, setFile] = useState<string | null>(null)
  const [original, setOriginal] = useState('')
  const [draft, setDraft] = useState('')
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const dirty = draft !== original

  useEffect(() => {
    if (!file && list.data?.length) setFile(list.data[0])
  }, [list.data, file])

  useEffect(() => {
    if (!file) return
    let alive = true
    setLoading(true)
    api.servers
      .readFile(server.id, file)
      .then((text) => {
        if (!alive) return
        setOriginal(text)
        setDraft(text)
      })
      .catch((e: Error) => toast({ kind: 'error', title: 'Could not open file', description: e.message }))
      .finally(() => alive && setLoading(false))
    return () => {
      alive = false
    }
  }, [server.id, file])

  const save = useCallback(async () => {
    if (!file) return
    setSaving(true)
    const ok = await attempt(() => api.servers.writeFile(server.id, file, draft), 'Could not save')
    setSaving(false)
    if (ok) {
      setOriginal(draft)
      const live = runtime?.status === 'running' || runtime?.status === 'starting'
      toast({ kind: 'success', title: `${file} saved`, description: live ? 'Restart the server to apply the changes.' : undefined })
    }
  }, [file, draft, server.id, runtime?.status])

  if (files.loading) return null
  if (!files.data?.dataPath) {
    return (
      <EmptyState
        className="h-full"
        icon={<FileCode2 size={18} strokeWidth={1.75} />}
        title="No server data yet"
        description="Finish the txAdmin setup to deploy a server. Its config files will show up here."
      />
    )
  }

  const dataPath = files.data.dataPath
  return (
    <div className="flex h-full">
      <div className="flex w-[220px] shrink-0 flex-col border-r border-line">
        <div className="px-4 pt-4 pb-2 text-2xs font-medium text-fg-subtle">Config files</div>
        <div className="flex-1 overflow-y-auto px-2">
          {list.data?.map((f) => (
            <button
              key={f}
              onClick={() => {
                if (dirty && !confirm('Discard unsaved changes?')) return
                setFile(f)
              }}
              className={cn(
                'flex h-8 w-full items-center gap-2 rounded-[7px] px-2.5 text-left font-mono text-[12px] transition-colors',
                f === file ? 'bg-active text-fg' : 'text-fg-muted hover:bg-hover hover:text-fg'
              )}
            >
              <FileCode2 size={13} strokeWidth={1.75} className="shrink-0 text-fg-subtle" />
              <span className="truncate">{f}</span>
              {f === file && dirty && <span className="ml-auto h-1.5 w-1.5 rounded-full bg-fg-muted" />}
            </button>
          ))}
        </div>
        <div className="flex flex-col gap-0.5 border-t border-line p-2">
          <button
            onClick={() => void attempt(() => api.app.openPath(dataPath))}
            className="flex h-8 items-center gap-2 rounded-[7px] px-2.5 text-[13px] text-fg-muted hover:bg-hover hover:text-fg"
          >
            <FolderOpen size={14} strokeWidth={1.75} /> Server data folder
          </button>
          <button
            onClick={() => void attempt(() => api.app.openInEditor(dataPath))}
            className="flex h-8 items-center gap-2 rounded-[7px] px-2.5 text-[13px] text-fg-muted hover:bg-hover hover:text-fg"
          >
            <Code2 size={14} strokeWidth={1.75} /> Open in VS Code
          </button>
        </div>
      </div>

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex h-12 shrink-0 items-center gap-3 border-b border-line px-5">
          <span className="font-mono text-[12.5px] text-fg">{file}</span>
          {dirty && <span className="text-xs text-fg-subtle">Edited</span>}
          <div className="flex-1" />
          {dirty && (
            <Button variant="ghost" size="sm" onClick={() => setDraft(original)}>
              Revert
            </Button>
          )}
          <Button
            variant={dirty ? 'primary' : 'secondary'}
            size="sm"
            disabled={!dirty}
            loading={saving}
            onClick={() => void save()}
            iconRight={<Kbd className={cn('ml-0.5 h-4 shadow-none', dirty ? 'text-inverse-fg/60' : '')}>Ctrl S</Kbd>}
          >
            Save
          </Button>
        </div>
        {server.mode === 'standalone' && file === 'server.cfg' && (
          <div className="flex items-center gap-2 border-b border-line bg-sunken/60 px-5 py-2 text-xs text-fg-subtle">
            <Info size={13} strokeWidth={1.75} className="shrink-0" />
            Endpoints, max players, license key and database connection are synced from this server's settings each time it starts.
          </div>
        )}
        <div className="relative min-h-0 flex-1">
          {loading ? (
            <div className="flex h-full items-center justify-center text-fg-subtle">
              <Spinner />
            </div>
          ) : file ? (
            <CfgEditor value={draft} docKey={`${server.id}:${file}`} onChange={setDraft} onSave={() => void save()} />
          ) : null}
        </div>
      </div>
    </div>
  )
}
