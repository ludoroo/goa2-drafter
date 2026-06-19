import type { JSX } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button, Card } from '@/components/ui'

/**
 * Landing page for the GoA2 Drafter. Explains the no-login flow and lets the
 * organiser start a fresh setup. Game persistence happens at the very end of
 * the wizard (SetupPage), so this button just navigates with no side effects.
 */
export function HomePage(): JSX.Element {
  const navigate = useNavigate()

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <div className="mx-auto flex min-h-screen max-w-3xl flex-col items-center justify-center px-6 py-16">
        <header className="mb-10 text-center">
          <p className="mb-3 text-sm font-semibold uppercase tracking-[0.2em] text-amber-400">
            Guards of Atlantis II
          </p>
          <h1 className="bg-gradient-to-br from-teal-300 via-cyan-300 to-amber-200 bg-clip-text text-5xl font-extrabold tracking-tight text-transparent sm:text-6xl">
            Drafter
          </h1>
          <p className="mt-4 text-lg text-slate-300">
            Set up teams, build a hero pool, and run a snake or random draft &mdash; all from a
            single shared link.
          </p>
        </header>

        <Card className="w-full">
          <div className="space-y-4 p-2">
            <h2 className="text-xl font-semibold text-teal-300">How it works</h2>
            <ol className="list-decimal space-y-2 pl-5 text-slate-300">
              <li>Pick player count, names, and teams.</li>
              <li>Choose which hero packs, or individual heroes, are in play.</li>
              <li>Pick a draft method &mdash; snake or random.</li>
              <li>Share the generated links with your group.</li>
            </ol>
            <p className="rounded-md border border-slate-700 bg-slate-900/60 p-3 text-sm text-slate-400">
              No logins needed &mdash; each player gets a magic link to pick their hero, and anyone
              with the game code can see the current selections.
            </p>
            <div className="flex justify-center pt-2">
              <Button
                size="lg"
                onClick={() => {
                  navigate('/setup')
                }}
              >
                Create a new game
              </Button>
            </div>
          </div>
        </Card>

        <footer className="mt-10 text-center text-xs text-slate-500">
          Unofficial fan tool. Guards of Atlantis II is a trademark of its respective owner.
        </footer>
      </div>
    </div>
  )
}
