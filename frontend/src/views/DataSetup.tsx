import { useState } from 'react'
import { CheckCircle2, Download, FileUp, RotateCcw, ShieldCheck, Upload } from 'lucide-react'
import { api, ApiError } from '../api'
import { Page } from '../components/Shell'
import { Button, Chip, ErrorBox, Eyebrow, Mono, SectionHead } from '../components/ui'
import { slotLabel } from '../format'
import { useApp } from '../store'
import type { GenerateResult } from '../types'

type Entity = 'rooms' | 'faculty' | 'batches' | 'courses'
const ENTITIES: { id: Entity; label: string; hint: string }[] = [
  { id: 'rooms', label: 'Rooms', hint: 'id, name, capacity, room_type (lecture|lab|seminar), equipment, unavailable' },
  { id: 'faculty', label: 'Faculty & availability', hint: 'id, name, department, courses, unavailable, dispreferred, max_daily_slots, max_weekly_slots' },
  { id: 'batches', label: 'Student batches', hint: 'id, name, size, program' },
  { id: 'courses', label: 'Courses & weekly sessions', hint: 'id, code, name, course_type (lecture|lab|tutorial), category, batch_ids, sessions_per_week, duration_slots, room_types, equipment, eligible_starts' },
]

interface ImportResult { ok: boolean; rows: number; errors: { row: number; field: string; message: string }[]; issues: any[]; applied?: boolean }

interface Outcome { title: string; tone: 'ok' | 'error'; message?: string; issues?: string[]; diagnostics?: string[]; partial?: { scheduled: number; required: number; id: string } | null }

function describeGenerate(g: GenerateResult): Outcome {
  if (g.status === 'infeasible') {
    const p = g.partial
    return {
      title: 'No feasible timetable under current constraints', tone: 'error', message: g.message, diagnostics: g.diagnostics || [],
      partial: p ? { scheduled: p.validation.scheduled, required: p.validation.required, id: p.record.id } : null,
    }
  }
  const s = g.schedule
  return { title: `Baseline ${s?.record.id ?? ''} generated`, tone: 'ok', message: s ? `Independent validator: ${s.validation.hard_count} hard violations · ${s.validation.scheduled}/${s.validation.required} sessions scheduled.` : undefined }
}

function errOutcome(e: unknown, title: string): Outcome {
  if (e instanceof ApiError) {
    const issues = e.detail?.issues?.map((i: any) => `${i.entity} ${i.id} · ${i.field}: ${i.message}`)
    return { title, tone: 'error', message: e.message, issues }
  }
  return { title, tone: 'error', message: String(e) }
}

function OutcomeBox({ o }: { o: Outcome }) {
  if (o.tone === 'ok') {
    return (
      <div className="fade-up flex gap-2 border border-navy bg-lime-50 px-4 py-3 text-sm">
        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
        <div><div className="font-semibold">{o.title}</div>{o.message && <div className="text-xs text-slate-600">{o.message}</div>}</div>
      </div>
    )
  }
  return (
    <div className="fade-up">
      <ErrorBox title={o.title}>
        {o.message && <p>{o.message}</p>}
        {!!o.issues?.length && <ul className="mt-1.5 list-disc space-y-0.5 pl-4 text-xs">{o.issues.map((m, i) => <li key={i}>{m}</li>)}</ul>}
        {!!o.diagnostics?.length && (
          <div className="mt-2">
            <Eyebrow>Diagnostics</Eyebrow>
            <ul className="mt-1 list-disc space-y-0.5 pl-4 text-xs">{o.diagnostics.map((m, i) => <li key={i}>{m}</li>)}</ul>
          </div>
        )}
        {o.partial && (
          <div className="mt-2 text-xs">
            Best partial timetable <Mono>{o.partial.id}</Mono>: <Mono>{o.partial.scheduled}/{o.partial.required}</Mono> sessions placed — <span className="font-semibold text-conflict">not publishable</span>.
          </div>
        )}
      </ErrorBox>
    </div>
  )
}

