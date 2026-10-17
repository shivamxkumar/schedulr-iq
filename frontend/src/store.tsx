import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { api, ApiError, type User } from './api'
import type { Course, DatasetPayload, Faculty, Room, ScheduleListItem, ScheduleView, Session } from './types'

export type ViewName = 'overview' | 'studio' | 'lab' | 'conflicts' | 'resources' | 'setup' | 'data' | 'publish'

export interface Filters { batch: string; faculty: string; room: string; course: string; day: string }
export const emptyFilters: Filters = { batch: '', faculty: '', room: '', course: '', day: '' }

export interface Toast { id: number; tone: 'ok' | 'error' | 'info'; title: string; body?: string; action?: { label: string; run: () => void } }

interface Lookups {
  courses: Record<string, Course>; sessions: Record<string, Session>; rooms: Record<string, Room>; faculty: Record<string, Faculty>
}

interface Ctx {
  user: User
  canEdit: boolean
  logout: () => void
  data: DatasetPayload | null
  list: ScheduleListItem[]
  baselineId: string | null
  active: ScheduleView | null
  baseline: ScheduleView | null
  loading: boolean
  fatal: string | null
  view: ViewName
  setView: (v: ViewName) => void
  selected: string | null
  select: (sid: string | null) => void
  filters: Filters
  setFilters: (f: Filters) => void
  focus: (sid: string, f?: Partial<Filters>) => void
  refresh: () => Promise<void>
  activate: (id: string) => Promise<void>
  adopt: (v: ScheduleView) => Promise<void>
  toast: (t: Omit<Toast, 'id'>) => void
  toasts: Toast[]
  dismiss: (id: number) => void
  L: Lookups
  errMsg: (e: unknown) => string
}

const C = createContext<Ctx | null>(null)
export const useApp = () => {
  const c = useContext(C)
  if (!c) throw new Error('no ctx')
  return c
}

const initialView = (): ViewName => {
  const h = location.hash.replace('#/', '') as ViewName
  return ['overview', 'studio', 'lab', 'conflicts', 'resources', 'setup', 'data', 'publish'].includes(h) ? h : 'overview'
}

export function AppProvider({ children, user, logout }: { children: ReactNode; user: User; logout: () => void }) {
  const [data, setData] = useState<DatasetPayload | null>(null)
  const [list, setList] = useState<ScheduleListItem[]>([])
  const [baselineId, setBaselineId] = useState<string | null>(null)
  const [active, setActive] = useState<ScheduleView | null>(null)
  const [baseline, setBaseline] = useState<ScheduleView | null>(null)
  const [loading, setLoading] = useState(true)
  const [fatal, setFatal] = useState<string | null>(null)
  const [view, setViewState] = useState<ViewName>(initialView)
  const [selected, select] = useState<string | null>(null)
  const [filters, setFilters] = useState<Filters>(emptyFilters)
  const [toasts, setToasts] = useState<Toast[]>([])

  const errMsg = (e: unknown) => (e instanceof ApiError ? e.message : e instanceof Error ? e.message : String(e))

  const toast = useCallback((t: Omit<Toast, 'id'>) => {
    const id = Date.now() + Math.random()
    setToasts(ts => [...ts.slice(-3), { ...t, id }])
    setTimeout(() => setToasts(ts => ts.filter(x => x.id !== id)), t.action ? 9000 : 5000)
  }, [])
  const dismiss = (id: number) => setToasts(ts => ts.filter(x => x.id !== id))

  const setView = (v: ViewName) => {
    location.hash = `/${v}`
    setViewState(v)
  }
  useEffect(() => {
    const on = () => setViewState(initialView())
    window.addEventListener('hashchange', on)
    return () => window.removeEventListener('hashchange', on)
  }, [])

  const refresh = useCallback(async () => {
    try {
      const [d, l] = await Promise.all([api.dataset(), api.schedules()])
      setData(d)
      setList(l.schedules)
      setBaselineId(l.baseline_id)
      const [a, b] = await Promise.all([
        l.active_id ? api.schedule(l.active_id) : Promise.resolve(null),
        l.baseline_id ? api.schedule(l.baseline_id) : Promise.resolve(null),
      ])
      setActive(a)
      setBaseline(b)
      setFatal(null)
    } catch (e) {
      setFatal(errMsg(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { refresh() }, [refresh])

  const activate = useCallback(async (id: string) => {
    try {
      await api.activate(id)
      await refresh()
    } catch (e) {
      toast({ tone: 'error', title: 'Could not switch schedule', body: errMsg(e) })
    }
  }, [refresh, toast])

  const adopt = useCallback(async (v: ScheduleView) => {
    setActive(v)
    await refresh()
  }, [refresh])

  const focus = (sid: string, f?: Partial<Filters>) => {
    setFilters({ ...emptyFilters, ...(f || {}) })
    select(sid)
    setView('studio')
  }

  const L = useMemo<Lookups>(() => {
    const by = <T extends { id: string }>(xs: T[] = []) => Object.fromEntries(xs.map(x => [x.id, x]))
    return {
      courses: by(data?.dataset.courses), sessions: by(data?.sessions), rooms: by(data?.dataset.rooms),
      faculty: by(data?.dataset.faculty),
    }
  }, [data])

  return (
    <C.Provider value={{
      user, canEdit: user.role === 'admin', logout,
      data, list, baselineId, active, baseline, loading, fatal, view, setView, selected, select, filters, setFilters, focus,
      refresh, activate, adopt, toast, toasts, dismiss, L, errMsg,
    }}>
      {children}
    </C.Provider>
  )
}
