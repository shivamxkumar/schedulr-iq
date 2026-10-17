import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { AlertTriangle, CheckCircle2, Lock, Plus, RotateCcw, Save, Search, Trash2, X } from 'lucide-react'
import { api, ApiError } from '../api'
import { useApp } from '../store'
import type { Batch, Course, CourseType, Dataset, DataIssue, Faculty, Room, RoomType, TimeConfig } from '../types'
import { Page } from '../components/Shell'
import { Button, Chip, ErrorBox, Mono, SectionHead } from '../components/ui'
import AvailabilityPainter, { toCells, toWindows } from '../components/AvailabilityPainter'
import { CAT_LABEL, catColor, isTeaching, slotLabel } from '../format'

type Tab = 'faculty' | 'rooms' | 'batches' | 'courses' | 'calendar'
const TABS: { id: Tab; label: string }[] = [
  { id: 'faculty', label: 'Faculty' }, { id: 'rooms', label: 'Rooms & labs' }, { id: 'batches', label: 'Batches' },
  { id: 'courses', label: 'Courses' }, { id: 'calendar', label: 'Calendar' },
]
const ENTITY_TAB: Record<string, Tab> = { faculty: 'faculty', room: 'rooms', batch: 'batches', course: 'courses', time: 'calendar', fixed: 'courses' }
const ROOM_TYPES: RoomType[] = ['lecture', 'lab', 'seminar']
const COURSE_TYPES: CourseType[] = ['lecture', 'lab', 'tutorial']
const ALL_DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x))
const nextId = (prefix: string, ids: string[]) => { let i = ids.length + 1; while (ids.includes(`${prefix}${String(i).padStart(2, '0')}`)) i++; return `${prefix}${String(i).padStart(2, '0')}` }

/* ---------- small form primitives ---------- */

function Field({ label, children, hint, className = '' }: { label: string; children: ReactNode; hint?: ReactNode; className?: string }) {
  return (
    <label className={`block ${className}`}>
      <span className="font-mono text-2xs uppercase tracking-wider text-slate">{label}</span>
      <div className="mt-1">{children}</div>
      {hint && <div className="mt-0.5 text-2xs text-slate">{hint}</div>}
    </label>
  )
}
const inputCls = 'h-9 w-full border border-slate-200 bg-white px-2.5 text-sm focus:border-navy focus:outline-none disabled:bg-ivory disabled:text-slate'
function Text({ value, onChange, disabled, mono }: { value: string; onChange: (v: string) => void; disabled?: boolean; mono?: boolean }) {
  return <input value={value} disabled={disabled} onChange={e => onChange(e.target.value)} className={`${inputCls} ${mono ? 'font-mono' : ''}`} />
}
function Num({ value, onChange, min = 0, max, disabled }: { value: number; onChange: (v: number) => void; min?: number; max?: number; disabled?: boolean }) {
  return <input type="number" value={value} min={min} max={max} disabled={disabled} onChange={e => onChange(Number(e.target.value))} className={`${inputCls} font-mono`} />
}
function Toggles<T extends string>({ options, value, onChange, disabled, render }: { options: T[]; value: T[]; onChange: (v: T[]) => void; disabled?: boolean; render?: (o: T) => ReactNode }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map(o => {
        const on = value.includes(o)
        return (
          <button key={o} type="button" disabled={disabled} aria-pressed={on} onClick={() => onChange(on ? value.filter(x => x !== o) : [...value, o])}
            className={`min-h-7 border px-2 py-0.5 text-left text-xs disabled:opacity-50 ${on ? 'border-navy bg-navy text-ivory' : 'border-slate-200 bg-white hover:border-navy/40'}`}>
            {render ? render(o) : o}
          </button>
        )
      })}
      {options.length === 0 && <span className="text-xs text-slate">None defined yet.</span>}
    </div>
  )
}
function Tags({ value, onChange, suggestions, disabled }: { value: string[]; onChange: (v: string[]) => void; suggestions: string[]; disabled?: boolean }) {
  const [txt, setTxt] = useState('')
  const add = (t: string) => { const v = t.trim().toLowerCase(); if (v && !value.includes(v)) onChange([...value, v]); setTxt('') }
  return (
    <div>
      <div className="flex flex-wrap items-center gap-1.5 border border-slate-200 bg-white p-1.5">
        {value.map(t => (
          <span key={t} className="inline-flex items-center gap-1 border border-navy/20 bg-ivory px-1.5 py-0.5 font-mono text-2xs">
            {t}{!disabled && <button type="button" onClick={() => onChange(value.filter(x => x !== t))} aria-label={`Remove ${t}`}><X className="h-3 w-3" /></button>}
          </span>
        ))}
        <input value={txt} disabled={disabled} onChange={e => setTxt(e.target.value)} placeholder={value.length ? '' : 'none'}
          onKeyDown={e => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); add(txt) } }}
          className="h-6 min-w-[80px] flex-1 bg-transparent text-xs focus:outline-none" />
      </div>
      {!disabled && suggestions.filter(s => !value.includes(s)).length > 0 && (
        <div className="mt-1 flex flex-wrap gap-1">
          {suggestions.filter(s => !value.includes(s)).map(s => (
            <button key={s} type="button" onClick={() => add(s)} className="font-mono text-2xs text-slate underline-offset-2 hover:text-navy hover:underline">+ {s}</button>
          ))}
        </div>
      )}
    </div>
  )
}
function DeleteButton({ onConfirm, disabled, label }: { onConfirm: () => void; disabled?: boolean; label: string }) {
  const [armed, setArmed] = useState(false)
  useEffect(() => { if (!armed) return; const t = setTimeout(() => setArmed(false), 3500); return () => clearTimeout(t) }, [armed])
  return (
    <Button size="sm" tone="danger" disabled={disabled} onClick={() => (armed ? onConfirm() : setArmed(true))}>
      <Trash2 className="h-3.5 w-3.5" /> {armed ? 'Click again to delete' : label}
    </Button>
  )
}

