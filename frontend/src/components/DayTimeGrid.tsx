import { useMemo, useState, type DragEvent, type ReactNode } from 'react'
import { AlertTriangle } from 'lucide-react'
import type { Assignment, Course, Session, TimeConfig } from '../types'
import { catColor, isTeaching, slotLabel } from '../format'

/**
 * The one timetable layout used everywhere, matching the official IIIT Surat sheets: one row per
 * day, one column per period. Sessions that overlap within the row (G1/G2 labs, or clashes in a
 * draft) stack vertically. The student lunch window is marked in the header and the grid.
 */
interface Props {
  tc: TimeConfig
  assignments: Assignment[]
  sessions: Record<string, Session>
  courses: Record<string, Course>
  conflicts: Set<string>
  moved?: Set<string>
  ghosts?: Assignment[]
  selected: string | null
  onSelect: (sid: string | null) => void
  onDropSession?: (sid: string, day: number, slot: number) => void
  /** first detail line (e.g. group tag + room) */
  lineA: (a: Assignment, s: Session) => ReactNode
  /** second detail line (e.g. teacher, or class in faculty/room views) */
  lineB: (a: Assignment, s: Session) => string
  dayH?: number
  compact?: boolean
}

interface Placed { a: Assignment; sub: number; nsub: number }

