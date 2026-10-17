import { useEffect, useRef, useState } from 'react'
import { Check, X, MousePointerClick, ArrowRight } from 'lucide-react'
import { api } from '../api'
import { useApp } from '../store'
import type { Change, SessionExplanation, Violation } from '../types'
import { catColor, slotLabel, whereLabel } from '../format'
import { Button, Chip, Eyebrow, Mono, Spinner, ErrorBox } from './ui'

export interface MoveVerdict { sid: string; day: number; start: number; room?: string; valid: boolean; introduced: Violation[] }

interface Props {
  sid: string
  onClose: () => void
  onTryMove: (sid: string, day: number, start: number, room?: string) => void
  verdict: MoveVerdict | null
  onForce: () => void
  onDismissVerdict: () => void
  busy: boolean
}

export default function Inspector({ sid, onClose, onTryMove, verdict, onForce, onDismissVerdict, busy }: Props) {
  const { active, data, L, baseline, errMsg } = useApp()
  const [ex, setEx] = useState<SessionExplanation | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [hover, setHover] = useState<string | null>(null)
  const id = active?.record.id
  const scroller = useRef<HTMLDivElement>(null)
  useEffect(() => { if (verdict) scroller.current?.scrollTo({ top: 0, behavior: 'smooth' }) }, [verdict])

  useEffect(() => {
    if (!id) return
    let live = true
    setEx(null)
    setErr(null)
    api.explain(id, sid).then(r => live && setEx(r)).catch(e => live && setErr(errMsg(e)))
    return () => { live = false }
  }, [id, sid, active?.record.assignments.length]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!data || !active) return null
  const tc = data.dataset.time
  const s = L.sessions[sid]
  const c = s && L.courses[s.course_id]
  if (!s || !c) return null
  const a = ex?.assignment
  const vsBase: Change | undefined = active.record.id !== baseline?.record.id
    ? diffOne(baseline?.record.assignments.find(x => x.session_id === sid), active.record.assignments.find(x => x.session_id === sid))
    : undefined
  const ownChange = active.record.changes.find(ch => ch.session_id === sid)
  const conflicts = active.validation.violations.filter(v => v.severity === 'hard' && v.session_ids.includes(sid))
  const soft = active.validation.violations.filter(v => v.severity === 'soft' && v.session_ids.includes(sid))

  return (
    <aside className="fade-up flex h-full flex-col border-l border-navy/15 bg-white">
      <div className="flex items-start justify-between gap-3 border-b border-navy/10 px-4 py-3" style={{ boxShadow: `inset 3px 0 0 ${catColor(c.category)}` }}>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Mono className="text-sm font-medium">{c.code}</Mono>
            <Chip tone="muted">{c.course_type}</Chip>
            <Mono className="text-2xs text-slate">{sid}</Mono>
          </div>
          <div className="mt-0.5 truncate font-display text-lg font-semibold leading-tight">{c.name}</div>
        </div>
        <button onClick={onClose} className="text-slate hover:text-navy" aria-label="Close inspector"><X className="h-4 w-4" /></button>
      </div>

      <div ref={scroller} className="scroll-thin flex-1 space-y-5 overflow-y-auto px-4 py-4 text-sm">
        {verdict && verdict.sid === sid && (
          <div className={`border px-3 py-2.5 ${verdict.valid ? 'border-navy bg-lime-50' : 'border-conflict/50 bg-conflict-50'}`}>
            <div className="text-xs font-semibold">
              {verdict.valid ? 'Move is valid' : 'Move rejected by the validator'} · <Mono>{whereLabel(tc, verdict.day, verdict.start, s.duration)}</Mono>
            </div>
            {!verdict.valid && (
              <>
                <ul className="mt-1.5 space-y-1 text-xs">
                  {verdict.introduced.map((v, i) => <li key={i} className="flex gap-1.5"><span className="font-mono text-2xs text-conflict">{v.code}</span><span>{v.message}</span></li>)}
                </ul>
                <div className="mt-2 flex gap-2">
                  <Button size="sm" tone="primary" onClick={onDismissVerdict}>Keep current slot</Button>
                  <Button size="sm" tone="danger" onClick={onForce} title="Creates an invalid draft copy that cannot be published">Save as invalid draft</Button>
                </div>
              </>
            )}
          </div>
        )}

        {conflicts.length > 0 && (
          <div className="space-y-1.5">
            {conflicts.map((v, i) => <ErrorBox key={i} title={v.code.replace(/_/g, ' ')}>{v.message}</ErrorBox>)}
          </div>
        )}

        <section>
          <Eyebrow>Assigned</Eyebrow>
          {a ? (
            <dl className="mt-2 grid grid-cols-[88px_1fr] gap-y-1.5 text-[13px]">
              <dt className="text-slate">When</dt><dd><Mono>{whereLabel(tc, a.day, a.start, s.duration)}</Mono></dd>
              <dt className="text-slate">Room</dt><dd><Mono>{a.room_id}</Mono> <span className="text-slate">· {L.rooms[a.room_id]?.name} · {L.rooms[a.room_id]?.capacity} seats</span></dd>
              <dt className="text-slate">Faculty</dt><dd>{L.faculty[a.faculty_id]?.name} <Mono className="text-slate">{a.faculty_id}</Mono></dd>
              <dt className="text-slate">Batches</dt><dd><Mono>{s.batch_ids.join(' + ')}</Mono> <span className="text-slate">· {s.enrollment} students</span></dd>
            </dl>
          ) : ex ? <div className="mt-2 text-conflict">Not scheduled in {active.record.id}.</div> : null}
        </section>

        {err && <ErrorBox title="Could not load explanation">{err}</ErrorBox>}
        {!ex && !err && <Spinner label="Analysing every alternative slot…" />}

        {ex && (
          <>
            {ex.checks.length > 0 && (
              <section>
                <Eyebrow>Hard constraints for this session</Eyebrow>
                <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1">
                  {ex.checks.map(ch => (
                    <div key={ch.code} className="flex items-center gap-1.5 text-xs" title={ch.detail || ''}>
                      {ch.passed ? <Check className="h-3.5 w-3.5 text-navy" strokeWidth={2.5} /> : <X className="h-3.5 w-3.5 text-conflict" strokeWidth={2.5} />}
                      <span className={ch.passed ? '' : 'text-conflict'}>{ch.label}</span>
                    </div>
                  ))}
                </div>
                {ex.preference && <div className={`mt-2 text-xs ${soft.length ? 'text-slate-600' : 'text-slate'}`}>Soft · {ex.preference}</div>}
              </section>
            )}

            <section>
              <Eyebrow>Why this slot</Eyebrow>
              <ul className="mt-2 space-y-1.5 text-[13px] leading-snug">
                {ex.summary.map((t, i) => <li key={i} className="flex gap-2"><span className="mt-[7px] h-1 w-1 shrink-0 bg-navy" />{t}</li>)}
              </ul>
            </section>

            <section>
              <div className="flex items-center justify-between">
                <Eyebrow>Slot map · click to move</Eyebrow>
                <MousePointerClick className="h-3.5 w-3.5 text-slate" />
              </div>
              <SlotMap ex={ex} tc={tc} busy={busy} onPick={(d, t, r) => onTryMove(sid, d, t, r)} onHover={setHover} />
              <div className="mt-1.5 h-4 truncate font-mono text-2xs text-slate">{hover || 'Hover a cell for its reason.'}</div>
              <div className="mt-1 flex flex-wrap gap-3 font-mono text-2xs text-slate">
                <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 bg-navy" />current</span>
                <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 border border-navy/60 bg-lime" />feasible · better</span>
                <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 border border-navy/30 bg-lime-50" />feasible</span>
                <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 bg-ivory-300" />blocked</span>
              </div>
            </section>

            {(vsBase || ownChange) && (
              <section>
                <Eyebrow>Change log</Eyebrow>
                {[ownChange, vsBase && (!ownChange || ownChange.headline !== vsBase.headline) ? vsBase : undefined].filter(Boolean).map((ch, i) => (
                  <div key={i} className="mt-2 border-l-2 border-lime pl-2.5">
                    <div className="text-[13px] font-medium">{ch!.headline}</div>
                    <ul className="mt-1 space-y-0.5 text-xs text-slate-600">{ch!.effects.map((e, j) => <li key={j}>{e}</li>)}</ul>
                  </div>
                ))}
              </section>
            )}

            <section>
              <Eyebrow>Rooms</Eyebrow>
              <div className="mt-2 divide-y divide-navy/[0.06] border-y border-navy/[0.06]">
                {ex.rooms.map(r => (
                  <div key={r.room_id} className="flex items-center gap-2 py-1 text-xs">
                    {r.suitable ? <Check className="h-3.5 w-3.5 text-navy" /> : <X className="h-3.5 w-3.5 text-slate-300" />}
                    <Mono className={`w-16 ${a?.room_id === r.room_id ? 'bg-lime px-0.5' : ''}`}>{r.room_id}</Mono>
                    <span className={r.suitable ? 'text-navy' : 'text-slate'}>{r.reasons.join(', ')}</span>
                  </div>
                ))}
              </div>
            </section>

            <section>
              <Eyebrow>Requirements</Eyebrow>
              <ul className="mt-2 space-y-1 text-xs text-navy/80">{ex.requirements.map((r, i) => <li key={i}>{r}</li>)}</ul>
            </section>
          </>
        )}
      </div>
    </aside>
  )

  function diffOne(b?: { day: number; start: number; room_id: string; faculty_id: string }, n?: { day: number; start: number; room_id: string; faculty_id: string }): Change | undefined {
    if (!b || !n || !s) return undefined
    if (b.day === n.day && b.start === n.start && b.room_id === n.room_id && b.faculty_id === n.faculty_id) return undefined
    const eff: string[] = []
    if (b.day !== n.day || b.start !== n.start) eff.push(`Time ${whereLabel(tc, b.day, b.start, s.duration)} → ${whereLabel(tc, n.day, n.start, s.duration)}`)
    if (b.room_id !== n.room_id) eff.push(`Room ${b.room_id} (${L.rooms[b.room_id]?.capacity}) → ${n.room_id} (${L.rooms[n.room_id]?.capacity}) for ${s.enrollment} students`)
    if (b.faculty_id !== n.faculty_id) eff.push(`Faculty ${L.faculty[b.faculty_id]?.name} → ${L.faculty[n.faculty_id]?.name}`)
    return { session_id: sid, course_code: c!.code, kind: [], headline: `Versus baseline ${baseline?.record.id}`, effects: eff, before: null, after: null }
  }
}

