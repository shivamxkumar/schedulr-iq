import { useMemo, useState, type DragEvent } from 'react'
import { AlertTriangle } from 'lucide-react'
import type { Assignment, Course, Session, TimeConfig } from '../types'
import { catColor, isTeaching, slotLabel } from '../format'

export interface Lane { id: string; label: string }

interface Props {
  tc: TimeConfig
  assignments: Assignment[]
  sessions: Record<string, Session>
  courses: Record<string, Course>
  lanes: Lane[]
  laneKeys: (a: Assignment) => string[]
  days: number[]
  visible: (a: Assignment) => boolean
  conflicts: Set<string>
  ghosts?: Assignment[]
  moved?: Set<string>
  selected: string | null
  onSelect: (sid: string | null) => void
  onDropSession?: (sid: string, day: number, slot: number) => void
  rowH?: number
}

interface Placed { a: Assignment; lane0: number; lane1: number; sub: number; nsub: number; ghost?: boolean }

function runs(idx: number[]): [number, number][] {
  const s = [...new Set(idx)].sort((x, y) => x - y)
  const out: [number, number][] = []
  for (const i of s) {
    if (out.length && out[out.length - 1][1] === i - 1) out[out.length - 1][1] = i
    else out.push([i, i])
  }
  return out
}

export default function TimetableGrid(p: Props) {
  const { tc, lanes, days, sessions, courses } = p
  const rowH = p.rowH ?? (lanes.length > 1 ? 58 : 66)
  const nl = Math.max(1, lanes.length)
  const laneIndex = useMemo(() => Object.fromEntries(lanes.map((l, i) => [l.id, i])), [lanes])
  const [dragOver, setDragOver] = useState<{ day: number; slot: number } | null>(null)
  const [dragSid, setDragSid] = useState<string | null>(null)

  const placedByDay = useMemo(() => {
    const out: Record<number, Placed[]> = {}
    const place = (a: Assignment, ghost: boolean) => {
      const idx = p.laneKeys(a).map(k => laneIndex[k]).filter(i => i !== undefined) as number[]
      for (const [l0, l1] of runs(idx)) (out[a.day] ||= []).push({ a, lane0: l0, lane1: l1, sub: 0, nsub: 1, ghost })
    }
    p.assignments.filter(p.visible).forEach(a => place(a, false))
    ;(p.ghosts || []).filter(p.visible).forEach(a => place(a, true))
    for (const d of Object.keys(out)) {
      const items = out[+d].filter(x => !x.ghost)
      for (const it of items) {
        const dur = sessions[it.a.session_id]?.duration ?? 1
        const group = items.filter(o => {
          const od = sessions[o.a.session_id]?.duration ?? 1
          return o.lane0 <= it.lane1 && it.lane0 <= o.lane1 && o.a.start < it.a.start + dur && it.a.start < o.a.start + od
        }).sort((x, y) => x.a.session_id.localeCompare(y.a.session_id))
        it.nsub = group.length
        it.sub = group.indexOf(it)
      }
    }
    return out
  }, [p.assignments, p.ghosts, p.visible, p.laneKeys, laneIndex, sessions])

  const slots = Array.from({ length: tc.slots_per_day }, (_, i) => i)
  const colMin = nl > 1 ? nl * 64 : 168

  const onDrop = (e: DragEvent<HTMLDivElement>, day: number) => {
    e.preventDefault()
    const sid = e.dataTransfer.getData('text/session')
    setDragOver(null)
    setDragSid(null)
    if (!sid || !p.onDropSession) return
    const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect()
    const off = Number(e.dataTransfer.getData('text/offset') || 0)
    const slot = Math.max(0, Math.min(tc.slots_per_day - 1, Math.floor((e.clientY - rect.top) / rowH) - off))
    p.onDropSession(sid, day, slot)
  }

  return (
    <div className="scroll-thin overflow-x-auto border border-navy/15 bg-white">
      <div className="flex" style={{ minWidth: 56 + days.length * colMin }}>
        {/* time axis */}
        <div className="sticky left-0 z-10 w-14 shrink-0 border-r border-navy/10 bg-white">
          <div className={`border-b border-navy/15 ${nl > 1 ? 'h-[58px]' : 'h-10'}`} />
          {slots.map(s => (
            <div key={s} style={{ height: rowH }} className="relative border-b border-navy/[0.06] pr-1.5 text-right">
              <span className="font-mono text-2xs text-slate">{slotLabel(tc, s)}</span>
            </div>
          ))}
          <div className="pr-1.5 text-right font-mono text-2xs text-slate">{slotLabel(tc, tc.slots_per_day)}</div>
        </div>
        {days.map(d => (
          <div key={d} className="min-w-0 flex-1 border-r border-navy/10 last:border-r-0" style={{ minWidth: colMin }}>
            <div className={`sticky top-0 border-b border-navy/15 bg-white ${nl > 1 ? 'h-[58px]' : 'h-10'}`}>
              <div className="flex h-10 items-center justify-between px-2.5">
                <span className="font-display text-sm font-semibold">{tc.days[d]}</span>
                <span className="font-mono text-2xs text-slate">{(placedByDay[d] || []).filter(x => !x.ghost).length || ''}</span>
              </div>
              {nl > 1 && (
                <div className="flex h-[18px] border-t border-navy/[0.06]">
                  {lanes.map(l => (
                    <div key={l.id} className="flex-1 truncate border-r border-navy/[0.05] px-1 text-center font-mono text-[9px] uppercase tracking-wide text-slate last:border-r-0" title={l.label}>{l.id}</div>
                  ))}
                </div>
              )}
            </div>
            <div
              className="relative"
              style={{ height: rowH * tc.slots_per_day }}
              onDragOver={e => {
                if (!p.onDropSession) return
                e.preventDefault()
                const rect = e.currentTarget.getBoundingClientRect()
                setDragOver({ day: d, slot: Math.floor((e.clientY - rect.top) / rowH) })
              }}
              onDragLeave={() => setDragOver(null)}
              onDrop={e => onDrop(e, d)}
              onClick={e => { if (e.target === e.currentTarget) p.onSelect(null) }}
            >
              {slots.map(s => {
                const brk = tc.break_slots.includes(s)
                const closed = !brk && !isTeaching(tc, d, s)
                return (
                  <div key={s} style={{ top: s * rowH, height: rowH }}
                    className={`pointer-events-none absolute inset-x-0 border-b border-navy/[0.06] ${brk ? 'hatch-break' : closed ? 'hatch-closed' : ''}`}>
                    {brk && <span className="absolute left-2 top-1/2 -translate-y-1/2 font-mono text-[9px] uppercase tracking-[0.2em] text-slate">Break</span>}
                    {closed && s === (tc.day_slots[d] ?? 0) && <span className="absolute left-2 top-2 font-mono text-[9px] uppercase tracking-[0.2em] text-slate">Closed</span>}
                  </div>
                )
              })}
              {nl > 1 && lanes.slice(1).map((_, i) => (
                <div key={i} className="pointer-events-none absolute inset-y-0 border-l border-navy/[0.05]" style={{ left: `${((i + 1) / nl) * 100}%` }} />
              ))}
              {dragOver?.day === d && dragSid && (
                <div className="pointer-events-none absolute inset-x-0 border-2 border-dashed border-navy/50 bg-lime/20"
                  style={{ top: dragOver.slot * rowH, height: (sessions[dragSid]?.duration ?? 1) * rowH }} />
              )}
              {[...(placedByDay[d] || [])].sort((x, y) => Number(!x.ghost) - Number(!y.ghost)).map(it => {
                const s = sessions[it.a.session_id]
                const c = s && courses[s.course_id]
                if (!s || !c) return null
                const span = it.lane1 - it.lane0 + 1
                const left = ((it.lane0 + it.sub / it.nsub * span) / nl) * 100
                const width = (span / nl / it.nsub) * 100
                const col = catColor(c.category)
                const sel = p.selected === s.id
                const bad = p.conflicts.has(s.id)
                const moved = p.moved?.has(s.id)
                const compact = nl > 2 || width < 22
                const style = { top: it.a.start * rowH + 1, height: s.duration * rowH - 3, left: `calc(${left}% + 2px)`, width: `calc(${width}% - 4px)` }
                if (it.ghost) {
                  return (
                    <div key={`g-${s.id}-${it.lane0}`} style={style} className="pointer-events-none absolute border border-dashed border-navy/35 bg-ivory/40 px-1.5 py-1">
                      <span className="font-mono text-[9px] text-slate line-through">{c.code}</span>
                    </div>
                  )
                }
                return (
                  <button
                    key={`${s.id}-${it.lane0}`}
                    draggable={!!p.onDropSession}
                    onDragStart={e => {
                      e.dataTransfer.setData('text/session', s.id)
                      const rect = e.currentTarget.getBoundingClientRect()
                      e.dataTransfer.setData('text/offset', String(Math.floor((e.clientY - rect.top) / rowH)))
                      e.dataTransfer.effectAllowed = 'move'
                      setDragSid(s.id)
                    }}
                    onDragEnd={() => { setDragSid(null); setDragOver(null) }}
                    onClick={() => p.onSelect(sel ? null : s.id)}
                    style={{ ...style, borderLeftColor: bad ? '#D94B4B' : col, backgroundColor: sel ? '#D8FF66' : `${col}12` }}
                    className={`group absolute z-[1] overflow-hidden border-l-[3px] text-left transition-[box-shadow,transform] duration-150 hover:z-10 hover:shadow-[0_4px_14px_-6px_rgba(23,36,59,0.45)] focus-visible:z-10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-navy
                      ${c.course_type === 'tutorial' ? 'border border-dashed border-l-solid' : 'border border-transparent'}
                      ${sel ? '!z-10 !border-navy ring-1 ring-navy' : ''}
                      ${bad ? '!border-conflict ring-1 ring-conflict' : ''}`}
                    title={`${c.code} · ${c.name}\n${s.id} · ${it.a.room_id} · ${it.a.faculty_id}`}
                    aria-label={`${c.code} ${c.name}, ${tc.days[it.a.day]} ${slotLabel(tc, it.a.start)}, room ${it.a.room_id}`}
                  >
                    {c.course_type === 'lab' && <span className="hatch-lab pointer-events-none absolute inset-0" />}
                    <span className="relative flex h-full flex-col px-1.5 py-1">
                      <span className="flex items-center gap-1">
                        <span className={`font-mono font-medium leading-tight ${compact ? 'text-[10.5px]' : 'truncate text-[11px]'}`}>{c.code}</span>
                        {!compact && <span className="font-mono text-[9px] uppercase text-slate">{c.course_type === 'lecture' ? 'LEC' : c.course_type === 'lab' ? 'LAB' : 'TUT'}</span>}
                        {bad && <AlertTriangle className="ml-auto h-3 w-3 shrink-0 text-conflict" />}
                        {moved && !bad && <span className="ml-auto h-1.5 w-1.5 shrink-0 bg-navy" title="Moved vs baseline" />}
                      </span>
                      {!compact && <span className="truncate text-[11px] leading-tight text-navy/80">{c.name}</span>}
                      {compact ? (
                        <span className="mt-auto flex flex-col font-mono text-[9.5px] leading-tight text-slate-600">
                          <span>{slotLabel(tc, it.a.start)}</span><span className="truncate">{it.a.room_id}</span>
                        </span>
                      ) : (
                        <span className="mt-auto truncate font-mono text-[9.5px] leading-tight text-slate-600">
                          {`${slotLabel(tc, it.a.start)}–${slotLabel(tc, it.a.start + s.duration)} · ${it.a.room_id}`}
                        </span>
                      )}
                      {!compact && s.duration * rowH > 60 && <span className="truncate font-mono text-[9.5px] leading-tight text-slate">{s.batch_ids.join(' + ')}</span>}
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
