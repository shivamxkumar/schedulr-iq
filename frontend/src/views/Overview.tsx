import { ArrowRight, CheckCircle2, AlertTriangle, CircleDashed } from 'lucide-react'
import { Bar as RBar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis, Cell, ReferenceDot } from 'recharts'
import { useApp } from '../store'
import { Page } from '../components/Shell'
import { Bar, Button, Eyebrow, KindBadge, Mono, SectionHead } from '../components/ui'
import { pct } from '../format'
import type { ScheduleView } from '../types'

function Kpi({ label, value, sub, base, dir, tone }: { label: string; value: string; sub?: string; base?: string; dir?: string; tone?: 'red' | 'lime' }) {
  return (
    <div className="bg-white px-4 py-3">
      <Eyebrow>{label}</Eyebrow>
      <div className={`mt-1 font-display text-[26px] font-semibold leading-none tracking-tight tabular-nums ${tone === 'red' ? 'text-conflict' : ''}`}>
        {tone === 'lime' ? <span className="bg-lime px-1">{value}</span> : value}
      </div>
      <div className="mt-1.5 flex items-center gap-1.5 font-mono text-2xs text-slate">
        {dir && <span>{dir}</span>}{base && <span>· base {base}</span>}{sub && <span>{sub}</span>}
      </div>
    </div>
  )
}

function Verdict({ v }: { v: ScheduleView }) {
  const ok = v.validation.feasible && v.validation.complete
  const ready = v.publishable
  return (
    <div className={`flex flex-col gap-4 border-l-4 bg-white p-5 md:flex-row md:items-center ${ok ? 'border-lime' : 'border-conflict'}`} style={{ boxShadow: 'inset 0 0 0 1px rgba(23,36,59,0.12)' }}>
      <div className="flex-1">
        <Eyebrow>Is this timetable feasible, efficient and ready to publish?</Eyebrow>
        <div className="mt-2 flex flex-wrap items-center gap-x-6 gap-y-2 font-display text-xl font-semibold">
          <span className="flex items-center gap-2">{ok ? <CheckCircle2 className="h-5 w-5" /> : <AlertTriangle className="h-5 w-5 text-conflict" />}
            {ok ? 'Feasible' : `${v.validation.hard_count} hard violations`}</span>
          <span className="flex items-center gap-2 text-navy/80">{v.record.kind === 'optimized' ? <CheckCircle2 className="h-5 w-5" /> : <CircleDashed className="h-5 w-5 text-slate" />}
            {v.record.kind === 'optimized' ? `Optimized · ${v.record.solver.status === 'optimal' ? 'proven optimal' : 'best found'}` : 'Not optimized yet'}</span>
          <span className="flex items-center gap-2 text-navy/80">{v.record.published ? <CheckCircle2 className="h-5 w-5" /> : <CircleDashed className="h-5 w-5 text-slate" />}
            {v.record.published ? 'Published' : ready ? 'Ready to publish' : 'Not publishable'}</span>
        </div>
        <p className="mt-2 text-xs text-slate">
          Verdict from the independent validator: {v.validation.checks.filter(c => c.passed).length}/{v.validation.checks.length} hard checks pass ·
          {' '}{v.validation.scheduled}/{v.validation.required} required sessions scheduled · {v.validation.soft_count} soft preference misses.
        </p>
      </div>
    </div>
  )
}

