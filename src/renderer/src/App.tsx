import { useEffect } from 'react'
import { HashRouter, Route, Routes, useNavigate } from 'react-router'
import { CommandPalette } from '@/components/command-palette'
import { AdminDialog } from '@/components/dialogs/admin'
import { DeleteServerDialog } from '@/components/dialogs/delete-server'
import { DuplicateServerDialog } from '@/components/dialogs/duplicate-server'
import { ImportServerDialog } from '@/components/dialogs/import-server'
import { NewServerDialog } from '@/components/dialogs/new-server'
import { Sidebar } from '@/components/layout/sidebar'
import { TitleBar } from '@/components/layout/titlebar'
import { Toaster } from '@/components/ui/toast'
import { TooltipProvider } from '@/components/ui/tooltip'
import { api } from '@/lib/utils'
import { AdminsPage } from '@/pages/admins'
import { ArtifactsPage } from '@/pages/artifacts'
import { DatabasePage } from '@/pages/database'
import { OnboardingPage } from '@/pages/onboarding'
import { OverviewPage } from '@/pages/overview'
import { ServerPage } from '@/pages/server'
import { SettingsPage } from '@/pages/settings'
import { useApp } from '@/store/app'

function Shell() {
  const navigate = useNavigate()
  const settings = useApp((s) => s.settings)
  const setPaletteOpen = useApp((s) => s.setPaletteOpen)

  useEffect(() => api.on.navigate((path) => navigate(path)), [navigate])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setPaletteOpen(!useApp.getState().paletteOpen)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [setPaletteOpen])

  return (
    <div className="flex h-full flex-col bg-bg">
      <TitleBar />
      <div className="flex min-h-0 flex-1">
        <Sidebar />
        <main className="mr-2 mb-2 min-w-0 flex-1 overflow-hidden rounded-[12px] bg-panel shadow-[0_0_0_1px_var(--line)]">
          {settings && !settings.onboarded ? (
            <OnboardingPage />
          ) : (
            <Routes>
              <Route path="/" element={<OverviewPage />} />
              <Route path="/servers/:id" element={<ServerPage />} />
              <Route path="/servers/:id/:tab" element={<ServerPage />} />
              <Route path="/artifacts" element={<ArtifactsPage />} />
              <Route path="/database" element={<DatabasePage />} />
              <Route path="/admins" element={<AdminsPage />} />
              <Route path="/settings" element={<SettingsPage />} />
            </Routes>
          )}
        </main>
      </div>
      <NewServerDialog />
      <ImportServerDialog />
      <DuplicateServerDialog />
      <DeleteServerDialog />
      <AdminDialog />
      <CommandPalette />
      <Toaster />
    </div>
  )
}

export function App() {
  const ready = useApp((s) => s.ready)
  const init = useApp((s) => s.init)

  useEffect(() => {
    void init()
  }, [init])

  if (!ready) return <div className="h-full bg-bg" />

  return (
    <TooltipProvider delayDuration={400} skipDelayDuration={150}>
      <HashRouter>
        <Shell />
      </HashRouter>
    </TooltipProvider>
  )
}
