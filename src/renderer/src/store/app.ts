import { create } from 'zustand'
import type {
  AppSettings,
  DbStatus,
  LogLine,
  ServerConfig,
  ServerRuntime,
  TaskInfo,
  ThemePreference
} from '@shared/types'
import { api } from '@/lib/utils'

const HISTORY = 60
const MAX_LOGS = 5000

export interface Series {
  cpu: number[]
  memory: number[]
  players: number[]
}

interface AppState {
  ready: boolean
  settings: AppSettings | null
  servers: ServerConfig[]
  runtime: Record<string, ServerRuntime>
  history: Record<string, Series>
  tasks: TaskInfo[]
  db: DbStatus | null
  resolvedTheme: 'dark' | 'light'
  paletteOpen: boolean
  setPaletteOpen(open: boolean): void
  init(): Promise<void>
  updateSettings(patch: Partial<AppSettings>): Promise<void>
}

interface LogState {
  logs: Record<string, LogLine[]>
  load(id: string): Promise<void>
  clear(id: string): void
}

const media = window.matchMedia('(prefers-color-scheme: dark)')

function resolveTheme(pref: ThemePreference): 'dark' | 'light' {
  if (pref === 'system') return media.matches ? 'dark' : 'light'
  return pref
}

function applyTheme(theme: 'dark' | 'light'): void {
  document.documentElement.dataset.theme = theme
  api.app.setTitleBarTheme(theme)
}

export const useApp = create<AppState>((set, get) => ({
  ready: false,
  settings: null,
  servers: [],
  runtime: {},
  history: {},
  tasks: [],
  db: null,
  resolvedTheme: 'dark',
  paletteOpen: false,
  setPaletteOpen: (paletteOpen) => set({ paletteOpen }),

  async init() {
    const [settings, servers, runtime, tasks, db] = await Promise.all([
      api.settings.get(),
      api.servers.list(),
      api.servers.runtime(),
      api.tasks.list(),
      api.db.status()
    ])
    const theme = resolveTheme(settings.theme)
    applyTheme(theme)
    set({ settings, servers, runtime, tasks, db, ready: true, resolvedTheme: theme })

    api.on.settings((s) => {
      const t = resolveTheme(s.theme)
      if (t !== get().resolvedTheme) applyTheme(t)
      set({ settings: s, resolvedTheme: t })
    })
    api.on.servers((servers) => set({ servers }))
    api.on.tasks((tasks) => set({ tasks }))
    api.on.db((db) => set({ db }))
    api.on.runtime((runtime) => {
      const history = { ...get().history }
      for (const [id, r] of Object.entries(runtime)) {
        const live = r.status === 'running' || r.status === 'starting'
        const prev = history[id] ?? { cpu: [], memory: [], players: [] }
        if (!live && !prev.cpu.length) continue
        const push = (arr: number[], v: number): number[] => [...arr.slice(-(HISTORY - 1)), v]
        history[id] = {
          cpu: push(prev.cpu, live ? r.cpu : 0),
          memory: push(prev.memory, live ? r.memory : 0),
          players: push(prev.players, live ? r.players : 0)
        }
      }
      set({ runtime, history })
    })
    media.addEventListener('change', () => {
      const pref = get().settings?.theme
      if (pref !== 'system') return
      const t = resolveTheme(pref)
      applyTheme(t)
      set({ resolvedTheme: t })
    })
  },

  async updateSettings(patch) {
    const settings = await api.settings.update(patch)
    set({ settings })
  }
}))

export const useLogs = create<LogState>((set, get) => ({
  logs: {},
  async load(id) {
    const lines = await api.servers.logs(id)
    set({ logs: { ...get().logs, [id]: lines } })
  },
  clear(id) {
    void api.servers.clearLogs(id)
    set({ logs: { ...get().logs, [id]: [] } })
  }
}))

api.on.logs(({ id, lines }) => {
  const cur = useLogs.getState().logs[id]
  if (!cur) return
  const next = cur.concat(lines)
  useLogs.setState({
    logs: { ...useLogs.getState().logs, [id]: next.length > MAX_LOGS ? next.slice(next.length - MAX_LOGS) : next }
  })
})

export function useServer(id: string | undefined): ServerConfig | undefined {
  return useApp((s) => s.servers.find((x) => x.id === id))
}

export function useRuntime(id: string | undefined): ServerRuntime | undefined {
  return useApp((s) => (id ? s.runtime[id] : undefined))
}
