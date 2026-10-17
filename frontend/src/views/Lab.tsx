import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, Play, RotateCcw, Undo2, X, ArrowDownRight, ArrowUpRight, Minus, Terminal } from 'lucide-react'
import { api } from '../api'
import { useApp } from '../store'
import type { Metrics, OptimizeResult, ScheduleView, Weights } from '../types'
import { Page } from '../components/Shell'
import { Button, Chip, ErrorBox, Eyebrow, KindBadge, Mono, SectionHead } from '../components/ui'
import { OBJECTIVES, pct } from '../format'

const DEFAULT: Weights = { student_idle: 5, faculty_idle: 3, room_fit: 2, workload_balance: 3, preferences: 4 }
const PRESETS: { name: string; w: Weights }[] = [
  { name: 'Balanced', w: DEFAULT },
  { name: 'Student-first', w: { student_idle: 10, faculty_idle: 1, room_fit: 1, workload_balance: 4, preferences: 1 } },
  { name: 'Faculty-friendly', w: { student_idle: 2, faculty_idle: 8, room_fit: 1, workload_balance: 3, preferences: 10 } },
  { name: 'Space-efficient', w: { student_idle: 1, faculty_idle: 1, room_fit: 10, workload_balance: 1, preferences: 1 } },
]
const KEYS = OBJECTIVES.map(o => o.key)

export function scoreOf(terms: Record<string, number>, w: Weights, baseTerms: Record<string, number>) {
  const total = KEYS.reduce((s, k) => s + w[k], 0)
  if (total <= 0) return NaN
  return KEYS.reduce((s, k) => s + (w[k] / total) * (terms[k] / Math.max(1, baseTerms[k] ?? 0)), 0)
}

interface Row { label: string; dir: 'min' | 'max'; get: (v: ScheduleView) => number; fmt: (n: number) => string; unit?: string; note?: string }
const ROWS: Row[] = [
  { label: 'Hard-constraint violations', dir: 'min', get: v => v.validation.hard_count, fmt: n => String(n) },
  { label: 'Unscheduled sessions', dir: 'min', get: v => v.metrics.unscheduled_sessions, fmt: n => String(n) },
  { label: 'Student idle time', dir: 'min', get: v => v.metrics.student_idle_minutes, fmt: n => `${n}`, unit: 'min/wk' },
  { label: 'Faculty idle time', dir: 'min', get: v => v.metrics.faculty_idle_minutes, fmt: n => `${n}`, unit: 'min/wk' },
  { label: 'Seat utilization', dir: 'max', get: v => v.metrics.seat_utilization, fmt: n => pct(n), note: 'enrolled seat-hours ÷ capacity seat-hours' },
  { label: 'Wasted seat-hours', dir: 'min', get: v => v.metrics.wasted_seat_hours, fmt: n => n.toFixed(0), unit: 'seat·h' },
  { label: 'Room-time utilization', dir: 'max', get: v => v.metrics.room_time_utilization, fmt: n => pct(n), note: 'occupied ÷ available room-time; fixed when every session is placed' },
  { label: 'Workload imbalance', dir: 'min', get: v => v.metrics.workload_imbalance_hours, fmt: n => n.toFixed(0), unit: 'h' },
  { label: 'Preference satisfaction', dir: 'max', get: v => v.metrics.preference_satisfaction, fmt: n => pct(n) },
]

function Delta({ a, b, dir, fmt }: { a: number; b: number; dir: 'min' | 'max'; fmt: (n: number) => string }) {
  const d = b - a
  if (Math.abs(d) < 1e-9) return <span className="inline-flex items-center gap-1 font-mono text-xs text-slate"><Minus className="h-3 w-3" />same</span>
  const better = dir === 'min' ? d < 0 : d > 0
  const Icon = d < 0 ? ArrowDownRight : ArrowUpRight
  const raw = fmt(Math.abs(d)).replace('-', '')
  const mag = raw.endsWith('%') ? `${raw.slice(0, -1)} pts` : raw
  return better
    ? <span className="inline-flex items-center gap-1 bg-lime px-1.5 font-mono text-xs text-navy ring-1 ring-navy/50"><Icon className="h-3 w-3" />{mag} better</span>
    : <span className="inline-flex items-center gap-1 border border-slate-300 px-1.5 font-mono text-xs text-slate-600"><Icon className="h-3 w-3" />{mag} worse</span>
}