function EntityList<T extends { id: string }>({ items, selected, onSelect, onAdd, title, sub, warn, disabled, addLabel }:
  { items: T[]; selected: string | null; onSelect: (id: string) => void; onAdd: () => void; title: (x: T) => string; sub: (x: T) => ReactNode; warn?: (x: T) => boolean; disabled?: boolean; addLabel: string }) {
  const [q, setQ] = useState('')
  const shown = items.filter(x => `${x.id} ${title(x)}`.toLowerCase().includes(q.toLowerCase()))
  return (
    <div className="flex flex-col border border-navy/15 bg-white lg:max-h-[calc(100vh-260px)]">
      <div className="flex items-center gap-2 border-b border-navy/10 p-2">
        <Search className="h-3.5 w-3.5 text-slate" />
        <input value={q} onChange={e => setQ(e.target.value)} placeholder={`Search ${items.length}…`} className="h-7 min-w-0 flex-1 bg-transparent text-xs focus:outline-none" />
        <Button size="sm" tone="primary" disabled={disabled} onClick={onAdd}><Plus className="h-3.5 w-3.5" />{addLabel}</Button>
      </div>
      <div className="scroll-thin overflow-y-auto">
        {shown.map(x => (
          <button key={x.id} onClick={() => onSelect(x.id)}
            className={`flex w-full items-start gap-2 border-b border-navy/[0.06] px-3 py-2 text-left last:border-b-0 ${selected === x.id ? 'bg-lime' : 'hover:bg-ivory'}`}>
            <Mono className="mt-0.5 w-16 shrink-0 truncate text-2xs">{x.id}</Mono>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] font-medium">{title(x)}</span>
              <span className="block truncate text-2xs text-slate">{sub(x)}</span>
            </span>
            {warn?.(x) && <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-conflict" />}
          </button>
        ))}
        {shown.length === 0 && <div className="p-4 text-center text-xs text-slate">No matches.</div>}
      </div>
    </div>
  )
}

/* ---------- main view ---------- */

