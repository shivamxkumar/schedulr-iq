import type { ReactNode } from 'react'
import { CalendarRange, CheckCircle2, Database, FlaskConical, Gauge, Printer, ShieldAlert, Boxes, X, AlertTriangle, Info, Undo2, SlidersHorizontal, LogOut, Lock } from 'lucide-react'
import { InstituteMark, INSTITUTE } from '../views/Login'
import { useApp, type ViewName } from '../store'
import { Chip, KindBadge, Mono } from './ui'

const NAV: { id: ViewName; label: string; icon: any; key: string }[] = [
  { id: 'overview', label: 'Overview', icon: Gauge, key: '1' },
  { id: 'studio', label: 'Timetable', icon: CalendarRange, key: '2' },
  { id: 'lab', label: 'Optimize', icon: FlaskConical, key: '3' },
  { id: 'conflicts', label: 'Conflicts', icon: ShieldAlert, key: '4' },
  { id: 'resources', label: 'Resources', icon: Boxes, key: '5' },
  { id: 'setup', label: 'Setup', icon: SlidersHorizontal, key: '6' },
  { id: 'data', label: 'Import', icon: Database, key: '7' },
  { id: 'publish', label: 'Publish', icon: Printer, key: '8' },
]

function Logo() {
  return (
    <div className="flex h-14 w-full items-center justify-center border-b border-white/10" title={INSTITUTE}>
      <InstituteMark size={38} />
    </div>
  )
}

export function Rail() {
  const { view, setView, active } = useApp()
  const hard = active?.validation.hard_count ?? 0
  return (
    <nav className="no-print fixed inset-x-0 bottom-0 z-30 flex h-14 bg-navy md:inset-y-0 md:left-0 md:right-auto md:h-auto md:w-[72px] md:flex-col">
      <div className="hidden md:block"><Logo /></div>
      <div className="flex flex-1 justify-around md:flex-col md:justify-start md:gap-0.5 md:pt-2">
        {NAV.map(n => {
          const on = view === n.id
          const Icon = n.icon
          return (
            <button
              key={n.id}
              onClick={() => setView(n.id)}
              title={`${n.label} (${n.key})`}
              aria-current={on ? 'page' : undefined}
              className={`group relative flex flex-1 flex-col items-center justify-center gap-1 py-2 md:flex-none md:py-2.5 ${on ? 'text-lime' : 'text-ivory/60 hover:text-ivory'}`}
            >
              {on && <span className="absolute left-0 top-1/2 hidden h-8 w-[3px] -translate-y-1/2 bg-lime md:block" />}
              <Icon className="h-[18px] w-[18px]" strokeWidth={1.75} />
              <span className="font-mono text-[9px] uppercase tracking-[0.12em]">{n.label}</span>
              {n.id === 'conflicts' && hard > 0 && (
                <span className="absolute right-3 top-1.5 min-w-[16px] bg-conflict px-1 font-mono text-[9px] leading-4 text-white md:right-3">{hard}</span>
              )}
            </button>
          )
        })}
      </div>
    </nav>
  )
}