export default function DayTimeGrid(p: Props) {
  const { tc, sessions, courses } = p
  const n = tc.slots_per_day
  const dayH = p.dayH ?? (p.compact ? 68 : 104)
  const lunch = new Set(tc.lunch_window ?? [])
  const [over, setOver] = useState<{ day: number; slot: number } | null>(null)
  const [dragSid, setDragSid] = useState<string | null>(null)

  const byDay = useMemo(() => {
    const out: Record<number, Placed[]> = {}
    for (const a of p.assignments) (out[a.day] ||= []).push({ a, sub: 0, nsub: 1 })
    for (const items of Object.values(out)) {
      for (const it of items) {
        const dur = sessions[it.a.session_id]?.duration ?? 1
        const group = items.filter(o => {
          const od = sessions[o.a.session_id]?.duration ?? 1
          return o.a.start < it.a.start + dur && it.a.start < o.a.start + od
        }).sort((x, y) => x.a.session_id.localeCompare(y.a.session_id))
        it.nsub = group.length
        it.sub = group.indexOf(it)
      }
    }
    return out
  }, [p.assignments, sessions])

  const slotFromX = (e: DragEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    return Math.max(0, Math.min(n - 1, Math.floor(((e.clientX - r.left) / r.width) * n)))
  }
  const colStyle = (start: number, span: number) => ({ left: `${(start / n) * 100}%`, width: `${(span / n) * 100}%` })

  return (
    <div className="scroll-thin overflow-x-auto border border-navy/20 bg-white">
      <div style={{ minWidth: 72 + n * (p.compact ? 92 : 112) }}>
        <div className="flex border-b-2 border-navy">
          <div className="w-[72px] shrink-0 border-r-2 border-navy" />
          {Array.from({ length: n }, (_, t) => (
            <div key={t} className={`relative flex-1 border-r border-navy/15 px-1 text-center last:border-r-0 ${p.compact ? 'py-1' : 'py-1.5'} ${tc.break_slots.includes(t) ? 'hatch-break' : ''} ${lunch.has(t) ? 'bg-lime-50' : ''}`}>
              <div className={`font-display font-semibold leading-none ${p.compact ? 'text-sm' : 'text-base'}`}>{t + 1}</div>
              <div className="mt-0.5 font-mono text-[9.5px] text-slate">{slotLabel(tc, t)} – {slotLabel(tc, t + 1)}</div>
              {lunch.has(t) && <div className="font-mono text-[8.5px] uppercase tracking-[0.14em] text-navy/70">lunch window</div>}
            </div>
          ))}
        </div>
        {tc.days.map((dname, d) => (
          <div key={d} className="flex border-b border-navy/20 last:border-b-0" style={{ height: dayH }}>
            <div className={`flex w-[72px] shrink-0 items-center justify-center border-r-2 border-navy font-display font-semibold ${p.compact ? 'text-lg' : 'text-2xl'}`}>
              {dname.slice(0, 2)}
            </div>
            <div
              className="relative flex-1"
              onDragOver={e => { if (!p.onDropSession) return; e.preventDefault(); setOver({ day: d, slot: slotFromX(e) }) }}
              onDragLeave={() => setOver(null)}
              onDrop={e => {
                e.preventDefault()
                const sid = e.dataTransfer.getData('text/session')
                const off = Number(e.dataTransfer.getData('text/offset') || 0)
                setOver(null); setDragSid(null)
                if (sid && p.onDropSession) p.onDropSession(sid, d, Math.max(0, slotFromX(e) - off))
              }}
              onClick={e => { if (e.target === e.currentTarget) p.onSelect(null) }}
            >
              {Array.from({ length: n }, (_, t) => (
                <div key={t} className={`pointer-events-none absolute inset-y-0 border-r border-navy/10 ${tc.break_slots.includes(t) ? 'hatch-break' : !isTeaching(tc, d, t) ? 'hatch-closed' : lunch.has(t) ? 'bg-lime-50/60' : ''}`}
                  style={colStyle(t, 1)} />
              ))}
              {(p.ghosts || []).filter(g => g.day === d).map(g => {
                const s = sessions[g.session_id]
                const c = s && courses[s.course_id]
                if (!s || !c) return null
                return (
                  <div key={`g-${g.session_id}`} className="pointer-events-none absolute inset-y-1 border border-dashed border-navy/40 bg-ivory/40 px-1.5 py-1"
                    style={colStyle(g.start, s.duration)}>
                    <span className="font-mono text-[9px] text-slate line-through">{c.code}</span>
                  </div>
                )
              })}
              {over?.day === d && dragSid && (
                <div className="pointer-events-none absolute inset-y-0 border-2 border-dashed border-navy/50 bg-lime/25"
                  style={colStyle(over.slot, sessions[dragSid]?.duration ?? 1)} />
              )}
              {(byDay[d] || []).map(({ a, sub, nsub }) => {
                const s = sessions[a.session_id]
                const c = s && courses[s.course_id]
                if (!s || !c) return null
                const col = catColor(c.category)
                const sel = p.selected === s.id
                const bad = p.conflicts.has(s.id)
                const tight = nsub > 1 || !!p.compact
                return (
                  <button
                    key={s.id}
                    draggable={!!p.onDropSession}
                    onDragStart={e => {
                      e.dataTransfer.setData('text/session', s.id)
                      const r = e.currentTarget.getBoundingClientRect()
                      e.dataTransfer.setData('text/offset', String(Math.floor(((e.clientX - r.left) / r.width) * s.duration)))
                      setDragSid(s.id)
                    }}
                    onDragEnd={() => { setDragSid(null); setOver(null) }}
                    onClick={() => p.onSelect(sel ? null : s.id)}
                    title={`${c.code} · ${c.name}\n${slotLabel(tc, a.start)}–${slotLabel(tc, a.start + s.duration)} · ${a.room_id} · ${p.lineB(a, s)}`}
                    className={`absolute z-[1] overflow-hidden border-l-[3px] text-left transition-shadow hover:z-10 hover:shadow-[0_4px_14px_-6px_rgba(23,36,59,0.45)]
                      ${c.course_type === 'tutorial' ? 'border border-dashed' : 'border border-transparent'}
                      ${sel ? '!z-10 !border-navy ring-1 ring-navy' : ''} ${bad ? '!border-conflict ring-1 ring-conflict' : ''}`}
                    style={{
                      left: `calc(${(a.start / n) * 100}% + 2px)`, width: `calc(${(s.duration / n) * 100}% - 4px)`,
                      top: `calc(${(sub / nsub) * 100}% + 2px)`, height: `calc(${100 / nsub}% - 4px)`,
                      borderLeftColor: bad ? '#D94B4B' : col, backgroundColor: sel ? '#D8FF66' : `${col}14`,
                    }}
                  >
                    {c.course_type === 'lab' && <span className="hatch-lab pointer-events-none absolute inset-0" />}
                    <span className={`relative flex h-full ${tight ? 'flex-col justify-center gap-0.5 px-1.5' : 'flex-col px-2 py-1.5'}`}>
                      <span className="flex items-center gap-1.5">
                        <span className={`font-display font-semibold leading-none ${tight ? 'text-[13px]' : 'text-[17px]'}`}>{c.code}</span>
                        <span className="font-mono text-[9px] uppercase text-slate">{c.course_type === 'lecture' ? 'LEC' : c.course_type === 'lab' ? 'LAB' : 'TUT'}</span>
                        {bad && <AlertTriangle className="h-3 w-3 text-conflict" />}
                        {p.moved?.has(s.id) && !bad && <span className="h-1.5 w-1.5 bg-navy" title="Moved vs baseline" />}
                      </span>
                      {!tight && <span className="mt-0.5 truncate text-[11px] leading-tight text-navy/80">{c.name}</span>}
                      <span className={`truncate font-mono text-[9.5px] leading-tight text-slate-600 ${tight ? '' : 'mt-auto'}`}>{p.lineA(a, s)}</span>
                      <span className="truncate text-[10px] leading-tight text-navy/75">{p.lineB(a, s)}</span>
                    </span>
                  </button>
                )
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