export default function Overview() {
  const { data, active, baseline, setView, list } = useApp()
  if (!data || !active) return null
  const ds = data.dataset
  const m = active.metrics
  const bm = baseline && baseline.record.id !== active.record.id ? baseline.metrics : null
  const facultyData = m.faculty.map(f => ({ id: f.id, name: f.name, load: f.weekly_slots, max: ds.faculty.find(x => x.id === f.id)?.max_weekly_slots ?? 0 }))
  const lastRun = [...list].reverse().find(s => s.kind === 'optimized')
  const classes = m.classes ?? m.batches
  const maxDaily = Math.max(1, ...classes.flatMap(b => b.daily_slots))

  return (
    <Page title="Operations overview" eyebrow={`01 · ${active.record.id} · ${active.record.label}`}
      actions={<>
        <Button onClick={() => setView('studio')}>Timetable <ArrowRight className="h-4 w-4" /></Button>
        <Button tone="accent" onClick={() => setView('lab')}>Optimization Lab <ArrowRight className="h-4 w-4" /></Button>
      </>}>
      <Verdict v={active} />

      <div className="mt-6 grid grid-cols-2 gap-px border border-navy/15 bg-navy/10 sm:grid-cols-5">
        {[['Courses', ds.courses.length, `${new Set(ds.courses.map(c => c.code)).size} codes`], ['Faculty', ds.faculty.length, ''], ['Batches', ds.batches.length, `${ds.batches.reduce((s, b) => s + b.size, 0)} students`],
          ['Rooms', ds.rooms.length, `${ds.rooms.filter(r => r.room_type === 'lab').length} labs`], ['Sessions', `${m.scheduled_sessions}/${m.required_sessions}`, 'scheduled / required']].map(([k, v, s]) => (
          <div key={k as string} className="bg-ivory px-4 py-3">
            <Eyebrow>{k}</Eyebrow>
            <div className="mt-1 font-mono text-xl">{v}</div>
            <div className="font-mono text-2xs text-slate">{s}</div>
          </div>
        ))}
      </div>

      <div className="mt-8">
        <SectionHead index="A" title="Schedule quality" sub={bm ? `Current ${active.record.id} vs baseline ${baseline!.record.id}. All values computed from the stored assignments.` : 'All values computed from the stored assignments.'} />
        <div className="grid grid-cols-2 gap-px border border-navy/15 bg-navy/10 md:grid-cols-4">
          <Kpi label="Hard violations" value={String(active.validation.hard_count)} dir="↓ min" tone={active.validation.hard_count ? 'red' : undefined} />
          <Kpi label="Unscheduled" value={String(m.unscheduled_sessions)} dir="↓ min" tone={m.unscheduled_sessions ? 'red' : undefined} />
          <Kpi label="Student idle" value={`${m.student_idle_minutes}`} sub="min/wk" dir="↓" base={bm ? `${bm.student_idle_minutes}` : undefined} tone={bm && m.student_idle_minutes < bm.student_idle_minutes ? 'lime' : undefined} />
          <Kpi label="Faculty idle" value={`${m.faculty_idle_minutes}`} sub="min/wk" dir="↓" base={bm ? `${bm.faculty_idle_minutes}` : undefined} tone={bm && m.faculty_idle_minutes < bm.faculty_idle_minutes ? 'lime' : undefined} />
          <Kpi label="Room-time utilization" value={pct(m.room_time_utilization)} dir="↑" sub="occupied ÷ available" />
          <Kpi label="Seat utilization" value={pct(m.seat_utilization)} dir="↑" base={bm ? pct(bm.seat_utilization) : undefined} tone={bm && m.seat_utilization > bm.seat_utilization ? 'lime' : undefined} />
          <Kpi label="Workload imbalance" value={`${m.workload_imbalance_hours}h`} dir="↓" base={bm ? `${bm.workload_imbalance_hours}h` : undefined} tone={bm && m.workload_imbalance_hours < bm.workload_imbalance_hours ? 'lime' : undefined} />
          <Kpi label="Preference satisfaction" value={pct(m.preference_satisfaction, 0)} dir="↑" base={bm ? pct(bm.preference_satisfaction, 0) : undefined} tone={bm && m.preference_satisfaction > bm.preference_satisfaction ? 'lime' : undefined} />
        </div>
      </div>

      <div className="mt-8 grid gap-8 lg:grid-cols-2">
        <section>
          <SectionHead index="B" title="Faculty weekly load" sub="Teaching hours per week. Marker = contractual maximum (hard limit)." />
          <div className="h-60 border border-navy/15 bg-white p-3">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={facultyData} margin={{ top: 8, right: 8, bottom: 0, left: -24 }} barCategoryGap="28%">
                <XAxis dataKey="id" tick={{ fontSize: 10, fontFamily: 'JetBrains Mono', fill: '#778196' }} axisLine={{ stroke: '#DCE0E7' }} tickLine={false} />
                <YAxis allowDecimals={false} tick={{ fontSize: 10, fontFamily: 'JetBrains Mono', fill: '#778196' }} axisLine={false} tickLine={false} />
                <Tooltip cursor={{ fill: 'rgba(23,36,59,0.05)' }} contentStyle={{ border: '1px solid #17243B', borderRadius: 0, fontSize: 12 }}
                  formatter={(v: any, k: any) => [`${v} h`, k === 'load' ? 'Weekly load' : 'Max']} labelFormatter={(l: any) => facultyData.find(f => f.id === l)?.name ?? l} />
                <RBar dataKey="load" radius={[3, 3, 0, 0]}>
                  {facultyData.map(f => <Cell key={f.id} fill={f.load > f.max ? '#D94B4B' : '#17243B'} />)}
                </RBar>
                {facultyData.map(f => <ReferenceDot key={f.id} x={f.id} y={f.max} r={0} label={{ value: '—', position: 'center', fill: '#778196', fontSize: 18 }} />)}
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>

        <section>
          <SectionHead index="C" title="Batch daily load" sub="Class hours per class per day (busiest lab group). Idle = mean over the class's groups. Darker = heavier day." />
          <div className="overflow-x-auto border border-navy/15 bg-white p-3">
            <table className="w-full border-separate border-spacing-[3px] text-xs">
              <thead><tr><th />{ds.time.days.map(d => <th key={d} className="font-mono text-2xs font-normal text-slate">{d}</th>)}<th className="font-mono text-2xs font-normal text-slate">idle</th></tr></thead>
              <tbody>
                {classes.map(b => (
                  <tr key={b.id}>
                    <td className="pr-2 font-mono text-2xs">{b.id}</td>
                    {b.daily_slots.map((n, i) => (
                      <td key={i} title={`${b.id} · ${ds.time.days[i]}: ${n} h`} className="h-8 text-center font-mono text-2xs"
                        style={{ background: n ? `rgba(23,36,59,${0.12 + 0.75 * n / maxDaily})` : '#F7F6F1', color: n / maxDaily > 0.5 ? '#F7F6F1' : '#17243B' }}>{n || ''}</td>
                    ))}
                    <td className="pl-2 text-right font-mono text-2xs">{b.idle_minutes}m</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section>
          <SectionHead index="D" title="Room utilization" sub="Room-time = occupied ÷ available slots. Seat = enrolled ÷ capacity while in use." />
          <div className="divide-y divide-navy/[0.06] border border-navy/15 bg-white">
            {m.rooms.map(r => (
              <div key={r.id} className="grid grid-cols-[72px_1fr_56px_56px] items-center gap-3 px-3 py-2 text-xs">
                <Mono>{r.id}</Mono>
                <Bar value={r.utilization} />
                <Mono className="text-right">{pct(r.utilization, 0)}</Mono>
                <Mono className="text-right text-slate" >{r.seat_utilization == null ? '—' : pct(r.seat_utilization, 0)}</Mono>
              </div>
            ))}
            <div className="grid grid-cols-[72px_1fr_56px_56px] gap-3 px-3 py-1.5 font-mono text-2xs text-slate"><span /><span /><span className="text-right">time</span><span className="text-right">seat</span></div>
          </div>
        </section>

        <section>
          <SectionHead index="E" title="Last optimization run" />
          {lastRun ? (
            <div className="border border-navy/15 bg-white p-4 text-sm">
              <div className="flex items-center gap-2"><Mono>{lastRun.id}</Mono><KindBadge kind="optimized" /><span className="text-slate">{new Date(lastRun.created_at).toLocaleString()}</span></div>
              {active.record.id === lastRun.id ? (
                <dl className="mt-3 grid grid-cols-2 gap-y-1.5 text-xs">
                  <dt className="text-slate">Solver status</dt><dd className="font-mono">{active.record.solver.status}</dd>
                  <dt className="text-slate">Wall time</dt><dd className="font-mono">{active.record.solver.wall_seconds}s</dd>
                  <dt className="text-slate">Soft score (baseline = 1.000)</dt><dd className="font-mono">{active.score.toFixed(3)} ↓</dd>
                  <dt className="text-slate">Sessions changed</dt><dd className="font-mono">{active.record.changes.length}</dd>
                </dl>
              ) : <p className="mt-2 text-xs text-slate">You are viewing {active.record.id}. Open the lab to inspect this run.</p>}
              <Button size="sm" className="mt-4" onClick={() => setView('lab')}>Open in lab <ArrowRight className="h-3.5 w-3.5" /></Button>
            </div>
          ) : (
            <div className="border border-dashed border-slate-300 p-5 text-sm text-slate">
              No optimization run yet. The current timetable is the first-fit baseline.
              <div className="mt-3"><Button tone="accent" size="sm" onClick={() => setView('lab')}>Run optimizer</Button></div>
            </div>
          )}
        </section>
      </div>
    </Page>
  )
}