function ImportCard({ e, onApplied }: { e: (typeof ENTITIES)[number]; onApplied: () => Promise<void> }) {
  const { errMsg, toast } = useApp()
  const [csv, setCsv] = useState('')
  const [res, setRes] = useState<ImportResult | null>(null)
  const [busy, setBusy] = useState<'validate' | 'apply' | null>(null)
  const [err, setErr] = useState<string | null>(null)

  const run = async (apply: boolean) => {
    setBusy(apply ? 'apply' : 'validate')
    setErr(null)
    try {
      const r = await api.importCsv(e.id, csv, apply)
      setRes(r)
      if (apply && r.applied) {
        toast({ tone: 'ok', title: `${e.label}: ${r.rows} rows imported`, body: 'Existing schedules cleared; generating a new baseline…' })
        await onApplied()
      }
    } catch (x) {
      setErr(errMsg(x))
    } finally {
      setBusy(null)
    }
  }

  const blocking = res?.issues.filter(i => i.level === 'error') ?? []
  return (
    <div className="flex flex-col border border-navy/10 bg-white">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-navy/10 px-3 py-2">
        <div>
          <div className="font-display text-sm font-semibold">{e.label}</div>
          <Mono className="text-2xs text-slate">{e.id}.csv</Mono>
        </div>
        <div className="flex gap-1.5">
          <a href={api.templateUrl(e.id)} download={`${e.id}-template.csv`} className="inline-flex h-7 items-center gap-1 border border-slate-200 bg-white px-2 text-xs hover:border-navy/40"><Download className="h-3.5 w-3.5" />Template</a>
          <a href={api.entityExportUrl(e.id)} download={`${e.id}.csv`} className="inline-flex h-7 items-center gap-1 border border-slate-200 bg-white px-2 text-xs hover:border-navy/40"><Download className="h-3.5 w-3.5" />Export current</a>
        </div>
      </div>
      <div className="flex flex-1 flex-col gap-2 p-3">
        <div className="font-mono text-2xs leading-relaxed text-slate">{e.hint}</div>
        <label className="flex cursor-pointer items-center gap-2 border border-dashed border-slate-300 px-2 py-1.5 text-xs text-slate-600 hover:border-navy/50">
          <FileUp className="h-3.5 w-3.5" /> Choose CSV file…
          <input type="file" accept=".csv,text/csv" className="hidden" onChange={async ev => {
            const f = ev.target.files?.[0]
            if (f) { setCsv(await f.text()); setRes(null) }
            ev.target.value = ''
          }} />
        </label>
        <textarea value={csv} onChange={ev => { setCsv(ev.target.value); setRes(null) }} rows={5} spellCheck={false}
          placeholder="…or paste CSV here (header row required)"
          className="w-full resize-y border border-slate-200 bg-ivory/40 p-2 font-mono text-[11px] leading-snug focus:border-navy focus:outline-none" />
        <div className="flex gap-2">
          <Button size="sm" disabled={!csv.trim()} loading={busy === 'validate'} onClick={() => run(false)}><ShieldCheck className="h-3.5 w-3.5" />Validate</Button>
          <Button size="sm" tone="primary" disabled={!csv.trim() || (res !== null && !res.ok)} loading={busy === 'apply'} onClick={() => run(true)}><Upload className="h-3.5 w-3.5" />Apply import</Button>
        </div>
        {err && <ErrorBox title="Import request failed">{err}</ErrorBox>}
        {res && (
          <div className="space-y-2">
            {res.ok && !blocking.length && (
              <div className="flex items-center gap-2 text-xs"><Chip tone="lime">{res.applied ? 'Applied' : 'Valid'}</Chip><span>{res.rows} rows parsed{res.applied ? ' and applied' : ' · ready to apply'}.</span></div>
            )}
            {res.errors.length > 0 && (
              <div className="overflow-x-auto border border-conflict/40">
                <div className="bg-conflict-50 px-2 py-1 font-mono text-2xs uppercase tracking-wider text-conflict">{res.errors.length} row error{res.errors.length > 1 ? 's' : ''} · nothing imported</div>
                <table className="w-full text-xs">
                  <thead><tr className="border-b border-navy/10 text-left font-mono text-2xs uppercase text-slate"><th className="px-2 py-1">Row</th><th className="px-2 py-1">Field</th><th className="px-2 py-1">Problem</th></tr></thead>
                  <tbody>{res.errors.map((r, i) => (
                    <tr key={i} className="border-b border-navy/[0.06]"><td className="px-2 py-1 font-mono">{r.row}</td><td className="px-2 py-1 font-mono">{r.field}</td><td className="px-2 py-1">{r.message}</td></tr>
                  ))}</tbody>
                </table>
              </div>
            )}
            {res.issues.length > 0 && (
              <ul className="space-y-0.5 text-xs">
                {res.issues.map((i, k) => (
                  <li key={k} className={i.level === 'error' ? 'text-conflict' : 'text-slate-600'}>
                    <Mono className="text-2xs uppercase">{i.level}</Mono> · {i.entity} <Mono>{i.id}</Mono> · {i.message}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

export default function DataSetup() {
  const { data, refresh, toast } = useApp()
  const [busy, setBusy] = useState<string | null>(null)
  const [outcome, setOutcome] = useState<Outcome | null>(null)

  if (!data) return null
  const ds = data.dataset
  const tc = ds.time
  const errors = data.issues.filter(i => i.level === 'error')

  const generateAfter = async (label: string) => {
    try {
      const g = await api.generate()
      const o = describeGenerate(g)
      setOutcome(o)
      if (o.tone === 'error') toast({ tone: 'error', title: o.title, body: [o.message, o.diagnostics?.[0]].filter(Boolean).join(' ') })
      else toast({ tone: 'ok', title: label, body: o.message })
    } catch (e) {
      const o = errOutcome(e, 'Scheduling refused: the dataset has errors')
      setOutcome(o)
      toast({ tone: 'error', title: o.title, body: o.issues?.[0] || o.message })
    }
    await refresh()
  }

  const doReset = async () => {
    setBusy('reset')
    setOutcome(null)
    try {
      await api.resetDemo()
      await refresh()
      setOutcome({ title: 'Demo dataset restored', tone: 'ok', message: 'Original demo data reloaded and a fresh baseline generated.' })
      toast({ tone: 'ok', title: 'Demo dataset restored' })
    } catch (e) {
      setOutcome(errOutcome(e, 'Could not restore demo'))
    } finally {
      setBusy(null)
    }
  }

  const doScenario = async (name: string) => {
    setBusy(name)
    setOutcome(null)
    try {
      await api.scenario(name)
      await generateAfter('Scenario loaded')
    } catch (e) {
      setOutcome(errOutcome(e, 'Could not load scenario'))
    } finally {
      setBusy(null)
    }
  }

  const counts = [
    ['Rooms', ds.rooms.length], ['Faculty', ds.faculty.length], ['Batches', ds.batches.length],
    ['Courses', ds.courses.length], ['Sessions / wk', data.sessions.length],
  ] as const
  const halfDays = tc.days.filter((_, i) => (tc.day_slots[i] ?? tc.slots_per_day) < tc.slots_per_day)

  return (
    <Page title="Data Setup" eyebrow="06 · Data"
      actions={<Button tone="primary" loading={busy === 'reset'} onClick={doReset}><RotateCcw className="h-4 w-4" />Restore demo dataset</Button>}>
      <SectionHead index="A" title="Dataset" sub={<span><Mono>v{data.version}</Mono> · {ds.name}</span>} />
      <div className="grid gap-6 lg:grid-cols-[1fr_1fr]">
        <div>
          <div className="grid grid-cols-5 border-y border-navy/15">
            {counts.map(([k, v]) => (
              <div key={k} className="border-r border-navy/10 px-3 py-3 last:border-r-0">
                <Mono className="block font-display text-2xl font-semibold">{v}</Mono>
                <span className="font-mono text-2xs uppercase tracking-wider text-slate">{k}</span>
              </div>
            ))}
          </div>
          <dl className="mt-4 grid grid-cols-[140px_1fr] gap-y-1.5 text-sm">
            <dt className="text-slate">Working days</dt><dd><Mono>{tc.days.join(' · ')}</Mono></dd>
            <dt className="text-slate">Day starts</dt><dd><Mono>{tc.day_start}</Mono></dd>
            <dt className="text-slate">Slot length</dt><dd><Mono>{tc.slot_minutes} min × {tc.slots_per_day} slots</Mono> <span className="text-slate">(until {slotLabel(tc, tc.slots_per_day)})</span></dd>
            <dt className="text-slate">Breaks</dt><dd><Mono>{tc.break_slots.map(b => `${slotLabel(tc, b)}–${slotLabel(tc, b + 1)}`).join(', ') || 'none'}</Mono></dd>
            <dt className="text-slate">Shortened days</dt><dd><Mono>{halfDays.map(d => `${d} until ${slotLabel(tc, tc.day_slots[tc.days.indexOf(d)])}`).join(', ') || 'none'}</Mono></dd>
          </dl>
        </div>
        <div>
          <Eyebrow className="mb-2">Dataset validation</Eyebrow>
          {data.issues.length === 0 ? (
            <div className="flex items-center gap-2 text-sm"><Chip tone="lime"><CheckCircle2 className="h-3 w-3" />No data issues</Chip><span className="text-slate">All references resolve and every course has an eligible room and teacher.</span></div>
          ) : (
            <ul className="divide-y divide-navy/[0.06] border-y border-navy/10">
              {data.issues.map((i, k) => (
                <li key={k} className="flex gap-2 py-1.5 text-sm">
                  <Chip tone={i.level === 'error' ? 'red' : 'muted'}>{i.level}</Chip>
                  <span><Mono className="text-xs">{i.entity}/{i.id}</Mono> · <span className="text-slate">{i.field}</span> — {i.message}</span>
                </li>
              ))}
            </ul>
          )}
          {errors.length > 0 && <p className="mt-2 text-xs text-conflict">Scheduling is blocked until the {errors.length} error{errors.length > 1 ? 's are' : ' is'} fixed (or restore the demo).</p>}
        </div>
      </div>

      {outcome && <div className="mt-6"><OutcomeBox o={outcome} /></div>}

      <div className="mt-10">
        <SectionHead index="B" title="CSV import" sub="Importing replaces that entity’s rows entirely and clears existing schedules. Lists are separated by ';'. Time windows use day + clock range, separated by '|', e.g. 'Wed 14:00-17:00 | Sat 09:00-13:00'. Every row is validated — nothing is silently dropped." />
        <div className="grid gap-4 md:grid-cols-2">
          {ENTITIES.map(e => <ImportCard key={e.id} e={e} onApplied={() => generateAfter('New baseline generated')} />)}
        </div>
      </div>

      <div className="mt-10">
        <SectionHead index="C" title="Demo & diagnostic scenarios" sub="Diagnostic examples deliberately break the demo dataset to show how SCHEDULR IQ explains failures. Restore the demo afterwards." />
        <div className="grid gap-4 md:grid-cols-3">
          <div className="flex flex-col border border-navy/10 bg-white p-4">
            <Chip tone="muted" className="w-fit">Demo</Chip>
            <div className="mt-2 font-display font-semibold">Northfield Institute of Technology</div>
            <p className="mt-1 flex-1 text-xs text-slate-600">4 batches, 7 rooms, 8 faculty, 16 course offerings, 33 weekly sessions. A feasible timetable exists.</p>
            <Button className="mt-3 w-fit" size="sm" tone="primary" loading={busy === 'reset'} onClick={doReset}><RotateCcw className="h-3.5 w-3.5" />Restore demo</Button>
          </div>
          <div className="flex flex-col border border-navy/10 bg-white p-4">
            <Chip tone="red" className="w-fit">Diagnostic example</Chip>
            <div className="mt-2 font-display font-semibold">Main Lecture Hall closed</div>
            <p className="mt-1 flex-1 text-xs text-slate-600">LH-101 removed. MA201 (118 students, combined CSE-2A + CSE-2B) has no room large enough → rejected as a dataset error before solving.</p>
            <Button className="mt-3 w-fit" size="sm" tone="danger" loading={busy === 'hall-closed'} onClick={() => doScenario('hall-closed')}>Load scenario</Button>
          </div>
          <div className="flex flex-col border border-navy/10 bg-white p-4">
            <Chip tone="red" className="w-fit">Diagnostic example</Chip>
            <div className="mt-2 font-display font-semibold">Visiting professor overloaded</div>
            <p className="mt-1 flex-1 text-xs text-slate-600">Dr. Banerjee also unavailable Wednesdays. MA211 needs 3 sessions on distinct days but only Mon/Fri remain → infeasible, with a non-publishable partial schedule.</p>
            <Button className="mt-3 w-fit" size="sm" tone="danger" loading={busy === 'visiting-overload'} onClick={() => doScenario('visiting-overload')}>Load scenario</Button>
          </div>
        </div>
      </div>
    </Page>
  )
}
