import { useMemo, useState } from 'react'
import { session } from '../api'
import { Bar as RBar, BarChart, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Page } from '../components/Shell'
import { Bar, Button, Chip, ErrorBox, Mono, SectionHead } from '../components/ui'
import { isTeaching, pct, slotLabel } from '../format'
import { useApp } from '../store'
import type { Dataset, Window } from '../types'

type Tab = 'rooms' | 'faculty' | 'batches' | 'courses'
type EditKey = string // `${entity}:${id}:${field}`

const inWin = (ws: Window[], d: number, t: number) => ws.some(w => w.day === d && w.start <= t && t < w.end)

function NumIn({ value, onChange, min = 1 }: { value: number; onChange: (v: number) => void; min?: number }) {
  return (
    <input
      type="number" min={min} value={value}
      onChange={e => onChange(Math.max(min, Number(e.target.value) || min))}
      onClick={e => e.stopPropagation()}
      className="h-6 w-14 border border-slate-200 bg-white px-1 font-mono text-xs tabular-nums focus:border-navy focus:outline-none"
    />
  )
}

const tick = { fontFamily: '"JetBrains Mono", monospace', fontSize: 10, fill: '#778196' }

export default function Resources() {
  const { data, active, L, toast, errMsg, refresh, focus } = useApp()
  const [tab, setTab] = useState<Tab>('rooms')
  const [sel, setSel] = useState<string | null>(null)
  const [edits, setEdits] = useState<Record<EditKey, number>>({})
  const [saving, setSaving] = useState(false)
  const [saveErr, setSaveErr] = useState<string[] | null>(null)

  const occ = useMemo(() => {
    // key `${kind}:${id}:${day}:${slot}` -> session id
    const m: Record<string, string> = {}
    if (!active) return m
    for (const a of active.record.assignments) {
      const s = L.sessions[a.session_id]
      if (!s) continue
      for (let t = a.start; t < a.start + s.duration; t++) {
        m[`room:${a.room_id}:${a.day}:${t}`] = a.session_id
        m[`fac:${a.faculty_id}:${a.day}:${t}`] = a.session_id
      }
    }
    return m
  }, [active, L.sessions])

  if (!data) return null
  const ds = data.dataset
  const tc = ds.time
  const nEdits = Object.keys(edits).length
  const val = (entity: string, id: string, field: string, orig: number) => edits[`${entity}:${id}:${field}`] ?? orig
  const setVal = (entity: string, id: string, field: string, orig: number) => (v: number) => {
    const k = `${entity}:${id}:${field}`
    setEdits(e => {
      const n = { ...e }
      if (v === orig) delete n[k]
      else n[k] = v
      return n
    })
  }

  const save = async () => {
    setSaving(true)
    setSaveErr(null)
    const next: Dataset = JSON.parse(JSON.stringify(ds))
    for (const [k, v] of Object.entries(edits)) {
      const [entity, id, field] = k.split(':')
      const list = (next as any)[entity] as any[]
      const item = list.find(x => x.id === id)
      if (item) item[field] = v
    }
    try {
      const res = await fetch('/api/dataset', { method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.token}` }, body: JSON.stringify(next) })
      const body = await res.json().catch(() => null)
      if (!res.ok) {
        const d = body?.detail
        setSaveErr(d?.issues?.map((i: any) => `${i.entity} ${i.id} · ${i.message}`) ?? [typeof d === 'string' ? d : d?.message || `Save failed (${res.status})`])
        return
      }
      setEdits({})
      const gen = await fetch('/api/schedule/generate', { method: 'POST', headers: { Authorization: `Bearer ${session.token}` } })
      const g = await gen.json().catch(() => null)
      await refresh()
      if (!gen.ok) toast({ tone: 'error', title: 'Dataset saved, but scheduling failed', body: g?.detail?.message || `HTTP ${gen.status}` })
      else if (g?.status === 'infeasible') toast({ tone: 'error', title: 'Dataset saved · no feasible timetable', body: `${g.message} ${g.diagnostics?.[0] ?? ''}` })
      else toast({ tone: 'ok', title: 'Dataset saved', body: `New baseline ${g?.schedule?.record?.id ?? ''} generated and validated.` })
    } catch (e) {
      setSaveErr([errMsg(e)])
    } finally {
      setSaving(false)
    }
  }

  const days = tc.days.map((_, i) => i)
  const slots = Array.from({ length: tc.slots_per_day }, (_, i) => i)

  const OccMap = ({ kind, id, unavailable, dispreferred }: { kind: 'room' | 'fac'; id: string; unavailable: Window[]; dispreferred?: Window[] }) => (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[520px] border-collapse">
        <thead>
          <tr>
            <th className="w-12" />
            {slots.map(t => <th key={t} className="pb-1 font-mono text-2xs font-normal text-slate">{slotLabel(tc, t)}</th>)}
          </tr>
        </thead>
        <tbody>
          {days.map(d => (
            <tr key={d}>
              <td className="pr-1.5 text-right font-display text-sm font-semibold">{tc.days[d].slice(0, 2)}</td>
              {slots.map(t => {
                const sid = occ[`${kind}:${id}:${d}:${t}`]
                const brk = tc.break_slots.includes(t)
                const closed = !isTeaching(tc, d, t)
                const un = inWin(unavailable, d, t)
                const pref = dispreferred && inWin(dispreferred, d, t)
                const code = sid ? L.courses[L.sessions[sid]?.course_id]?.code : ''
                return (
                  <td key={t} className="p-[1.5px]">
                    {sid ? (
                      <button onClick={() => focus(sid, kind === 'room' ? { room: id } : { faculty: id })}
                        title={`${sid} · ${tc.days[d]} ${slotLabel(tc, t)} — open in Timetable`}
                        className="block h-6 w-full truncate bg-navy px-1 text-left font-mono text-[9px] text-ivory hover:bg-navy-600">{code}</button>
                    ) : (
                      <div title={brk ? 'Break' : closed ? 'Closed' : un ? 'Unavailable' : pref ? 'Prefers not to teach' : 'Free'}
                        className={`h-6 w-full font-mono text-[9px] leading-6 text-slate ${brk ? 'hatch-break' : closed || un ? 'hatch-closed' : pref ? 'bg-slate-200 px-1' : 'border border-navy/[0.08] bg-white'}`}>
                        {!brk && !closed && !un && pref ? 'pref' : ''}
                      </div>
                    )}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="mt-2 flex flex-wrap gap-3 font-mono text-2xs text-slate">
        <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 bg-navy" />occupied</span>
        <span className="flex items-center gap-1"><span className="hatch-closed h-2.5 w-2.5" />unavailable / closed</span>
        <span className="flex items-center gap-1"><span className="hatch-break h-2.5 w-2.5 border border-navy/10" />break</span>
        {dispreferred && <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 bg-slate-200" />prefers not (soft)</span>}
        <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 border border-navy/15 bg-white" />free</span>
      </div>
    </div>
  )

  const th = 'px-2 py-2 text-left font-mono text-2xs font-normal uppercase tracking-wider text-slate whitespace-nowrap'
  const td = 'px-2 py-1.5 align-middle'
  const rowCls = (id: string) => `cursor-pointer border-b border-navy/[0.06] ${sel === id ? 'bg-lime-50 shadow-[inset_3px_0_0_#D8FF66]' : 'hover:bg-ivory'}`
  const metRooms = Object.fromEntries((active?.metrics.rooms ?? []).map(r => [r.id, r]))
  const metFac = Object.fromEntries((active?.metrics.faculty ?? []).map(r => [r.id, r]))
  const metBatch = Object.fromEntries((active?.metrics.batches ?? []).map(r => [r.id, r]))

  const assignedFac = (cid: string) => {
    const set = new Set<string>()
    for (const a of active?.record.assignments ?? []) if (L.sessions[a.session_id]?.course_id === cid) set.add(a.faculty_id)
    return [...set]
  }

  return (
    <Page title="Resource Explorer" eyebrow="05 · Resources" actions={active && <Mono className="self-end text-2xs text-slate">Usage from {active.record.id} · {active.record.label}</Mono>}>
      <div className="mb-5 flex w-fit border border-navy/20 bg-white p-0.5" role="tablist">
        {(['rooms', 'faculty', 'batches', 'courses'] as Tab[]).map(t => (
          <button key={t} role="tab" aria-selected={tab === t} onClick={() => { setTab(t); setSel(null) }}
            className={`h-7 px-3 font-mono text-2xs uppercase tracking-wider ${tab === t ? 'bg-navy text-lime' : 'text-navy hover:bg-navy/5'}`}>
            {t} <span className="opacity-60">{t === 'rooms' ? ds.rooms.length : t === 'faculty' ? ds.faculty.length : t === 'batches' ? ds.batches.length : ds.courses.length}</span>
          </button>
        ))}
      </div>

      {tab === 'rooms' && (
        <>
          <SectionHead index="A" title="Classrooms & laboratories" sub="Room-time utilization = occupied slots ÷ available teachable slots. Seat utilization = enrolled seat-hours ÷ capacity seat-hours of scheduled sessions." />
          <div className="grid gap-6 xl:grid-cols-[1fr_340px]">
            <div className="overflow-x-auto border border-navy/10 bg-white">
              <table className="w-full min-w-[760px] text-sm">
                <thead className="border-b border-navy/15"><tr>
                  {['ID', 'Name', 'Type', 'Capacity', 'Equipment', 'Occupied', 'Room-time util.', 'Seat util.'].map(h => <th key={h} className={th}>{h}</th>)}
                </tr></thead>
                <tbody>
                  {ds.rooms.map(r => {
                    const m = metRooms[r.id]
                    return (
                      <tr key={r.id} className={rowCls(r.id)} onClick={() => setSel(sel === r.id ? null : r.id)}>
                        <td className={td}><Mono className="font-medium">{r.id}</Mono></td>
                        <td className={td}>{r.name}</td>
                        <td className={td}><Chip tone="muted">{r.room_type}</Chip></td>
                        <td className={td}><NumIn value={val('rooms', r.id, 'capacity', r.capacity)} onChange={setVal('rooms', r.id, 'capacity', r.capacity)} /></td>
                        <td className={td}><div className="flex flex-wrap gap-1">{r.equipment.length ? r.equipment.map(e => <Chip key={e}>{e}</Chip>) : <span className="text-xs text-slate">—</span>}</div></td>
                        <td className={td}><Mono className="text-xs">{m ? `${m.occupied_slots}/${m.available_slots}` : '—'}</Mono></td>
                        <td className={`${td} w-40`}>{m && <div className="flex items-center gap-2"><Bar value={m.utilization} className="w-20" /><Mono className="text-xs">{pct(m.utilization)}</Mono></div>}</td>
                        <td className={td}><Mono className="text-xs">{m?.seat_utilization != null ? pct(m.seat_utilization) : '—'}</Mono></td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            <div className="border border-navy/10 bg-white p-3">
              <div className="mb-2 font-mono text-2xs uppercase tracking-wider text-slate">Room-time utilization by room</div>
              <div className="h-[220px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={ds.rooms.map(r => ({ id: r.id, u: Math.round((metRooms[r.id]?.utilization ?? 0) * 1000) / 10 }))} layout="vertical" margin={{ left: 4, right: 24, top: 0, bottom: 0 }}>
                    <XAxis type="number" domain={[0, 100]} unit="%" tick={tick} axisLine={{ stroke: '#C5CAD4' }} tickLine={false} />
                    <YAxis type="category" dataKey="id" tick={tick} width={62} axisLine={false} tickLine={false} />
                    <Tooltip cursor={{ fill: 'rgba(23,36,59,0.04)' }} formatter={(v: any) => [`${v}%`, 'Utilization']} contentStyle={{ fontFamily: 'JetBrains Mono', fontSize: 11, border: '1px solid #17243B', borderRadius: 0 }} />
                    <RBar dataKey="u" barSize={10} onClick={(d: any) => setSel(d?.id ?? d?.payload?.id)}>
                      {ds.rooms.map(r => <Cell key={r.id} fill={sel === r.id ? '#D8FF66' : '#17243B'} stroke={sel === r.id ? '#17243B' : undefined} />)}
                    </RBar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>
          {sel && L.rooms[sel] && (
            <div className="fade-up mt-6">
              <SectionHead index="A.1" title={`Occupancy · ${sel}`} sub="Click an occupied cell to open that session in the Timetable Studio." />
              <OccMap kind="room" id={sel} unavailable={L.rooms[sel].unavailable} />
            </div>
          )}
        </>
      )}

      {tab === 'faculty' && (
        <>
          <SectionHead index="B" title="Faculty availability & teaching load" sub={`Load in teaching slots (1 slot = ${tc.slot_minutes} min). Bars turn red only when a load exceeds its maximum.`} />
          <div className="grid gap-6 xl:grid-cols-[1fr_340px]">
            <div className="overflow-x-auto border border-navy/10 bg-white">
              <table className="w-full min-w-[820px] text-sm">
                <thead className="border-b border-navy/15"><tr>
                  {['ID', 'Name', 'Department', 'Eligible courses', 'Weekly load / max', 'Max daily', 'Idle'].map(h => <th key={h} className={th}>{h}</th>)}
                </tr></thead>
                <tbody>
                  {ds.faculty.map(f => {
                    const m = metFac[f.id]
                    const maxW = val('faculty', f.id, 'max_weekly_slots', f.max_weekly_slots)
                    const over = (m?.weekly_slots ?? 0) > maxW
                    return (
                      <tr key={f.id} className={rowCls(f.id)} onClick={() => setSel(sel === f.id ? null : f.id)}>
                        <td className={td}><Mono className="font-medium">{f.id}</Mono></td>
                        <td className={`${td} whitespace-nowrap`}>{f.name}</td>
                        <td className={`${td} text-xs text-slate-600`}>{f.department}</td>
                        <td className={td}><Mono className="text-2xs">{f.courses.join(' · ')}</Mono></td>
                        <td className={`${td} w-52`}>
                          <div className="flex items-center gap-2">
                            <Bar value={m?.weekly_slots ?? 0} max={maxW} tone={over ? 'red' : 'navy'} className="w-16" />
                            <Mono className={`text-xs ${over ? 'text-conflict' : ''}`}>{m?.weekly_slots ?? 0}/</Mono>
                            <NumIn value={maxW} onChange={setVal('faculty', f.id, 'max_weekly_slots', f.max_weekly_slots)} />
                          </div>
                        </td>
                        <td className={td}><NumIn value={val('faculty', f.id, 'max_daily_slots', f.max_daily_slots)} onChange={setVal('faculty', f.id, 'max_daily_slots', f.max_daily_slots)} /></td>
                        <td className={td}><Mono className="text-xs">{m ? `${m.idle_minutes} min` : '—'}</Mono></td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            <div className="border border-navy/10 bg-white p-3">
              <div className="mb-2 flex items-center justify-between font-mono text-2xs uppercase tracking-wider text-slate">
                <span>Weekly load vs max (slots)</span>
                <span className="flex items-center gap-2"><span className="flex items-center gap-1"><span className="h-2 w-2 bg-navy" />load</span><span className="flex items-center gap-1"><span className="h-2 w-2 bg-slate-300" />max</span></span>
              </div>
              <div className="h-[260px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={ds.faculty.map(f => ({ id: f.id, load: metFac[f.id]?.weekly_slots ?? 0, max: f.max_weekly_slots }))} layout="vertical" barGap={1} margin={{ left: 0, right: 16, top: 0, bottom: 0 }}>
                    <XAxis type="number" tick={tick} axisLine={{ stroke: '#C5CAD4' }} tickLine={false} allowDecimals={false} />
                    <YAxis type="category" dataKey="id" tick={tick} width={34} axisLine={false} tickLine={false} />
                    <Tooltip cursor={{ fill: 'rgba(23,36,59,0.04)' }} contentStyle={{ fontFamily: 'JetBrains Mono', fontSize: 11, border: '1px solid #17243B', borderRadius: 0 }} />
                    <RBar dataKey="load" name="Load" barSize={8}>
                      {ds.faculty.map(f => <Cell key={f.id} fill={sel === f.id ? '#D8FF66' : '#17243B'} stroke={sel === f.id ? '#17243B' : undefined} />)}
                    </RBar>
                    <RBar dataKey="max" name="Max" barSize={3} fill="#C5CAD4" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>
          {sel && L.faculty[sel] && (
            <div className="fade-up mt-6">
              <SectionHead index="B.1" title={`Availability · ${L.faculty[sel].name}`} sub="Teaching, hard unavailability and soft “prefers not to teach” windows." />
              <OccMap kind="fac" id={sel} unavailable={L.faculty[sel].unavailable} dispreferred={L.faculty[sel].dispreferred} />
            </div>
          )}
        </>
      )}

      {tab === 'batches' && (
        <>
          <SectionHead index="C" title="Student batches & sections" sub="Idle = teachable minutes between a batch’s first and last class each day not spent in class (lunch excluded)." />
          <div className="overflow-x-auto border border-navy/10 bg-white">
            <table className="w-full min-w-[820px] text-sm">
              <thead className="border-b border-navy/15"><tr>
                {['ID', 'Name', 'Program', 'Size', 'Weekly hrs', 'Idle', 'Daily load (Mon–Sat)', 'Courses'].map(h => <th key={h} className={th}>{h}</th>)}
              </tr></thead>
              <tbody>
                {ds.batches.map(b => {
                  const m = metBatch[b.id]
                  const mx = Math.max(1, ...(m?.daily_slots ?? [1]))
                  return (
                    <tr key={b.id} className="border-b border-navy/[0.06] hover:bg-ivory">
                      <td className={td}><Mono className="font-medium">{b.id}</Mono></td>
                      <td className={td}>{b.name}</td>
                      <td className={`${td} text-xs text-slate-600`}>{b.program}</td>
                      <td className={td}><NumIn value={val('batches', b.id, 'size', b.size)} onChange={setVal('batches', b.id, 'size', b.size)} /></td>
                      <td className={td}><Mono className="text-xs">{m ? (m.weekly_slots * tc.slot_minutes / 60).toFixed(0) : '—'}</Mono></td>
                      <td className={td}><Mono className="text-xs">{m ? `${m.idle_minutes} min` : '—'}</Mono></td>
                      <td className={td}>
                        <div className="flex h-7 items-end gap-[3px]" title={(m?.daily_slots ?? []).map((v, i) => `${tc.days[i]} ${v}`).join(' · ')}>
                          {(m?.daily_slots ?? []).map((v, i) => (
                            <div key={i} className="flex w-3.5 flex-col items-center">
                              <div className="w-full bg-navy" style={{ height: `${(v / mx) * 20}px` }} />
                              <span className="font-mono text-[8px] leading-3 text-slate">{tc.days[i][0]}</span>
                            </div>
                          ))}
                        </div>
                      </td>
                      <td className={td}><Mono className="text-2xs">{ds.courses.filter(c => c.batch_ids.includes(b.id)).map(c => c.code).join(' · ')}</Mono></td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      {tab === 'courses' && (
        <>
          <SectionHead index="D" title="Course session requirements" sub="Enrollment = sum of attending batch sizes. All sessions of a course must be taught by one eligible faculty member." />
          <div className="overflow-x-auto border border-navy/10 bg-white">
            <table className="w-full min-w-[1040px] text-sm">
              <thead className="border-b border-navy/15"><tr>
                {['ID', 'Code', 'Name', 'Type', 'Batches', 'Sessions × slots', 'Enroll.', 'Room types', 'Equipment', 'Eligible faculty', 'Assigned'].map(h => <th key={h} className={th}>{h}</th>)}
              </tr></thead>
              <tbody>
                {ds.courses.map(c => {
                  const enroll = c.batch_ids.reduce((s, b) => s + (val('batches', b, 'size', ds.batches.find(x => x.id === b)?.size ?? 0)), 0)
                  const af = assignedFac(c.id)
                  return (
                    <tr key={c.id} className="border-b border-navy/[0.06] hover:bg-ivory">
                      <td className={td}><Mono className="text-xs">{c.id}</Mono></td>
                      <td className={td}><Mono className="font-medium">{c.code}</Mono></td>
                      <td className={`${td} whitespace-nowrap`}>{c.name}</td>
                      <td className={td}><Chip tone="muted">{c.course_type}</Chip></td>
                      <td className={td}><Mono className="text-2xs">{c.batch_ids.join(' + ')}</Mono></td>
                      <td className={td}>
                        <div className="flex items-center gap-1">
                          <NumIn value={val('courses', c.id, 'sessions_per_week', c.sessions_per_week)} onChange={setVal('courses', c.id, 'sessions_per_week', c.sessions_per_week)} />
                          <span className="text-slate">×</span>
                          <NumIn value={val('courses', c.id, 'duration_slots', c.duration_slots)} onChange={setVal('courses', c.id, 'duration_slots', c.duration_slots)} />
                        </div>
                      </td>
                      <td className={td}><Mono className="text-xs">{enroll}</Mono></td>
                      <td className={td}><Mono className="text-2xs">{c.room_types.join(' / ')}</Mono></td>
                      <td className={td}><Mono className="text-2xs">{c.equipment.join(', ') || '—'}</Mono></td>
                      <td className={td}><Mono className="text-2xs">{ds.faculty.filter(f => f.courses.includes(c.id)).map(f => f.id).join(' · ') || '—'}</Mono></td>
                      <td className={td}>
                        <div className="flex items-center gap-1">
                          <span className="whitespace-nowrap text-xs">{af.map(f => L.faculty[f]?.name ?? f).join(', ') || <span className="text-slate">—</span>}</span>
                          {af.length > 1 && <Chip tone="red">split!</Chip>}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      {saveErr && <div className="mt-4"><ErrorBox title="Dataset rejected"><ul className="list-disc pl-4">{saveErr.map((m, i) => <li key={i}>{m}</li>)}</ul></ErrorBox></div>}

      {nEdits > 0 && (
        <div className="sticky bottom-16 z-20 mt-6 flex flex-wrap items-center gap-3 border border-navy bg-white px-4 py-3 shadow-[0_6px_24px_-12px_rgba(23,36,59,0.4)] md:bottom-4">
          <Mono className="bg-lime px-1.5 text-xs">{nEdits}</Mono>
          <span className="text-sm">unsaved change{nEdits > 1 ? 's' : ''} · <span className="text-slate">Saving replaces the dataset and clears existing schedules (a new baseline must be generated).</span></span>
          <div className="ml-auto flex gap-2">
            <Button size="sm" tone="ghost" onClick={() => { setEdits({}); setSaveErr(null) }}>Discard</Button>
            <Button size="sm" tone="primary" loading={saving} onClick={save}>Save & regenerate</Button>
          </div>
        </div>
      )}
    </Page>
  )
}

