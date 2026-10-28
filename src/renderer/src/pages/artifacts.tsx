import { Check, Download, RefreshCw, Search, Trash2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import type { InstalledArtifact, Platform } from '@shared/types'
import { formatBytes, platformLabel } from '@shared/format'
import { Page, PageHeader, Panel } from '@/components/layout/page'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge, EmptyState, Progress, SectionTitle, Spinner } from '@/components/ui/misc'
import { Segmented } from '@/components/ui/segmented'
import { attempt, toast } from '@/components/ui/toast'
import { Tooltip } from '@/components/ui/tooltip'
import { useAsync } from '@/lib/hooks'
import { api, cn, relativeTime } from '@/lib/utils'
import { useApp } from '@/store/app'

function useInstallTask(platform: Platform, build: string) {
  return useApp((s) => s.tasks.find((t) => t.state === 'running' && t.title === `${platformLabel(platform)} build ${build}`))
}

function InstallButton({
  platform,
  build,
  installed,
  onDone,
  size = 'sm',
  quiet
}: {
  platform: Platform
  build: string
  installed: boolean
  onDone: () => void
  size?: 'sm' | 'md'
  quiet?: boolean
}) {
  const task = useInstallTask(platform, build)
  if (installed) {
    return (
      <span className="flex h-7 items-center gap-1.5 px-2 text-xs text-fg-subtle">
        <Check size={13} strokeWidth={2} /> Downloaded
      </span>
    )
  }
  if (task) {
    return (
      <div className="flex w-[150px] flex-col gap-1.5">
        <div className="flex justify-between text-2xs text-fg-subtle tabular">
          <span className="truncate">{task.detail ?? 'Starting'}</span>
        </div>
        <Progress value={task.progress} />
      </div>
    )
  }
  return (
    <Button
      size={size}
      variant={quiet ? 'ghost' : 'secondary'}
      icon={<Download size={13} strokeWidth={1.75} />}
      onClick={() =>
        void attempt(async () => {
          await api.artifacts.install(platform, build)
          toast({ kind: 'success', title: `Build ${build} downloaded` })
          onDone()
        }, `Could not download build ${build}`)
      }
    >
      Download
    </Button>
  )
}

function support(until: string | null | undefined): { label: string; tone: 'neutral' | 'warn' | 'err' | 'ok' } | null {
  if (until === undefined) return null
  if (until === null) return { label: 'Supported', tone: 'neutral' }
  const d = new Date(until)
  if (d.getTime() < Date.now()) return { label: 'End of life', tone: 'err' }
  return { label: `Until ${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`, tone: 'neutral' }
}

