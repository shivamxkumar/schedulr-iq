import { useEffect, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { AppProvider, useApp, type ViewName } from './store'
import { api, session, type User } from './api'
import Login from './views/Login'
import Credit from './components/Credit'
import Setup from './views/Setup'
import { Rail, Toasts, TopBar } from './components/Shell'
import { Button, ErrorBox, Spinner } from './components/ui'
import Overview from './views/Overview'
import Studio from './views/Studio'
import Lab from './views/Lab'
import Conflicts from './views/Conflicts'
import Resources from './views/Resources'
import DataSetup from './views/DataSetup'
import Publish from './views/Publish'

const KEYS: Record<string, ViewName> = { '1': 'overview', '2': 'studio', '3': 'lab', '4': 'conflicts', '5': 'resources', '6': 'setup', '7': 'data', '8': 'publish' }

function Body() {
  const { view, setView, loading, fatal, refresh } = useApp()
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      if (e.metaKey || e.ctrlKey || e.altKey || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName)) return
      if (KEYS[e.key]) setView(KEYS[e.key])
    }
    window.addEventListener('keydown', on)
    return () => window.removeEventListener('keydown', on)
  }, [setView])

  if (loading) return <div className="flex h-[60vh] items-center justify-center"><Spinner label="Connecting to scheduling engine…" /></div>
  if (fatal) {
    return (
      <div className="mx-auto max-w-xl p-8">
        <ErrorBox title="Backend unavailable">
          <p>{fatal}</p>
          <p className="mt-2 font-mono text-xs">cd backend && .venv/bin/uvicorn app.main:app --port 8010</p>
        </ErrorBox>
        <Button className="mt-4" onClick={refresh}><RefreshCw className="h-4 w-4" /> Retry</Button>
      </div>
    )
  }
  return (
    <>
      {view === 'overview' && <Overview />}
      {view === 'studio' && <Studio />}
      {view === 'lab' && <Lab />}
      {view === 'conflicts' && <Conflicts />}
      {view === 'resources' && <Resources />}
      {view === 'setup' && <Setup />}
      {view === 'data' && <DataSetup />}
      {view === 'publish' && <Publish />}
    </>
  )
}

export default function App() {
  const [user, setUser] = useState<User | null>(null)
  const [checking, setChecking] = useState(!!session.token)

  useEffect(() => {
    session.onUnauthorized(() => { session.set(null); setUser(null) })
    if (!session.token) return
    api.me().then(setUser).catch(() => session.set(null)).finally(() => setChecking(false))
  }, [])

  const logout = () => { session.set(null); setUser(null) }

  if (checking) return <div className="flex h-screen items-center justify-center"><Spinner label="Restoring session…" /></div>
  if (!user) return <Login onLogin={setUser} />
  return (
    <AppProvider user={user} logout={logout}>
      <Rail />
      <div className="md:pl-[72px]">
        <TopBar />
        <main><Body /></main>
        <Credit className="border-t border-navy/10 pb-20 md:pb-4" />
      </div>
      <Toasts />
    </AppProvider>
  )
}
