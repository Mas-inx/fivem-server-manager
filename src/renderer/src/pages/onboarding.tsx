import { ArrowRight } from 'lucide-react'
import { useState } from 'react'
import { Logo } from '@/components/logo'
import { Button } from '@/components/ui/button'
import { Field, Input } from '@/components/ui/input'
import { attempt } from '@/components/ui/toast'
import { api } from '@/lib/utils'
import { useApp } from '@/store/app'

export function OnboardingPage() {
  const settings = useApp((s) => s.settings)!
  const update = useApp((s) => s.updateSettings)
  const [path, setPath] = useState(settings.libraryPath)
  const [busy, setBusy] = useState(false)

  return (
    <div className="flex h-full items-center justify-center px-8">
      <div className="w-full max-w-[440px] animate-slide-up">
        <Logo size={36} />
        <h1 className="mt-6 text-[24px] leading-8 font-semibold tracking-[-0.02em] text-fg">Run every FiveM server from one place</h1>
        <p className="mt-2 text-[14px] leading-[22px] text-fg-subtle">
          Download builds, set up txAdmin and databases, and start, stop or duplicate servers side by side on this PC.
        </p>

        <div className="mt-8">
          <Field
            label="Library folder"
            hint="Servers, server builds and the managed database are kept here. A short path without spaces works best."
          >
            <div className="flex gap-1.5">
              <Input mono value={path} onChange={(e) => setPath(e.target.value)} className="flex-1" />
              <Button
                onClick={async () => {
                  const p = await api.app.pickFolder('Choose a library folder', path)
                  if (p) setPath(p)
                }}
              >
                Browse
              </Button>
            </div>
          </Field>
        </div>

        <Button
          variant="primary"
          size="lg"
          className="mt-8 w-full"
          loading={busy}
          iconRight={<ArrowRight size={15} />}
          onClick={async () => {
            setBusy(true)
            await attempt(() => update({ libraryPath: path.trim() || settings.libraryPath, onboarded: true }))
            setBusy(false)
          }}
        >
          Get started
        </Button>
      </div>
    </div>
  )
}
