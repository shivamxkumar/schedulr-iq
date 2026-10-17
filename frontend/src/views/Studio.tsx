import { useCallback, useEffect, useMemo, useState } from 'react'
import { FilterX, GitCompare, SearchX } from 'lucide-react'
import { api } from '../api'
import { emptyFilters, useApp, type Filters } from '../store'
import type { Assignment } from '../types'
import TimetableGrid, { type Lane } from '../components/TimetableGrid'
import Inspector, { type MoveVerdict } from '../components/Inspector'
import { Button, Chip, Empty, Mono, Select } from '../components/ui'
import { CAT_LABEL, catColor, describeBatches, whereLabel } from '../format'

type ViewBy = 'class' | 'batch' | 'faculty' | 'room'
const VIEW_LABEL: Record<ViewBy, string> = { class: 'Class timetable', batch: 'All classes', faculty: 'By faculty', room: 'By room' }

export default function Studio() {
  const { data, active, baseline, L, selected, select, filters, setFilters, adopt, activate, toast, errMsg, canRun } = useApp()
  const [viewBy, setViewBy] = useState<ViewBy>('class')
  const [compare, setCompare] = useState(false)
  const [verdict, setVerdict] = useState<MoveVerdict | null>(null)
  const [busy, setBusy] = useState(false)

  const tc = data?.dataset.time
  const sessions = L.sessions
  const f = filters

  // Atomic batches (lab groups / elective divisions) roll up into their class section.
  const sectionOf = useMemo(() => Object.fromEntries((data?.dataset.batches ?? []).map(b => [b.id, b.section || b.id])), [data])
  const sections = useMemo(() => {
    const seen = new Map<string, { id: string; label: string; size: number }>()
    for (const b of data?.dataset.batches ?? []) {
      const id = b.section || b.id
      const cur = seen.get(id)
      seen.set(id, { id, label: b.section ? b.program || id : b.name, size: (cur?.size ?? 0) + b.size })
    }
    return [...seen.values()]
  }, [data])

  const visible = useCallback((a: Assignment) => {
    const s = sessions[a.session_id]
    if (!s) return false
    if (f.batch && !s.batch_ids.some(b => sectionOf[b] === f.batch)) return false
    if (f.faculty && a.faculty_id !== f.faculty) return false
    if (f.room && a.room_id !== f.room) return false
    if (f.course && L.courses[s.course_id]?.code !== f.course) return false
    return true
  }, [f, sessions, L.courses, sectionOf])

  const lanes: Lane[] = useMemo(() => {
    if (!data) return []
    const ds = data.dataset
    if (viewBy === 'batch' || viewBy === 'class') return sections.filter(x => !f.batch || x.id === f.batch).map(x => ({ id: x.id, label: x.label }))
    if (viewBy === 'faculty') return ds.faculty.filter(x => !f.faculty || x.id === f.faculty).map(x => ({ id: x.id, label: x.name }))
    return ds.rooms.filter(r => !f.room || r.id === f.room).map(r => ({ id: r.id, label: r.name }))
  }, [data, viewBy, f, sections])

  const laneKeys = useCallback((a: Assignment) => viewBy === 'batch' || viewBy === 'class' ? [...new Set((sessions[a.session_id]?.batch_ids ?? []).map(b => sectionOf[b]))]
    : viewBy === 'faculty' ? [a.faculty_id] : [a.room_id], [viewBy, sessions, sectionOf])

  const conflicts = useMemo(() => new Set(active?.validation.violations.filter(v => v.severity === 'hard').flatMap(v => v.session_ids) ?? []), [active])

  const { ghosts, moved } = useMemo(() => {
    if (!active || !baseline || active.record.id === baseline.record.id) return { ghosts: [], moved: new Set<string>() }
    const cur = Object.fromEntries(active.record.assignments.map(a => [a.session_id, a]))
    const g: Assignment[] = []
    const m = new Set<string>()
    for (const b of baseline.record.assignments) {
      const a = cur[b.session_id]
      if (a && (a.day !== b.day || a.start !== b.start || a.room_id !== b.room_id || a.faculty_id !== b.faculty_id)) {
        m.add(b.session_id)
        if (a.day !== b.day || a.start !== b.start || (viewBy !== 'batch' && viewBy !== 'class')) g.push(b)
      }
    }
    return { ghosts: g, moved: m }
  }, [active, baseline, viewBy])

  if (!data || !tc) return null
  if (!active) {
    return <div className="p-8"><Empty title="No schedule yet" body="Generate a baseline from Data Setup or the Optimization Lab." /></div>
  }

  // The class timetable always shows exactly one class: rows = time, columns = days.
  useEffect(() => {
    if (viewBy === 'class' && !f.batch && sections[0]) setFilters({ ...f, batch: sections[0].id })
  }, [viewBy, f, sections, setFilters])
  const classMode = viewBy === 'class'
  const days = f.day !== '' ? [Number(f.day)] : tc.days.map((_, i) => i)
  const shown = active.record.assignments.filter(visible).filter(a => days.includes(a.day))
  const scheduledIds = new Set(active.record.assignments.map(a => a.session_id))
  const unscheduled = data.sessions.filter(s => !scheduledIds.has(s.id))
  const activeFilters = (Object.keys(f) as (keyof Filters)[]).filter(k => f[k] !== '')
  const codes = [...new Set(data.dataset.courses.map(c => c.code))].sort()

  const tryMove = async (sid: string, day: number, start: number, room?: string) => {
    if (busy) return
    setBusy(true)
    select(sid)
    try {
      const body = { session_id: sid, day, start, room_id: room || 'auto' }
      const pre = await api.move(active.record.id, { ...body, commit: false })
      if (!pre.valid) {
        setVerdict({ sid, day, start, room: body.room_id, valid: false, introduced: pre.introduced.length ? pre.introduced : pre.validation.violations.filter(v => v.severity === 'hard') })
        return
      }
      const res = await api.move(active.record.id, { ...body, commit: true })
      setVerdict(null)
      if (res.schedule) {
        const parent = active.record.id
        await adopt(res.schedule)
        toast({ tone: 'ok', title: `Moved ${L.courses[sessions[sid].course_id].code} to ${whereLabel(tc, day, start, sessions[sid].duration)}`,
          body: `Independent validator: 0 hard violations. Saved as ${res.schedule.record.id}.`, action: { label: 'Undo', run: () => activate(parent) } })
      }
    } catch (e) {
      toast({ tone: 'error', title: 'Move failed', body: errMsg(e) })
    } finally {
      setBusy(false)
    }
  }

  const force = async () => {
    if (!verdict) return
    setBusy(true)
    try {
      const res = await api.move(active.record.id, { session_id: verdict.sid, day: verdict.day, start: verdict.start, room_id: verdict.room, commit: true, force: true })
      setVerdict(null)
      if (res.schedule) {
        const parent = active.record.id
        await adopt(res.schedule)
        toast({ tone: 'info', title: `Saved invalid draft ${res.schedule.record.id}`, body: 'It cannot be published until its conflicts are resolved.', action: { label: 'Undo', run: () => activate(parent) } })
      }
    } catch (e) {
      toast({ tone: 'error', title: 'Could not save draft', body: errMsg(e) })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex min-h-[calc(100vh-56px)] flex-col lg:flex-row">
      <div className="min-w-0 flex-1 px-4 pb-24 pt-5 md:px-6 md:pb-8">
        <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
          <div>
            <Mono className="text-2xs uppercase tracking-[0.18em] text-slate">02 · Timetable Studio · {active.record.id}</Mono>
            <h1 className="font-display text-[26px] font-semibold leading-tight tracking-tight">{active.record.label}</h1>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex border border-navy/20 bg-white p-0.5" role="tablist" aria-label="View by">
              {(['class', 'batch', 'faculty', 'room'] as ViewBy[]).map(v => (
                <button key={v} role="tab" aria-selected={viewBy === v} onClick={() => setViewBy(v)}
                  className={`h-7 px-3 font-mono text-2xs uppercase tracking-wider ${viewBy === v ? 'bg-navy text-lime' : 'text-navy hover:bg-navy/5'}`}>
                  {VIEW_LABEL[v]}
                </button>
              ))}
            </div>
            {baseline && active.record.id !== baseline.record.id && (
              <Button size="sm" tone={compare ? 'primary' : 'outline'} onClick={() => setCompare(!compare)} title="Show baseline positions of moved sessions as dashed ghosts">
                <GitCompare className="h-3.5 w-3.5" /> Compare to baseline {compare && <Mono className="text-lime">{moved.size} moved</Mono>}
              </Button>
            )}
            {baseline && active.record.id !== baseline.record.id && (
              <Button size="sm" onClick={() => activate(baseline.record.id)}>View baseline</Button>
            )}
          </div>
        </div>

        <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
          <Select label="Class / batch" value={f.batch} onChange={v => setFilters({ ...f, batch: v })}>
            <option value="">All classes</option>
            {sections.map(b => <option key={b.id} value={b.id}>{b.label} · {b.size}</option>)}
          </Select>
          <Select label="Faculty" value={f.faculty} onChange={v => setFilters({ ...f, faculty: v })}>
            <option value="">All faculty</option>
            {data.dataset.faculty.map(x => <option key={x.id} value={x.id}>{x.name}</option>)}
          </Select>
          <Select label="Room" value={f.room} onChange={v => setFilters({ ...f, room: v })}>
            <option value="">All rooms</option>
            {data.dataset.rooms.map(r => <option key={r.id} value={r.id}>{r.id} · {r.capacity}</option>)}
          </Select>
          <Select label="Course" value={f.course} onChange={v => setFilters({ ...f, course: v })}>
            <option value="">All courses</option>
            {codes.map(c => <option key={c} value={c}>{c}</option>)}
          </Select>
          <Select label="Day" value={f.day} onChange={v => setFilters({ ...f, day: v })}>
            <option value="">{tc.days[0]} – {tc.days[tc.days.length - 1]}</option>
            {tc.days.map((d, i) => <option key={d} value={i}>{d}</option>)}
          </Select>
          <div className="flex items-end">
            <Button size="sm" tone="ghost" disabled={!activeFilters.length} onClick={() => setFilters(emptyFilters)} className="h-8 w-full">
              <FilterX className="h-3.5 w-3.5" /> Clear {activeFilters.length ? `(${activeFilters.length})` : ''}
            </Button>
          </div>
        </div>

        <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-2xs text-slate-600">
          {[...new Set(data.dataset.courses.map(c => c.category))].map(c => (
            <span key={c} className="flex items-center gap-1.5"><span className="h-3 w-[3px]" style={{ background: catColor(c) }} />{CAT_LABEL[c]}</span>
          ))}
          <span className="h-3 w-px bg-navy/15" />
          <span className="flex items-center gap-1.5"><span className="h-3 w-4 border border-navy/20 bg-white" />Lecture</span>
          <span className="flex items-center gap-1.5"><span className="hatch-lab h-3 w-4 border border-navy/20" />Lab</span>
          <span className="flex items-center gap-1.5"><span className="h-3 w-4 border border-dashed border-navy/50" />Tutorial</span>
          <span className="flex items-center gap-1.5"><span className="h-3 w-4 border border-conflict bg-conflict-50" />Hard conflict</span>
          {moved.size > 0 && <span className="flex items-center gap-1.5"><span className="h-1.5 w-1.5 bg-navy" />Moved vs baseline</span>}
          {compare && ghosts.length > 0 && <span className="flex items-center gap-1.5"><span className="h-3 w-4 border border-dashed border-navy/35" />Baseline position</span>}
          <span className="ml-auto font-mono">{shown.length} of {active.record.assignments.length} sessions shown · drag a block to move it</span>
        </div>

        {shown.length === 0 ? (
          <Empty icon={<SearchX className="h-6 w-6 text-slate" />} title="No sessions match these filters"
            body={`Active filters: ${activeFilters.map(k => `${k} = ${f[k]}`).join(', ')}`}
            action={<Button onClick={() => setFilters(emptyFilters)}>Clear filters</Button>} />
        ) : (
          <TimetableGrid
            tc={tc} assignments={active.record.assignments} sessions={sessions} courses={L.courses}
            lanes={lanes} laneKeys={laneKeys} days={days} visible={visible} conflicts={conflicts}
            ghosts={compare ? ghosts : []} moved={moved} selected={selected} onSelect={s => { select(s); setVerdict(null) }}
            rowH={classMode ? 82 : undefined}
            labelBatches={ids => describeBatches(data.dataset.batches, ids, { relative: classMode })}
            facultyName={classMode ? id => L.faculty[id]?.name ?? id : undefined}
            onDropSession={canRun ? (sid, d, t) => tryMove(sid, d, t) : undefined}
          />
        )}

        {unscheduled.length > 0 && (
          <div className="mt-4 border border-dashed border-conflict/60 bg-conflict-50/50 p-3">
            <div className="mb-2 font-mono text-2xs uppercase tracking-wider text-conflict">Unscheduled · {unscheduled.length}</div>
            <div className="flex flex-wrap gap-2">
              {unscheduled.map(s => (
                <button key={s.id} onClick={() => select(s.id)} className="border border-conflict/40 bg-white px-2 py-1 text-left text-xs hover:border-conflict">
                  <Mono className="font-medium">{L.courses[s.course_id]?.code}</Mono> <span className="text-slate">{s.id} · {s.batch_ids.join('+')}</span>
                </button>
              ))}
            </div>
          </div>
        )}
        {active.validation.hard_count > 0 && (
          <div className="mt-3 flex items-center gap-2 text-xs">
            <Chip tone="red">{active.validation.hard_count} hard violations</Chip>
            <span className="text-slate">Open the Conflict Inspector for validated fixes.</span>
          </div>
        )}
      </div>

      {selected && sessions[selected] && (
        <div className="fixed inset-0 z-40 bg-navy/20 lg:static lg:z-auto lg:w-[390px] lg:shrink-0 lg:bg-transparent" onClick={e => { if (e.target === e.currentTarget) select(null) }}>
          <div className="absolute inset-y-0 right-0 w-[min(390px,100vw)] lg:sticky lg:top-14 lg:h-[calc(100vh-56px)] lg:w-full">
            <Inspector sid={selected} onClose={() => { select(null); setVerdict(null) }} onTryMove={tryMove}
              verdict={verdict} onForce={force} onDismissVerdict={() => setVerdict(null)} busy={busy} />
          </div>
        </div>
      )}
    </div>
  )
}