export function TopBar() {
  const { data, list, active, baselineId, activate, user, logout, canEdit } = useApp()
  if (!data) return null
  const v = active?.validation
  const parent = active?.record.parent_id
  return (
    <header className="no-print sticky top-0 z-20 flex min-h-14 flex-wrap items-center gap-x-5 gap-y-2 border-b border-navy/10 bg-ivory/95 px-4 py-2 backdrop-blur md:px-6">
      <div className="flex items-center gap-2.5 md:hidden"><InstituteMark size={28} /></div>
      <div className="flex min-w-0 flex-col leading-tight">
        <span className="font-display text-[15px] font-bold tracking-tight">SCHEDULR<span className="ml-0.5 bg-navy px-1 text-lime">IQ</span></span>
        <span className="truncate text-2xs text-slate">{INSTITUTE}</span>
      </div>
      <div className="hidden h-7 w-px bg-navy/15 md:block" />
      <div className="hidden min-w-0 truncate text-xs text-slate xl:block"><span>Dataset · </span><span className="text-navy">{data.dataset.name}</span></div>
      <div className="ml-auto flex flex-wrap items-center gap-2">
        {active && (
          <>
            <label className="flex items-center gap-2">
              <span className="font-mono text-2xs uppercase tracking-wider text-slate">Viewing</span>
              <select
                value={active.record.id}
                onChange={e => activate(e.target.value)}
                className="h-8 max-w-[220px] border border-navy/20 bg-white px-2 font-mono text-xs focus:border-navy focus:outline-none"
              >
                {list.map(s => (
                  <option key={s.id} value={s.id}>
                    {s.id} · {s.label}{s.id === baselineId ? ' ★' : ''}{s.hard_count ? ` · ${s.hard_count} conflicts` : ''}{s.published ? ' · PUBLISHED' : ''}
                  </option>
                ))}
              </select>
            </label>
            {parent && ['manual', 'draft'].includes(active.record.kind) && (
              <button onClick={() => activate(parent)} className="inline-flex h-8 items-center gap-1 border border-navy/20 bg-white px-2 text-xs hover:border-navy" title="Undo: return to the schedule before this edit">
                <Undo2 className="h-3.5 w-3.5" /> Undo
              </button>
            )}
            <KindBadge kind={active.record.kind} />
            {v && (v.feasible && v.complete
              ? <Chip tone="lime"><CheckCircle2 className="h-3 w-3" /> Valid · {v.scheduled}/{v.required}</Chip>
              : <Chip tone="red"><AlertTriangle className="h-3 w-3" /> {v.hard_count} hard · {v.required - v.scheduled} unscheduled</Chip>)}
            {active.record.published && <Chip tone="navy">Published</Chip>}
          </>
        )}
        <div className="ml-1 flex items-center gap-2 border-l border-navy/15 pl-3">
          <div className="hidden text-right leading-tight sm:block">
            <div className="text-xs font-medium">{user.name}</div>
            <div className="font-mono text-2xs text-slate">{user.username} · {canEdit ? 'admin' : <span className="inline-flex items-center gap-0.5"><Lock className="h-2.5 w-2.5" />read-only</span>}</div>
          </div>
          <button onClick={logout} title="Sign out" aria-label="Sign out" className="flex h-8 w-8 items-center justify-center border border-navy/20 bg-white hover:border-navy"><LogOut className="h-3.5 w-3.5" /></button>
        </div>
      </div>
    </header>
  )
}

export function Toasts() {
  const { toasts, dismiss } = useApp()
  return (
    <div className="no-print fixed bottom-16 right-4 z-50 flex w-[min(380px,calc(100vw-32px))] flex-col gap-2 md:bottom-4">
      {toasts.map(t => (
        <div key={t.id} className={`fade-up flex gap-3 border bg-white px-3.5 py-3 shadow-[0_6px_24px_-12px_rgba(23,36,59,0.4)] ${t.tone === 'error' ? 'border-conflict/50' : t.tone === 'ok' ? 'border-navy' : 'border-slate-200'}`}>
          <div className={`mt-0.5 ${t.tone === 'error' ? 'text-conflict' : 'text-navy'}`}>
            {t.tone === 'ok' ? <span className="block h-4 w-4 bg-lime ring-1 ring-navy" /> : t.tone === 'error' ? <AlertTriangle className="h-4 w-4" /> : <Info className="h-4 w-4" />}
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold">{t.title}</div>
            {t.body && <div className="mt-0.5 text-xs leading-relaxed text-slate-600">{t.body}</div>}
            {t.action && <button className="mt-1.5 font-mono text-2xs uppercase tracking-wider underline underline-offset-2" onClick={() => { t.action!.run(); dismiss(t.id) }}>{t.action.label}</button>}
          </div>
          <button onClick={() => dismiss(t.id)} className="self-start text-slate hover:text-navy" aria-label="Dismiss"><X className="h-4 w-4" /></button>
        </div>
      ))}
    </div>
  )
}

export function Page({ title, eyebrow, actions, children, wide }: { title: string; eyebrow?: string; actions?: ReactNode; children: ReactNode; wide?: boolean }) {
  return (
    <div className={`mx-auto w-full px-4 pb-24 pt-6 md:px-8 md:pb-10 ${wide ? 'max-w-none' : 'max-w-[1400px]'}`}>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          {eyebrow && <Mono className="text-2xs uppercase tracking-[0.18em] text-slate">{eyebrow}</Mono>}
          <h1 className="font-display text-[28px] font-semibold leading-tight tracking-tight md:text-[32px]">{title}</h1>
        </div>
        {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
      </div>
      {children}
    </div>
  )
}
