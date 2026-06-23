import type { JSX } from 'react'
import { BrowserRouter, Navigate, Route, Routes, useParams } from 'react-router-dom'

import { ErrorBoundary } from '@/components/ErrorBoundary'
import { GamePage } from '@/pages/GamePage'
import { HomePage } from '@/pages/HomePage'
import { NotFoundPage } from '@/pages/NotFoundPage'
import { SetupPage } from '@/pages/SetupPage'

/**
 * Legacy `/board/:gameId` redirect. The board and player draft screens are now
 * a single `GamePage` at `/play/:gameId`; without a `?t=` token it renders the
 * read-only board view. Old board links keep working.
 */
function BoardRedirect(): JSX.Element {
  const { gameId } = useParams<{ gameId: string }>()
  return <Navigate to={`/play/${gameId ?? ''}`} replace />
}

/**
 * Route table for the app. Exported separately from the default `App` so tests
 * can mount it inside a `MemoryRouter` without paying the cost of a real
 * `BrowserRouter` or duplicating the route table.
 */
export function AppRoutes(): JSX.Element {
  return (
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route path="/setup" element={<SetupPage />} />
      <Route path="/play/:gameId" element={<GamePage />} />
      <Route path="/board/:gameId" element={<BoardRedirect />} />
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  )
}

// Strip the trailing slash from Vite's BASE_URL so React Router treats it as
// a clean basename (e.g. `/goa2-drafter/` → `/goa2-drafter`). At the site root
// this collapses to an empty string, which BrowserRouter handles correctly.
const basename = import.meta.env.BASE_URL.replace(/\/$/, '')

export default function App(): JSX.Element {
  return (
    <BrowserRouter basename={basename}>
      <ErrorBoundary>
        <div className="min-h-screen bg-slate-950 text-slate-100">
          <AppRoutes />
        </div>
      </ErrorBoundary>
    </BrowserRouter>
  )
}