export default function Setup() {
  const { data, canEdit, refresh, toast, errMsg, active, L } = useApp()
  const [draft, setDraft] = useState<Dataset | null>(data ? clone(data.dataset) : null)
  const [tab, setTab] = useState<Tab>('faculty')
  const [sel, setSel] = useState<Record<Tab, string | null>>({ faculty: null, rooms: null, batches: null, courses: null, calendar: null })
  const [check, setCheck] = useState<{ issues: DataIssue[]; diagnostics: string[] } | null>(null)
  const [checking, setChecking] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveErr, setSaveErr] = useState<string[] | null>(null)
  const [genResult, setGenResult] = useState<{ ok: boolean; title: string; lines: string[] } | null>(null)

  useEffect(() => { if (data) setDraft(clone(data.dataset)) }, [data?.version]) // eslint-disable-line react-hooks/exhaustive-deps

  const dirty = !!draft && !!data && JSON.stringify(draft) !== JSON.stringify(data.dataset)

  useEffect(() => {
    if (!draft || !canEdit) return
    setChecking(true)
    const t = setTimeout(() => {
      api.validateDataset(draft).then(setCheck).catch(() => setCheck(null)).finally(() => setChecking(false))
    }, 450)
    return () => clearTimeout(t)
  }, [draft, canEdit])

  const savedIds = useMemo(() => new Set([
    ...(data?.dataset.faculty.map(x => `f:${x.id}`) ?? []), ...(data?.dataset.rooms.map(x => `r:${x.id}`) ?? []),
    ...(data?.dataset.batches.map(x => `b:${x.id}`) ?? []), ...(data?.dataset.courses.map(x => `c:${x.id}`) ?? []),
  ]), [data])

  if (!data || !draft) return null
  const tc = draft.time
  const ro = !canEdit
  const update = (fn: (d: Dataset) => void) => setDraft(prev => { const n = clone(prev!); fn(n); return n })

  /* scheduled-cell overlays from the active schedule (only meaningful for saved data) */
  const overlayFor = (kind: 'fac' | 'room', id: string) => {
    const o: Record<string, string> = {}
    for (const a of active?.record.assignments ?? []) {
      if ((kind === 'fac' ? a.faculty_id : a.room_id) !== id) continue
      const s = L.sessions[a.session_id]
      if (!s) continue
      for (let t = a.start; t < a.start + s.duration; t++) o[`${a.day}-${t}`] = L.courses[s.course_id]?.code ?? ''
    }
    return o
  }

  const issuesFor = (entity: string, id: string) => (check?.issues ?? []).filter(i => i.entity === entity && i.id === id)

  const save = async () => {
    setSaving(true)
    setSaveErr(null)
    setGenResult(null)
    try {
      await api.putDataset(draft)
      const g = await api.generate()
      await refresh()
      if (g.status === 'ok') {
        setGenResult({ ok: true, title: `Saved · new baseline ${g.schedule?.record.id} generated`, lines: [`${g.schedule?.validation.scheduled}/${g.schedule?.validation.required} sessions placed, 0 hard violations (independently validated). Run the optimizer next.`] })
        toast({ tone: 'ok', title: 'Setup saved', body: `Baseline ${g.schedule?.record.id} generated and validated.` })
      } else {
        setGenResult({ ok: false, title: g.message || 'No feasible timetable under these inputs', lines: [...(g.diagnostics ?? []), g.partial ? `Best partial: ${g.partial.validation.scheduled}/${g.partial.validation.required} sessions (not publishable).` : ''].filter(Boolean) })
        toast({ tone: 'error', title: 'Saved, but no feasible timetable', body: g.diagnostics?.[0] })
      }
    } catch (e) {
      if (e instanceof ApiError && e.detail?.issues) setSaveErr(e.detail.issues.map((i: DataIssue) => `${i.entity} ${i.id} · ${i.field}: ${i.message}`))
      else setSaveErr([errMsg(e)])
    } finally {
      setSaving(false)
    }
  }

  const errors = (check?.issues ?? []).filter(i => i.level === 'error')
  const warnings = (check?.issues ?? []).filter(i => i.level === 'warning')
  const pick = (t: Tab, id: string | null) => { setTab(t); setSel(s => ({ ...s, [t]: id })) }

  return (
    <Page title="Institute setup" eyebrow="06 · Admin input · faculty, rooms, labs, batches, courses & availability">
      {ro && (
        <div className="mb-5 flex items-center gap-2 border border-navy/20 bg-white px-4 py-2.5 text-sm"><Lock className="h-4 w-4" />Read-only account — sign in as an administrator to edit.</div>
      )}

      <div className="sticky top-14 z-10 -mx-4 mb-5 flex flex-wrap items-center gap-3 border-y border-navy/10 bg-ivory/95 px-4 py-2.5 backdrop-blur md:-mx-8 md:px-8">
        <div className="flex border border-navy/20 bg-white p-0.5" role="tablist">
          {TABS.map(t => (
            <button key={t.id} role="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)}
              className={`h-7 px-3 font-mono text-2xs uppercase tracking-wider ${tab === t.id ? 'bg-navy text-lime' : 'text-navy hover:bg-navy/5'}`}>
              {t.label} {t.id !== 'calendar' && <span className="opacity-60">{t.id === 'faculty' ? draft.faculty.length : t.id === 'rooms' ? draft.rooms.length : t.id === 'batches' ? draft.batches.length : draft.courses.length}</span>}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2 text-xs">
          {checking ? <span className="text-slate">Checking…</span>
            : errors.length ? <Chip tone="red"><AlertTriangle className="h-3 w-3" />{errors.length} errors</Chip>
              : canEdit && <Chip tone="lime"><CheckCircle2 className="h-3 w-3" />inputs valid</Chip>}
          {warnings.length > 0 && <Chip tone="muted">{warnings.length} warnings</Chip>}
          {(check?.diagnostics?.length ?? 0) > 0 && <Chip tone="red">{check!.diagnostics.length} feasibility risks</Chip>}
        </div>
        <div className="ml-auto flex items-center gap-2">
          {dirty && <Mono className="text-2xs text-slate">unsaved changes</Mono>}
          <Button size="sm" disabled={!dirty || saving} onClick={() => { setDraft(clone(data.dataset)); setSaveErr(null) }}><RotateCcw className="h-3.5 w-3.5" />Discard</Button>
          <Button size="sm" tone="accent" disabled={!dirty || ro || errors.length > 0} loading={saving} onClick={save} title={errors.length ? 'Fix the errors first' : 'Replaces the dataset, clears old schedules and generates a new validated baseline'}>
            <Save className="h-3.5 w-3.5" />Save & generate timetable
          </Button>
        </div>
      </div>

      {saveErr && <div className="mb-4"><ErrorBox title="Dataset rejected by the server"><ul className="list-disc pl-4 text-xs">{saveErr.map((e, i) => <li key={i}>{e}</li>)}</ul></ErrorBox></div>}
      {genResult && (genResult.ok
        ? <div className="mb-4 border border-navy bg-lime-50 px-4 py-3 text-sm"><div className="font-semibold">{genResult.title}</div>{genResult.lines.map((l, i) => <div key={i} className="text-xs text-slate-600">{l}</div>)}</div>
        : <div className="mb-4"><ErrorBox title={genResult.title}><ul className="list-disc pl-4 text-xs">{genResult.lines.map((l, i) => <li key={i}>{l}</li>)}</ul></ErrorBox></div>)}
      {(errors.length > 0 || (check?.diagnostics?.length ?? 0) > 0) && (
        <div className="mb-5 border border-conflict/30 bg-white px-4 py-3">
          <div className="mb-1.5 font-mono text-2xs uppercase tracking-wider text-conflict">Live check · fix before saving</div>
          <ul className="space-y-1 text-xs">
            {errors.map((i, k) => (
              <li key={k}><button className="text-left hover:underline" onClick={() => pick(ENTITY_TAB[i.entity] ?? 'courses', i.id)}><Mono className="text-conflict">{i.entity}:{i.id}</Mono> {i.message}</button></li>
            ))}
            {check?.diagnostics.map((d, k) => <li key={`d${k}`} className="text-navy/80"><Mono className="text-conflict">feasibility</Mono> {d}</li>)}
          </ul>
        </div>
      )}

      {tab === 'faculty' && (
        <TwoPane
          list={<EntityList items={draft.faculty} selected={sel.faculty} onSelect={id => pick('faculty', id)} disabled={ro} addLabel="Faculty"
            onAdd={() => { const id = nextId('F', draft.faculty.map(f => f.id)); update(d => d.faculty.push({ id, name: 'New faculty member', department: '', courses: [], unavailable: [], dispreferred: [], max_daily_slots: 4, max_weekly_slots: 12 })); pick('faculty', id) }}
            title={f => f.name} sub={f => `${f.department || '—'} · ${f.courses.length} courses · max ${f.max_weekly_slots}h/wk`} warn={f => issuesFor('faculty', f.id).some(i => i.level === 'error')} />}
          editor={(() => {
            const f = draft.faculty.find(x => x.id === sel.faculty)
            if (!f) return <Hint>Select a faculty member to edit their details, teaching eligibility and weekly availability — or add a new one.</Hint>
            const idx = draft.faculty.indexOf(f)
            const set = (patch: Partial<Faculty>) => update(d => { Object.assign(d.faculty[idx], patch) })
            const cells = toCells(tc, [{ state: 'pref', windows: f.dispreferred }, { state: 'off', windows: f.unavailable }])
            const avail = cells.flatMap((r, d) => r.map((s, t) => (isTeaching(tc, d, t) && s !== 'off' ? 1 : 0) as number)).reduce((a, b) => a + b, 0)
            const demand = draft.courses.filter(c => f.courses.includes(c.id)).reduce((s, c) => s + c.sessions_per_week * c.duration_slots, 0)
            const isNew = !savedIds.has(`f:${f.id}`)
            return (
              <Editor title={f.name} id={f.id} issues={issuesFor('faculty', f.id)}
                actions={<DeleteButton disabled={ro} label="Delete" onConfirm={() => { update(d => { d.faculty.splice(idx, 1) }); pick('faculty', null) }} />}>
                <SectionHead index="1" title="Profile & load limits" />
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  <Field label="Faculty ID" hint={isNew ? 'Unique; cannot change after saving' : undefined}><Text mono value={f.id} disabled={ro || !isNew} onChange={v => { update(d => { d.faculty[idx].id = v.trim() }); setSel(s => ({ ...s, faculty: v.trim() })) }} /></Field>
                  <Field label="Full name"><Text value={f.name} disabled={ro} onChange={v => set({ name: v })} /></Field>
                  <Field label="Department"><Text value={f.department} disabled={ro} onChange={v => set({ department: v })} /></Field>
                  <Field label="Max teaching slots / day" hint="Hard limit"><Num value={f.max_daily_slots} min={1} disabled={ro} onChange={v => set({ max_daily_slots: v })} /></Field>
                  <Field label="Max teaching slots / week" hint="Hard limit"><Num value={f.max_weekly_slots} min={1} disabled={ro} onChange={v => set({ max_weekly_slots: v })} /></Field>
                  <div className="grid grid-cols-2 gap-px self-end border border-navy/10 bg-navy/10 text-xs">
                    <div className="bg-white p-2"><div className="text-slate">Available</div><Mono>{avail} slots</Mono></div>
                    <div className="bg-white p-2"><div className="text-slate">Eligible demand</div><Mono>{demand} slots</Mono></div>
                  </div>
                </div>
                <SectionHead index="2" title="Courses this person can teach" sub="Only listed faculty are ever assigned to a course (hard constraint)." />
                <Toggles disabled={ro} options={draft.courses.map(c => c.id)} value={f.courses} onChange={v => set({ courses: v })}
                  render={id => { const c = draft.courses.find(x => x.id === id)!; return <span><Mono className="text-2xs">{c.code}</Mono> {c.name}</span> }} />
                <SectionHead index="3" title="Weekly availability" sub="Unavailable = never scheduled (hard). Prefers not = avoided by the optimizer when possible (soft). Labels show what the current timetable has scheduled." />
                <AvailabilityPainter tc={tc} cells={cells} disabled={ro} overlay={isNew ? undefined : overlayFor('fac', f.id)}
                  modes={[{ state: 'free', label: 'Available', swatch: 'bg-white' }, { state: 'off', label: 'Unavailable', swatch: 'bg-navy' }, { state: 'pref', label: 'Prefers not', swatch: 'bg-slate-300' }]}
                  onChange={c => set({ unavailable: toWindows(c, 'off'), dispreferred: toWindows(c, 'pref') })} />
              </Editor>
            )
          })()} />
      )}

      {tab === 'rooms' && (
        <TwoPane
          list={<EntityList items={draft.rooms} selected={sel.rooms} onSelect={id => pick('rooms', id)} disabled={ro} addLabel="Room"
            onAdd={() => { const id = nextId('R-', draft.rooms.map(r => r.id)); update(d => d.rooms.push({ id, name: 'New room', capacity: 60, room_type: 'lecture', equipment: [], unavailable: [] })); pick('rooms', id) }}
            title={r => r.name} sub={r => `${r.room_type} · ${r.capacity} seats${r.equipment.length ? ` · ${r.equipment.join(', ')}` : ''}`} warn={r => issuesFor('room', r.id).some(i => i.level === 'error')} />}
          editor={(() => {
            const r = draft.rooms.find(x => x.id === sel.rooms)
            if (!r) return <Hint>Select a classroom or laboratory to edit its capacity, type, equipment and opening hours — or add a new one.</Hint>
            const idx = draft.rooms.indexOf(r)
            const set = (patch: Partial<Room>) => update(d => { Object.assign(d.rooms[idx], patch) })
            const sizes = Object.fromEntries(draft.batches.map(b => [b.id, b.size]))
            const fits = draft.courses.filter(c => c.room_types.includes(r.room_type) && c.equipment.every(e => r.equipment.includes(e)) && c.batch_ids.reduce((s, b) => s + (sizes[b] ?? 0), 0) <= r.capacity)
            const isNew = !savedIds.has(`r:${r.id}`)
            const allEquip = [...new Set(['projector', 'computers', 'electronics', ...draft.rooms.flatMap(x => x.equipment), ...draft.courses.flatMap(c => c.equipment)])]
            return (
              <Editor title={r.name} id={r.id} issues={issuesFor('room', r.id)}
                actions={<DeleteButton disabled={ro} label="Delete" onConfirm={() => { update(d => { d.rooms.splice(idx, 1) }); pick('rooms', null) }} />}>
                <SectionHead index="1" title="Room details" />
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <Field label="Room ID"><Text mono value={r.id} disabled={ro || !isNew} onChange={v => { update(d => { d.rooms[idx].id = v.trim() }); setSel(s => ({ ...s, rooms: v.trim() })) }} /></Field>
                  <Field label="Name"><Text value={r.name} disabled={ro} onChange={v => set({ name: v })} /></Field>
                  <Field label="Type">
                    <select value={r.room_type} disabled={ro} onChange={e => set({ room_type: e.target.value as RoomType })} className={inputCls}>
                      {ROOM_TYPES.map(t => <option key={t} value={t}>{t === 'lab' ? 'Laboratory' : t === 'seminar' ? 'Seminar room' : 'Lecture / classroom'}</option>)}
                    </select>
                  </Field>
                  <Field label="Seating capacity"><Num value={r.capacity} min={1} disabled={ro} onChange={v => set({ capacity: v })} /></Field>
                </div>
                <Field label="Equipment" className="mt-3" hint="Courses requiring equipment can only use rooms that have it."><Tags value={r.equipment} disabled={ro} suggestions={allEquip} onChange={v => set({ equipment: v })} /></Field>
                <p className="mt-2 text-xs text-slate">Can host <Mono className="text-navy">{fits.length}</Mono> of {draft.courses.length} courses: {fits.map(c => c.code).filter((v, i, a) => a.indexOf(v) === i).join(', ') || 'none'}.</p>
                <SectionHead index="2" title="Opening hours / availability" sub="Mark slots when the room is closed, booked for other events, or under maintenance." />
                <AvailabilityPainter tc={tc} cells={toCells(tc, [{ state: 'off', windows: r.unavailable }])} disabled={ro} overlay={isNew ? undefined : overlayFor('room', r.id)}
                  modes={[{ state: 'free', label: 'Open', swatch: 'bg-white' }, { state: 'off', label: 'Closed / blocked', swatch: 'bg-navy' }]}
                  onChange={c => set({ unavailable: toWindows(c, 'off') })} />
              </Editor>
            )
          })()} />
      )}

      {tab === 'batches' && (
        <TwoPane
          list={<EntityList items={draft.batches} selected={sel.batches} onSelect={id => pick('batches', id)} disabled={ro} addLabel="Batch"
            onAdd={() => { const id = nextId('B-', draft.batches.map(b => b.id)); update(d => d.batches.push({ id, name: 'New batch', size: 60, program: '' })); pick('batches', id) }}
            title={b => b.name} sub={b => `${b.program || '—'} · ${b.size} students`} warn={b => issuesFor('batch', b.id).some(i => i.level === 'error')} />}
          editor={(() => {
            const b = draft.batches.find(x => x.id === sel.batches)
            if (!b) return <Hint>Select a student batch / section to edit its size and curriculum — or add a new one.</Hint>
            const idx = draft.batches.indexOf(b)
            const set = (patch: Partial<Batch>) => update(d => { Object.assign(d.batches[idx], patch) })
            const curriculum = draft.courses.filter(c => c.batch_ids.includes(b.id))
            const hours = curriculum.reduce((s, c) => s + c.sessions_per_week * c.duration_slots, 0)
            const cap = tc.days.reduce((s, _, d) => s + Array.from({ length: tc.slots_per_day }, (_, t) => t).filter(t => isTeaching(tc, d, t)).length, 0)
            const isNew = !savedIds.has(`b:${b.id}`)
            return (
              <Editor title={b.name} id={b.id} issues={issuesFor('batch', b.id)}
                actions={<DeleteButton disabled={ro} label="Delete" onConfirm={() => { update(d => { d.batches.splice(idx, 1); d.courses.forEach(c => { c.batch_ids = c.batch_ids.filter(x => x !== b.id) }) }); pick('batches', null) }} />}>
                <SectionHead index="1" title="Batch details" />
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <Field label="Batch ID"><Text mono value={b.id} disabled={ro || !isNew} onChange={v => { const nv = v.trim(); update(d => { d.batches[idx].id = nv; d.courses.forEach(c => { c.batch_ids = c.batch_ids.map(x => (x === b.id ? nv : x)) }) }); setSel(s => ({ ...s, batches: nv })) }} /></Field>
                  <Field label="Name"><Text value={b.name} disabled={ro} onChange={v => set({ name: v })} /></Field>
                  <Field label="Programme"><Text value={b.program} disabled={ro} onChange={v => set({ program: v })} /></Field>
                  <Field label="Students enrolled"><Num value={b.size} min={1} disabled={ro} onChange={v => set({ size: v })} /></Field>
                </div>
                <SectionHead index="2" title="Curriculum" sub={`Courses this batch attends. ${hours} class hours / week of ${cap} teachable slots.`} />
                <Toggles disabled={ro} options={draft.courses.map(c => c.id)} value={curriculum.map(c => c.id)}
                  onChange={v => update(d => d.courses.forEach(c => { const has = c.batch_ids.includes(b.id); if (v.includes(c.id) && !has) c.batch_ids.push(b.id); if (!v.includes(c.id) && has) c.batch_ids = c.batch_ids.filter(x => x !== b.id) }))}
                  render={id => { const c = draft.courses.find(x => x.id === id)!; return <span><Mono className="text-2xs">{c.code}</Mono> {c.name}</span> }} />
              </Editor>
            )
          })()} />
      )}

      {tab === 'courses' && (
        <TwoPane
          list={<EntityList items={draft.courses} selected={sel.courses} onSelect={id => pick('courses', id)} disabled={ro} addLabel="Course"
            onAdd={() => { const id = nextId('C', draft.courses.map(c => c.id)); update(d => d.courses.push({ id, code: id, name: 'New course', course_type: 'lecture', category: 'core', batch_ids: [], sessions_per_week: 3, duration_slots: 1, room_types: ['lecture'], equipment: [], eligible_starts: [] })); pick('courses', id) }}
            title={c => `${c.code} · ${c.name}`} sub={c => `${c.course_type} · ${c.sessions_per_week}×${c.duration_slots * tc.slot_minutes}min · ${c.batch_ids.join('+') || 'no batch'}`} warn={c => issuesFor('course', c.id).some(i => i.level === 'error')} />}
          editor={(() => {
            const c = draft.courses.find(x => x.id === sel.courses)
            if (!c) return <Hint>Select a course to edit weekly sessions, duration, room requirements, batches and eligible faculty — or add a new one.</Hint>
            const idx = draft.courses.indexOf(c)
            const set = (patch: Partial<Course>) => update(d => { Object.assign(d.courses[idx], patch) })
            const enroll = c.batch_ids.reduce((s, b) => s + (draft.batches.find(x => x.id === b)?.size ?? 0), 0)
            const rooms = draft.rooms.filter(r => c.room_types.includes(r.room_type) && c.equipment.every(e => r.equipment.includes(e)) && r.capacity >= enroll)
            const fac = draft.faculty.filter(f => f.courses.includes(c.id)).map(f => f.id)
            const isNew = !savedIds.has(`c:${c.id}`)
            const restrict = c.eligible_starts.length > 0
            const allEquip = [...new Set(['projector', 'computers', 'electronics', ...draft.rooms.flatMap(x => x.equipment)])]
            return (
              <Editor title={`${c.code} · ${c.name}`} id={c.id} issues={issuesFor('course', c.id)}
                actions={<DeleteButton disabled={ro} label="Delete" onConfirm={() => { update(d => { d.courses.splice(idx, 1); d.faculty.forEach(f => { f.courses = f.courses.filter(x => x !== c.id) }); d.fixed = d.fixed.filter(x => !x.session_id.startsWith(`${c.id}-S`)) }); pick('courses', null) }} />}>
                <SectionHead index="1" title="Course & weekly requirement" />
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <Field label="Offering ID" hint="Unique per section"><Text mono value={c.id} disabled={ro || !isNew} onChange={v => { const nv = v.trim(); update(d => { d.courses[idx].id = nv; d.faculty.forEach(f => { f.courses = f.courses.map(x => (x === c.id ? nv : x)) }) }); setSel(s => ({ ...s, courses: nv })) }} /></Field>
                  <Field label="Course code"><Text mono value={c.code} disabled={ro} onChange={v => set({ code: v })} /></Field>
                  <Field label="Name" className="sm:col-span-2"><Text value={c.name} disabled={ro} onChange={v => set({ name: v })} /></Field>
                  <Field label="Type">
                    <select value={c.course_type} disabled={ro} className={inputCls}
                      onChange={e => { const t = e.target.value as CourseType; set({ course_type: t, ...(t === 'lab' ? { room_types: ['lab'] } : {}) }) }}>
                      {COURSE_TYPES.map(t => <option key={t} value={t}>{t[0].toUpperCase() + t.slice(1)}</option>)}
                    </select>
                  </Field>
                  <Field label="Department colour">
                    <select value={c.category} disabled={ro} onChange={e => set({ category: e.target.value })} className={inputCls}>
                      {Object.keys(CAT_LABEL).map(k => <option key={k} value={k}>{CAT_LABEL[k]}</option>)}
                    </select>
                  </Field>
                  <Field label="Sessions / week" hint="Max one per day"><Num value={c.sessions_per_week} min={1} max={tc.days.length} disabled={ro} onChange={v => set({ sessions_per_week: v })} /></Field>
                  <Field label="Duration (slots)" hint={`${c.duration_slots * tc.slot_minutes} minutes`}><Num value={c.duration_slots} min={1} max={4} disabled={ro} onChange={v => set({ duration_slots: v })} /></Field>
                </div>
                <div className="mt-2 h-1 w-24" style={{ background: catColor(c.category) }} />
                <SectionHead index="2" title="Who attends · who teaches" sub={`Enrollment ${enroll} students.`} />
                <Field label="Batches attending (combined lecture if more than one)">
                  <Toggles disabled={ro} options={draft.batches.map(b => b.id)} value={c.batch_ids} onChange={v => set({ batch_ids: v })} render={id => <span><Mono className="text-2xs">{id}</Mono> · {draft.batches.find(b => b.id === id)?.size}</span>} />
                </Field>
                <Field label="Eligible faculty" className="mt-3" hint="The optimizer picks exactly one of these to teach every session.">
                  <Toggles disabled={ro} options={draft.faculty.map(f => f.id)} value={fac}
                    onChange={v => update(d => d.faculty.forEach(f => { const has = f.courses.includes(c.id); if (v.includes(f.id) && !has) f.courses.push(c.id); if (!v.includes(f.id) && has) f.courses = f.courses.filter(x => x !== c.id) }))}
                    render={id => draft.faculty.find(f => f.id === id)?.name ?? id} />
                </Field>
                <SectionHead index="3" title="Room requirement" />
                <div className="grid gap-3 lg:grid-cols-2">
                  <Field label="Acceptable room types"><Toggles disabled={ro} options={ROOM_TYPES} value={c.room_types} onChange={v => set({ room_types: v })} /></Field>
                  <Field label="Required equipment"><Tags value={c.equipment} disabled={ro} suggestions={allEquip} onChange={v => set({ equipment: v })} /></Field>
                </div>
                <p className={`mt-2 text-xs ${rooms.length ? 'text-slate' : 'text-conflict'}`}>
                  {rooms.length ? <>Suitable rooms: <Mono className="text-navy">{rooms.map(r => `${r.id} (${r.capacity})`).join(', ')}</Mono></> : `No room satisfies type + equipment + ${enroll} seats — this course cannot be scheduled.`}
                </p>
                <SectionHead index="4" title="Allowed start times" sub="Optional. Leave unrestricted unless the course may only start in certain windows (e.g. lab technician hours)." />
                <label className="mb-2 flex items-center gap-2 text-sm">
                  <input type="checkbox" disabled={ro} checked={restrict} className="accent-navy"
                    onChange={e => set({ eligible_starts: e.target.checked ? tc.days.map((_, d) => ({ day: d, start: 0, end: tc.day_slots[d] ?? tc.slots_per_day })) : [] })} />
                  Restrict start times
                </label>
                {restrict && (
                  <AvailabilityPainter tc={tc} cells={toCells(tc, [{ state: 'off', windows: c.eligible_starts }])} disabled={ro}
                    modes={[{ state: 'free', label: 'Not allowed', swatch: 'bg-white' }, { state: 'off', label: 'Allowed start', swatch: 'bg-navy' }]}
                    onChange={cc => set({ eligible_starts: toWindows(cc, 'off') })} />
                )}
              </Editor>
            )
          })()} />
      )}

      {tab === 'calendar' && <Calendar tc={tc} ro={ro} onChange={t => update(d => { d.time = t })} name={draft.name} onName={n => update(d => { d.name = n })} />}
    </Page>
  )
}

function TwoPane({ list, editor }: { list: ReactNode; editor: ReactNode }) {
  return <div className="grid gap-5 lg:grid-cols-[300px_1fr]"><div className="lg:sticky lg:top-[120px] lg:self-start">{list}</div><div className="min-w-0">{editor}</div></div>
}
function Hint({ children }: { children: ReactNode }) {
  return <div className="flex min-h-[240px] items-center justify-center border border-dashed border-slate-300 px-8 text-center text-sm text-slate">{children}</div>
}
function Editor({ title, id, issues, actions, children }: { title: string; id: string; issues: DataIssue[]; actions: ReactNode; children: ReactNode }) {
  return (
    <div className="fade-up space-y-5 border border-navy/15 bg-white p-5 [&>div.border-b]:mt-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><Mono className="text-2xs text-slate">{id}</Mono><h2 className="font-display text-xl font-semibold leading-tight">{title}</h2></div>
        {actions}
      </div>
      {issues.length > 0 && (
        <div className="space-y-1">{issues.map((i, k) => (
          <div key={k} className={`border px-3 py-1.5 text-xs ${i.level === 'error' ? 'border-conflict/40 bg-conflict-50 text-conflict' : 'border-slate-200 bg-ivory text-slate-600'}`}><Mono>{i.field}</Mono> · {i.message}</div>
        ))}</div>
      )}
      {children}
    </div>
  )
}

function Calendar({ tc, ro, onChange, name, onName }: { tc: TimeConfig; ro: boolean; onChange: (t: TimeConfig) => void; name: string; onName: (n: string) => void }) {
  const setDays = (n: number) => {
    const days = ALL_DAYS.slice(0, n)
    const day_slots = days.map((_, i) => tc.day_slots[i] ?? tc.slots_per_day)
    onChange({ ...tc, days, day_slots })
  }
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div className="space-y-5 border border-navy/15 bg-white p-5">
        <SectionHead index="1" title="Academic week" sub="Changing the grid can invalidate availability windows — the live check will flag them." />
        <Field label="Timetable name"><Text value={name} disabled={ro} onChange={onName} /></Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Working days">
            <select value={tc.days.length} disabled={ro} onChange={e => setDays(Number(e.target.value))} className={inputCls}>
              {[5, 6, 7].map(n => <option key={n} value={n}>{ALL_DAYS[0]}–{ALL_DAYS[n - 1]} ({n} days)</option>)}
            </select>
          </Field>
          <Field label="Day starts at"><input type="time" value={tc.day_start} disabled={ro} onChange={e => onChange({ ...tc, day_start: e.target.value })} className={`${inputCls} font-mono`} /></Field>
          <Field label="Slot length (minutes)">
            <select value={tc.slot_minutes} disabled={ro} onChange={e => onChange({ ...tc, slot_minutes: Number(e.target.value) })} className={inputCls}>
              {[30, 45, 50, 55, 60, 90].map(m => <option key={m} value={m}>{m}</option>)}
            </select>
          </Field>
          <Field label="Slots per day" hint={`Day ends ${slotLabel(tc, tc.slots_per_day)}`}>
            <Num value={tc.slots_per_day} min={1} max={16} disabled={ro} onChange={v => onChange({ ...tc, slots_per_day: v, day_slots: tc.day_slots.map(x => Math.min(x, v)), break_slots: tc.break_slots.filter(b => b < v) })} />
          </Field>
        </div>
      </div>
      <div className="space-y-5 border border-navy/15 bg-white p-5">
        <SectionHead index="2" title="Breaks & operating hours" sub="Break slots are never teachable. Shorten a day for half-days (e.g. Saturday)." />
        <Field label="Break slots (e.g. lunch)">
          <div className="flex flex-wrap gap-1.5">
            {Array.from({ length: tc.slots_per_day }, (_, t) => {
              const on = tc.break_slots.includes(t)
              return <button key={t} type="button" disabled={ro} onClick={() => onChange({ ...tc, break_slots: on ? tc.break_slots.filter(x => x !== t) : [...tc.break_slots, t].sort((a, b) => a - b) })}
                className={`h-7 border px-2 font-mono text-2xs ${on ? 'border-navy bg-navy text-lime' : 'border-slate-200 bg-white'}`}>{slotLabel(tc, t)}</button>
            })}
          </div>
        </Field>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {tc.days.map((d, i) => (
            <Field key={d} label={`${d} · last slot ends`}>
              <select value={tc.day_slots[i] ?? tc.slots_per_day} disabled={ro} className={`${inputCls} font-mono`}
                onChange={e => { const ds = [...tc.day_slots]; ds[i] = Number(e.target.value); onChange({ ...tc, day_slots: ds }) }}>
                {Array.from({ length: tc.slots_per_day + 1 }, (_, n) => <option key={n} value={n}>{n === 0 ? 'closed' : slotLabel(tc, n)}</option>)}
              </select>
            </Field>
          ))}
        </div>
      </div>
    </div>
  )
}
