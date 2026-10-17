import { useMemo, useState, type DragEvent } from 'react'
import { AlertTriangle } from 'lucide-react'
import type { Assignment, Course, Session, TimeConfig } from '../types'
import { catColor, isTeaching, slotLabel } from '../format'

/**
 * Class timetable in the layout of the official IIIT Surat sheets: one row per day, one column per
 * time slot. Sessions that run in parallel for the same class (G1 / G2 labs) stack inside the row.
 */
interface Props {
  tc: TimeConfig
  assignments: Assignment[] // already filtered to one class
  sessions: Record<string, Session>
  courses: Record<string, Course>
  conflicts: Set<string>
  moved?: Set<string>
  selected: string | null
  onSelect: (sid: string | null) => void
  onDropSession?: (sid: string, day: number, slot: number) => void
  labelBatches: (ids: string[]) => string
  facultyName: (id: string) => string
  dayH?: number
  print?: boolean
}

interface Placed { a: Assignment; sub: number; nsub: number }

export default function DayTimeGrid(p: Props) {
  const { tc, sessions, courses } = p
  const n = tc.slots_per_day
  const dayH = p.dayH ?? 104
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

  return (
    <div className={`scroll-thin overflow-x-auto border border-navy/20 bg-white ${p.print ? '' : ''}`}>
      <div style={{ minWidth: 88 + n * 112 }}>
        {/* header: slot number + time range, as on the official sheet */}
        <div className="flex border-b-2 border-navy">
          <div className="w-[88px] shrink-0 border-r-2 border-navy" />
          {Array.from({ length: n }, (_, t) => (
            <div key={t} className={`flex-1 border-r border-navy/15 px-1 py-1.5 text-center last:border-r-0 ${tc.break_slots.includes(t) ? 'hatch-break' : ''}`}>
              <div className="font-display text-base font-semibold leading-none">{t + 1}</div>
              <div className="mt-1 font-mono text-[9.5px] text-slate">{slotLabel(tc, t)} – {slotLabel(tc, t + 1)}</div>
            </div>
          ))}
        </div>
        {tc.days.map((dname, d) => (
          <div key={d} className="flex border-b border-navy/20 last:border-b-0" style={{ height: dayH }}>
            <div className="flex w-[88px] shrink-0 items-center justify-center border-r-2 border-navy font-display text-2xl font-semibold">
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
                <div key={t} className={`pointer-events-none absolute inset-y-0 border-r border-navy/10 ${tc.break_slots.includes(t) ? 'hatch-break' : !isTeaching(tc, d, t) ? 'hatch-closed' : ''}`}
                  style={{ left: `${(t / n) * 100}%`, width: `${100 / n}%` }} />
              ))}
              {over?.day === d && dragSid && (
                <div className="pointer-events-none absolute inset-y-0 border-2 border-dashed border-navy/50 bg-lime/25"
                  style={{ left: `${(over.slot / n) * 100}%`, width: `${((sessions[dragSid]?.duration ?? 1) / n) * 100}%` }} />
              )}
              {(byDay[d] || []).map(({ a, sub, nsub }) => {
                const s = sessions[a.session_id]
                const c = s && courses[s.course_id]
                if (!s || !c) return null
                const col = catColor(c.category)
                const sel = p.selected === s.id
                const bad = p.conflicts.has(s.id)
                const tight = nsub > 1
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
                    title={`${c.code} · ${c.name}\n${slotLabel(tc, a.start)}–${slotLabel(tc, a.start + s.duration)} · ${a.room_id} · ${p.facultyName(a.faculty_id)}`}
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
                    <span className={`relative flex h-full ${tight ? 'items-center gap-2 px-2' : 'flex-col px-2 py-1.5'}`}>
                      <span className="flex items-center gap-1.5">
                        <span className={`font-display font-semibold leading-none ${tight ? 'text-sm' : 'text-[17px]'}`}>{c.code}</span>
                        <span className="font-mono text-[9px] uppercase text-slate">{c.course_type === 'lecture' ? 'LEC' : c.course_type === 'lab' ? 'LAB' : 'TUT'}</span>
                        {bad && <AlertTriangle className="h-3 w-3 text-conflict" />}
                        {p.moved?.has(s.id) && !bad && <span className="h-1.5 w-1.5 bg-navy" title="Moved vs baseline" />}
                      </span>
                      {(() => {
                        const grp = p.labelBatches(s.batch_ids)
                        const tag = grp === 'Whole class' ? '' : grp.replace('Lab group ', '').replace('Elective div ', 'Div ')
                        return tight ? (
                          <span className="flex min-w-0 flex-1 items-center justify-between gap-2 font-mono text-[9.5px] text-slate-600">
                            <span className="truncate">{tag && <b className="mr-1 font-semibold text-navy">{tag}</b>}{a.room_id}</span>
                            <span className="truncate text-right font-sans text-[10px] text-navy/75">{p.facultyName(a.faculty_id)}</span>
                          </span>
                        ) : (
                          <>
                            <span className="mt-0.5 truncate text-[11px] leading-tight text-navy/80">{c.name}</span>
                            <span className="mt-auto truncate font-mono text-[9.5px] leading-tight text-slate-600">
                              {tag && <b className="mr-1 font-semibold text-navy">{tag}</b>}{a.room_id}
                            </span>
                            <span className="truncate text-[10px] leading-tight text-navy/75">{p.facultyName(a.faculty_id)}</span>
                          </>
                        )
                      })()}
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