export function ArtifactsPage() {
  const [platform, setPlatform] = useState<Platform>('legacy')
  const [query, setQuery] = useState('')
  const [refreshing, setRefreshing] = useState(false)
  const servers = useApp((s) => s.servers)
  const catalog = useAsync(() => api.artifacts.catalog(platform), [platform])
  const installed = useAsync(() => api.artifacts.installed(), [platform])

  const have = useMemo(
    () => new Map((installed.data ?? []).filter((a) => a.platform === platform).map((a) => [a.build, a] as const)),
    [installed.data, platform]
  )
  const c = catalog.data
  const builds = (c?.builds ?? []).filter((b) => !query || b.build.includes(query.trim()))
  const reload = (): void => installed.reload()

  const remove = (a: InstalledArtifact): void =>
    void attempt(async () => {
      await api.artifacts.remove(a.platform, a.build)
      reload()
    }, 'Could not delete build')

  const channels = [
    { label: 'Recommended', build: c?.recommended, txAdmin: c?.builds.find((b) => b.build === c?.recommended)?.txAdmin },
    ...(platform === 'legacy' ? [{ label: 'Latest', build: c?.latest, txAdmin: c?.builds.find((b) => b.build === c?.latest)?.txAdmin }] : [])
  ]

  return (
    <Page>
      <PageHeader
        title="Artifacts"
        description="Server builds stored on this PC. Each one is downloaded once and shared by every server that uses it."
        actions={
          <>
            <Segmented<Platform>
              value={platform}
              onChange={setPlatform}
              options={[
                { value: 'legacy', label: 'FiveM' },
                { value: 'enhanced', label: 'FiveM Enhanced' }
              ]}
            />
            <Tooltip content="Check for new builds">
              <Button
                square
                loading={refreshing}
                onClick={async () => {
                  setRefreshing(true)
                  await attempt(() => api.artifacts.catalog(platform, true))
                  catalog.reload()
                  setRefreshing(false)
                }}
                icon={<RefreshCw size={14} strokeWidth={1.75} />}
              />
            </Tooltip>
          </>
        }
      />

      {catalog.error && !c && (
        <Panel className="mb-6 px-4 py-3 text-[13px] text-err">Could not reach Cfx.re: {catalog.error}</Panel>
      )}

      <Panel className={cn('mb-8 grid divide-x divide-line', channels.length === 2 ? 'grid-cols-2' : 'grid-cols-1')}>
        {channels.map((ch) => (
          <div key={ch.label} className="flex items-center justify-between gap-4 px-5 py-4">
            <div>
              <div className="text-xs text-fg-subtle">{ch.label}</div>
              <div className="mt-1 flex items-baseline gap-2">
                <span className="font-mono text-[18px] font-medium tracking-[-0.01em] text-fg">
                  {ch.build ?? (catalog.loading ? <Spinner size={14} /> : '–')}
                </span>
                {ch.txAdmin && <span className="text-xs text-fg-subtle">txAdmin {ch.txAdmin}</span>}
              </div>
            </div>
            {ch.build && <InstallButton platform={platform} build={ch.build} installed={have.has(ch.build)} onDone={reload} size="md" />}
          </div>
        ))}
      </Panel>

      <SectionTitle>Downloaded</SectionTitle>
      <Panel className="mb-8">
        {have.size === 0 ? (
          <div className="px-4 py-8 text-center text-[13px] text-fg-subtle">
            No {platformLabel(platform)} builds downloaded yet. They are fetched automatically when you create a server.
          </div>
        ) : (
          [...have.values()].map((a, i) => {
            const users = servers.filter((s) => a.usedBy.includes(s.id))
            return (
              <div key={a.build} className={cn('group flex h-14 items-center gap-4 px-4', i > 0 && 'border-t border-line')}>
                <span className="w-[72px] font-mono text-[13px] text-fg">{a.build}</span>
                <span className="w-[80px] text-xs text-fg-subtle tabular">{a.size ? formatBytes(a.size) : '–'}</span>
                <span className="min-w-0 flex-1 truncate text-xs text-fg-muted">
                  {users.length ? users.map((u) => u.name).join(', ') : <span className="text-fg-faint">Not used by any server</span>}
                </span>
                <span className="text-xs text-fg-subtle">{a.installedAt ? relativeTime(a.installedAt) : ''}</span>
                <Tooltip content={users.length ? 'In use' : 'Delete build'}>
                  <span>
                    <Button
                      variant="ghost"
                      size="sm"
                      square
                      disabled={users.length > 0}
                      onClick={() => remove(a)}
                      icon={<Trash2 size={13} strokeWidth={1.75} />}
                    />
                  </span>
                </Tooltip>
              </div>
            )
          })
        )}
      </Panel>

      <SectionTitle
        action={
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Find a build"
            leading={<Search size={13} />}
            className="w-[200px]"
          />
        }
      >
        Available builds
      </SectionTitle>
      <Panel>
        {catalog.loading && !c ? (
          <div className="flex justify-center py-10 text-fg-subtle">
            <Spinner />
          </div>
        ) : builds.length === 0 ? (
          <EmptyState className="py-10" title="No builds match" />
        ) : (
          builds.map((b, i) => {
            const s = support(b.supportedUntil)
            return (
              <div key={b.build} className={cn('flex h-12 items-center gap-4 px-4', i > 0 && 'border-t border-line')}>
                <span className="w-[72px] font-mono text-[13px] text-fg">{b.build}</span>
                <div className="flex flex-1 items-center gap-1.5">
                  {b.build === c?.recommended && <Badge>Recommended</Badge>}
                  {b.build === c?.latest && platform === 'legacy' && <Badge>Latest</Badge>}
                  {s && s.tone !== 'neutral' && <Badge tone={s.tone}>{s.label}</Badge>}
                </div>
                {s && s.tone === 'neutral' && <span className="text-xs text-fg-subtle">{s.label}</span>}
                <div className="flex w-[150px] justify-end">
                  <InstallButton platform={platform} build={b.build} installed={have.has(b.build)} onDone={reload} quiet />
                </div>
              </div>
            )
          })
        )}
      </Panel>
    </Page>
  )
}