function SlotMap({ ex, tc, onPick, onHover, busy }: { ex: SessionExplanation; tc: any; onPick: (d: number, t: number, room?: string) => void; onHover: (s: string | null) => void; busy: boolean }) {
  const cell = (d: number, t: number) => ex.slots.find(x => x.day === d && x.start === t)
  return (
    <div className="mt-2 overflow-x-auto">
      <table className="w-full border-collapse">
        <thead>
          <tr>
            <th className="w-10" />
            {tc.days.map((d: string) => <th key={d} className="pb-1 font-mono text-[9px] font-normal uppercase text-slate">{d}</th>)}
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: tc.slots_per_day }, (_, t) => (
            <tr key={t}>
              <td className="pr-1 text-right font-mono text-[9px] text-slate">{slotLabel(tc, t)}</td>
              {tc.days.map((_: string, d: number) => {
                const c = cell(d, t)
                const invalid = !c || c.reason === 'INVALID_TIME'
                const better = c?.status === 'feasible' && (c.score_delta ?? 0) < -1e-9
                const cls = c?.status === 'current' ? 'bg-navy'
                  : c?.status === 'feasible' ? (better ? 'bg-lime border-navy/60 hover:bg-lime-600' : 'bg-lime-50 border-navy/25 hover:bg-lime')
                    : invalid ? 'bg-transparent hatch-break' : 'bg-ivory-300 hover:bg-slate-200'
                const tip = !c ? '' : c.status === 'current' ? `Current · ${c.room_id}`
                  : c.status === 'feasible' ? `${tc.days[d]} ${slotLabel(tc, t)} · feasible in ${c.room_id} · soft score ${(c.score_delta ?? 0) >= 0 ? '+' : ''}${(c.score_delta ?? 0).toFixed(3)}`
                    : `${tc.days[d]} ${slotLabel(tc, t)} · ${c.reason_label}`
                return (
                  <td key={d} className="p-[1.5px]">
                    <button
                      disabled={invalid || c?.status === 'current' || busy}
                      onMouseEnter={() => onHover(tip)}
                      onMouseLeave={() => onHover(null)}
                      onFocus={() => onHover(tip)}
                      onClick={() => c && onPick(d, t, c.room_id || undefined)}
                      aria-label={tip}
                      className={`block h-[18px] w-full border border-transparent transition-colors disabled:cursor-default ${cls}`}
                    />
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="mt-1 flex items-center gap-1 text-2xs text-slate"><ArrowRight className="h-3 w-3" /> Blocked cells can be tried too — the validator will explain the rejection.</div>
    </div>
  )
}