export default function Lab() {
  const { active, baseline, list, activate, adopt, toast, errMsg, focus, data, canRun } = useApp()
  const [w, setW] = useState<Weights>(active?.record.weights || DEFAULT)
  const [limit, setLimit] = useState((data?.sessions.length ?? 0) > 120 ? 20 : 10)
  const [running, setRunning] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const [res, setRes] = useState<OptimizeResult | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [kindFilter, setKindFilter] = useState<string>('')
  const timer = useRef<number | undefined>(undefined)

  useEffect(() => () => window.clearInterval(timer.current), [])

  const total = KEYS.reduce((s, k) => s + w[k], 0)
  const invalid = total <= 0

  const run = async () => {
    setRunning(true)
    setErr(null)
    setElapsed(0)
    const t0 = performance.now()
    timer.current = window.setInterval(() => setElapsed((performance.now() - t0) / 1000), 100)
    try {
      const r = await api.optimize(w, limit, baseline?.record.id)
      setRes(r)
      if (r.status === 'ok' && r.schedule) {
        await adopt(r.schedule)
        toast({ tone: 'ok', title: `${r.schedule.record.id} · ${r.schedule.record.solver.status === 'optimal' ? 'proven optimal' : 'best found within limit'}`, body: r.note })
      } else {
        setErr(r.message || `Optimizer returned ${r.status}`)
      }
    } catch (e) {
      setErr(errMsg(e))
    } finally {
      window.clearInterval(timer.current)
      setRunning(false)
    }
  }

  // The comparison always contrasts the baseline with the currently viewed schedule.
  const after = active
  const before = baseline
  const baseTerms = before?.metrics.terms ?? {}
  const runWeights = after?.record.weights || w
  const scoreBefore = before ? scoreOf(before.metrics.terms, runWeights, baseTerms) : NaN
  const scoreAfter = after ? scoreOf(after.metrics.terms, runWeights, baseTerms) : NaN
  const solver = after?.record.solver || {}
  const changes = after?.record.changes || []
  const shownChanges = kindFilter ? changes.filter(c => c.kind.includes(kindFilter)) : changes
  const runs = useMemo(() => list.filter(s => s.kind !== 'diagnostic'), [list])

  if (!data) return null

  return (
    <Page title="Optimization Lab" eyebrow="03 · CP-SAT optimizer · hard constraints are never traded for score">
      <div className="grid gap-8 xl:grid-cols-[360px_1fr]">
        {/* ---------- controls ---------- */}
        <div className="space-y-8">
          <section>
            <SectionHead index="A" title="Objective weights" sub="0–10 each. Normalized to sum to 1; every term is divided by its baseline value so weights express relative importance." />
            <div className="mb-3 flex flex-wrap gap-1.5">
              {PRESETS.map(p => {
                const on = KEYS.every(k => p.w[k] === w[k])
                return <button key={p.name} onClick={() => setW(p.w)} className={`h-7 border px-2.5 font-mono text-2xs uppercase tracking-wider ${on ? 'border-navy bg-navy text-lime' : 'border-slate-200 bg-white hover:border-navy/40'}`}>{p.name}</button>
              })}
            </div>
            <div className="space-y-4">
              {OBJECTIVES.map(o => (
                <div key={o.key}>
                  <div className="flex items-baseline justify-between gap-2">
                    <label htmlFor={`w-${o.key}`} className="text-[13px] font-medium">{o.label}</label>
                    <span className="font-mono text-xs"><span className="text-navy">{w[o.key]}</span><span className="text-slate"> · {invalid ? '—' : pct(w[o.key] / total, 0)}</span></span>
                  </div>
                  <input id={`w-${o.key}`} type="range" min={0} max={10} step={1} value={w[o.key]}
                    onChange={e => setW({ ...w, [o.key]: Number(e.target.value) })}
                    className="mt-1 w-full accent-navy" />
                  <p className="text-2xs leading-snug text-slate">{o.def}</p>
                </div>
              ))}
            </div>
            {invalid && <div className="mt-3"><ErrorBox title="Invalid weights">At least one objective weight must be above zero.</ErrorBox></div>}
            <div className="mt-5 flex items-end gap-3">
              <label className="flex flex-col gap-0.5">
                <span className="font-mono text-2xs uppercase tracking-wider text-slate">Time limit (s)</span>
                <input type="number" min={1} max={60} value={limit} onChange={e => setLimit(Math.max(1, Math.min(60, Number(e.target.value) || 1)))}
                  className="h-9 w-20 border border-slate-200 bg-white px-2 font-mono text-sm focus:border-navy focus:outline-none" />
              </label>
              <Button tone="accent" className="h-9 flex-1" onClick={run} loading={running} disabled={invalid || !baseline || !canRun}>
                {!running && <Play className="h-4 w-4" />} Optimize timetable
              </Button>
            </div>
            {!baseline && <p className="mt-2 text-xs text-conflict">No baseline exists. Generate one in Data Setup.</p>}
          </section>

          <section>
            <SectionHead index="B" title="Hard constraints" sub="Enforced as constraints in CP-SAT and re-checked by an independent validator." />
            <ul className="grid grid-cols-1 gap-y-1 text-xs">
              {(active?.validation.checks || []).map(c => (
                <li key={c.code} className="flex items-center gap-2">
                  {c.passed ? <Check className="h-3.5 w-3.5 shrink-0 text-navy" strokeWidth={2.5} /> : <X className="h-3.5 w-3.5 shrink-0 text-conflict" strokeWidth={2.5} />}
                  <span className={c.passed ? '' : 'text-conflict'}>{c.label}</span>
                  {!c.passed && <Mono className="ml-auto text-conflict">{c.violations}</Mono>}
                </li>
              ))}
            </ul>
          </section>
        </div>

        {/* ---------- results ---------- */}
        <div className="min-w-0 space-y-8">
          <section>
            <SectionHead index="C" title="Run status" aside={after && <div className="flex items-center gap-2"><Mono className="text-xs">{after.record.id}</Mono><KindBadge kind={after.record.kind} /></div>} />
            {running ? (
              <div className="border border-navy/15 bg-white p-4">
                <div className="flex items-center justify-between font-mono text-xs">
                  <span>CP-SAT solving · 8 workers · warm-started from {baseline?.record.id}</span>
                  <span>{elapsed.toFixed(1)}s / {limit}s limit</span>
                </div>
                <div className="relative mt-3 h-1.5 overflow-hidden bg-ivory-300">
                  <div className="indeterminate absolute inset-y-0 w-2/5 bg-lime ring-1 ring-navy/40" />
                </div>
                <p className="mt-2 text-xs text-slate">The result will be re-validated independently before it is stored.</p>
              </div>
            ) : err ? (
              <ErrorBox title={res?.status === 'infeasible' ? 'No feasible solution under the current constraints' : 'Optimization failed'}>
                <p>{err}</p>
                {res?.diagnostics?.length ? <ul className="mt-2 list-disc pl-4 text-xs">{res.diagnostics.map((d, i) => <li key={i}>{d}</li>)}</ul> : null}
                <p className="mt-2 text-xs">Nothing was published or replaced.</p>
              </ErrorBox>
            ) : after && after.record.kind !== 'baseline' ? (
              <div className="grid grid-cols-2 gap-px border border-navy/15 bg-navy/10 sm:grid-cols-4">
                {[
                  ['Status', solver.status === 'optimal' ? 'OPTIMAL (proven)' : solver.status === 'feasible' ? 'FEASIBLE (limit)' : String(solver.status || '—').toUpperCase()],
                  ['Wall time', solver.wall_seconds != null ? `${solver.wall_seconds}s` : '—'],
                  ['Model', solver.variables ? `${solver.variables.toLocaleString()} vars` : '—'],
                  ['Constraints', solver.constraints ? solver.constraints.toLocaleString() : '—'],
                ].map(([k, v]) => (
                  <div key={k} className="bg-white px-3 py-2.5">
                    <Eyebrow>{k}</Eyebrow>
                    <div className={`mt-0.5 font-mono text-sm ${k === 'Status' && solver.status === 'optimal' ? 'inline-block bg-lime px-1' : ''}`}>{v}</div>
                  </div>
                ))}
                <div className="col-span-2 bg-white px-3 py-2.5 text-xs leading-relaxed sm:col-span-4">
                  {solver.message || solver.method}
                  {res?.note && after.record.id === res.schedule?.record.id && <div className="mt-1 font-medium">{res.note}</div>}
                </div>
              </div>
            ) : (
              <div className="border border-dashed border-slate-300 bg-white/60 p-5 text-sm text-slate">
                Viewing the baseline ({after?.record.solver.method || 'first-fit'}). Run the optimizer to produce a comparison — the result is stored as a new schedule, the baseline is kept.
              </div>
            )}
          </section>

          {before && after && (
            <section>
              <SectionHead index="D" title="Baseline vs current" sub={`${before.record.id} → ${after.record.id}. Arrows show direction; “better” respects whether a metric is minimized or maximized.`} />
              <div className="overflow-x-auto border border-navy/15 bg-white">
                <table className="w-full min-w-[620px] text-sm">
                  <thead>
                    <tr className="border-b border-navy/15 text-left">
                      <th className="px-3 py-2 font-mono text-2xs font-normal uppercase tracking-wider text-slate">Metric</th>
                      <th className="px-3 py-2 font-mono text-2xs font-normal uppercase tracking-wider text-slate">Goal</th>
                      <th className="px-3 py-2 text-right font-mono text-2xs font-normal uppercase tracking-wider text-slate">Baseline</th>
                      <th className="px-3 py-2 text-right font-mono text-2xs font-normal uppercase tracking-wider text-slate">{after.record.id === before.record.id ? 'Current' : after.record.label}</th>
                      <th className="px-3 py-2 font-mono text-2xs font-normal uppercase tracking-wider text-slate">Δ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ROWS.map(r => (
                      <tr key={r.label} className="border-b border-navy/[0.06]">
                        <td className="px-3 py-2">
                          {r.label}{r.unit && <span className="ml-1 font-mono text-2xs text-slate">{r.unit}</span>}
                          {r.note && <div className="text-2xs text-slate">{r.note}</div>}
                        </td>
                        <td className="px-3 py-2 font-mono text-2xs uppercase text-slate">{r.dir === 'min' ? '↓ minimize' : '↑ maximize'}</td>
                        <td className="px-3 py-2 text-right font-mono">{r.fmt(r.get(before))}</td>
                        <td className="px-3 py-2 text-right font-mono font-medium">{r.fmt(r.get(after))}</td>
                        <td className="px-3 py-2"><Delta a={r.get(before)} b={r.get(after)} dir={r.dir} fmt={r.fmt} /></td>
                      </tr>
                    ))}
                    <tr className="bg-ivory/60">
                      <td className="px-3 py-2.5">
                        <span className="font-medium">Weighted soft score</span>
                        <div className="text-2xs text-slate">Σ ŵₖ · termₖ / baselineₖ under the run’s weights. Baseline = 1.000 by construction. Not a % of optimality.</div>
                      </td>
                      <td className="px-3 py-2 font-mono text-2xs uppercase text-slate">↓ minimize</td>
                      <td className="px-3 py-2 text-right font-mono">{isNaN(scoreBefore) ? '—' : scoreBefore.toFixed(3)}</td>
                      <td className="px-3 py-2 text-right font-mono font-semibold">{isNaN(scoreAfter) ? '—' : scoreAfter.toFixed(3)}</td>
                      <td className="px-3 py-2">{!isNaN(scoreBefore) && <Delta a={scoreBefore} b={scoreAfter} dir="min" fmt={n => n.toFixed(3)} />}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <TermBreakdown before={before.metrics} after={after.metrics} w={runWeights} />
            </section>
          )}

          {changes.length > 0 && (
            <section>
              <SectionHead index="E" title={`Change log · ${changes.length} sessions changed`}
                sub="Generated by diffing the two schedules and measuring each move’s effect. Effects are observed, not guessed solver intent."
                aside={
                  <div className="flex gap-1">
                    {['', 'time', 'room', 'faculty'].map(k => (
                      <button key={k} onClick={() => setKindFilter(k)} className={`h-6 border px-2 font-mono text-2xs uppercase ${kindFilter === k ? 'border-navy bg-navy text-lime' : 'border-slate-200 bg-white'}`}>
                        {k || 'all'} {k ? changes.filter(c => c.kind.includes(k)).length : ''}
                      </button>
                    ))}
                  </div>
                } />
              <div className="scroll-thin max-h-[440px] divide-y divide-navy/[0.06] overflow-y-auto border border-navy/15 bg-white">
                {shownChanges.map(ch => (
                  <button key={ch.session_id} onClick={() => focus(ch.session_id)} className="block w-full px-3 py-2.5 text-left hover:bg-ivory/70">
                    <div className="flex items-center gap-2">
                      {ch.kind.map(k => <Chip key={k} tone="muted">{k}</Chip>)}
                      <span className="text-[13px] font-medium">{ch.headline}</span>
                    </div>
                    <ul className="mt-1 space-y-0.5 pl-1 text-xs text-slate-600">
                      {ch.effects.map((e, i) => <li key={i}>— {e}</li>)}
                    </ul>
                  </button>
                ))}
              </div>
            </section>
          )}

          {solver.log && (
            <section>
              <SectionHead index="F" title="Solver log" />
              <pre className="scroll-thin overflow-x-auto bg-navy p-3 font-mono text-[11px] leading-relaxed text-ivory/85">
                <Terminal className="mb-1 h-3.5 w-3.5 text-lime" />
                {(solver.log as string[]).map((l, i) => <div key={i}><span className="text-lime/70">›</span> {l}</div>)}
              </pre>
            </section>
          )}

          <section>
            <SectionHead index="G" title="Schedule history" sub="Every run is kept. Switching never deletes anything." aside={
              <div className="flex gap-2">
                {after?.record.parent_id && <Button size="sm" onClick={() => activate(after.record.parent_id!)}><Undo2 className="h-3.5 w-3.5" /> Previous</Button>}
                {baseline && after?.record.id !== baseline.record.id && <Button size="sm" onClick={() => activate(baseline.record.id)}><RotateCcw className="h-3.5 w-3.5" /> Restore baseline</Button>}
              </div>
            } />
            <div className="divide-y divide-navy/[0.06] border border-navy/15 bg-white">
              {runs.map(s => (
                <div key={s.id} className={`flex flex-wrap items-center gap-3 px-3 py-2 text-sm ${s.id === after?.record.id ? 'bg-lime-50' : ''}`}>
                  <Mono className="w-20 text-xs">{s.id}</Mono>
                  <KindBadge kind={s.kind} />
                  <span className="min-w-0 flex-1 truncate">{s.label}</span>
                  {s.hard_count > 0 && <Chip tone="red">{s.hard_count} hard</Chip>}
                  {s.published && <Chip tone="navy">published</Chip>}
                  <Mono className="text-2xs text-slate">{new Date(s.created_at).toLocaleTimeString()}</Mono>
                  {s.id === after?.record.id ? <Mono className="text-2xs">viewing</Mono> : <Button size="sm" tone="ghost" onClick={() => activate(s.id)}>View</Button>}
                </div>
              ))}
            </div>
          </section>
        </div>
      </div>
    </Page>
  )
}

function TermBreakdown({ before, after, w }: { before: Metrics; after: Metrics; w: Weights }) {
  const total = KEYS.reduce((s, k) => s + w[k], 0) || 1
  return (
    <div className="mt-4 grid gap-px border border-navy/15 bg-navy/10 sm:grid-cols-5">
      {OBJECTIVES.map(o => {
        const ref = Math.max(1, before.terms[o.key] ?? 0)
        const b = (before.terms[o.key] ?? 0) / ref
        const a = (after.terms[o.key] ?? 0) / ref
        return (
          <div key={o.key} className="bg-white px-3 py-2.5">
            <div className="truncate text-2xs text-slate">{o.label}</div>
            <div className="mt-1 flex items-baseline gap-1.5 font-mono text-xs">
              <span className="text-slate">{(b * 100).toFixed(0)}</span><span className="text-slate">→</span><span className="font-medium">{(a * 100).toFixed(0)}</span>
              <span className="text-2xs text-slate">% of base</span>
            </div>
            <div className="mt-1.5 h-1.5 bg-ivory-300"><div className="h-full bg-navy" style={{ width: `${Math.min(100, a * 100)}%` }} /></div>
            <div className="mt-1 font-mono text-2xs text-slate">weight {pct(w[o.key] / total, 0)}</div>
          </div>
        )
      })}
    </div>
  )
}
