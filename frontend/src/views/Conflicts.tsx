import { useEffect, useState } from 'react'
import { Check, ExternalLink, ShieldCheck, Wand2, X } from 'lucide-react'
import { api } from '../api'
import { useApp } from '../store'
import type { CheckResult, ConflictItem } from '../types'
import { Page } from '../components/Shell'
import { Button, Chip, Empty, ErrorBox, Mono, SectionHead, Spinner } from '../components/ui'
import { whereLabel } from '../format'

const FIX_HINT: Record<string, string> = {
  FACULTY_OVERLAP: 'Move one session to a slot where the faculty member is free, or reassign to another eligible teacher.',
  ROOM_OVERLAP: 'Keep the time and switch one session to another free suitable room, or move it.',
  BATCH_OVERLAP: 'Students cannot attend both: move one session to a slot free for every batch involved.',
  ROOM_CAPACITY: 'Use a room with at least as many seats as the enrollment.',
  ROOM_TYPE: 'Use a room of the required type (e.g. lab for laboratory sessions).',
  ROOM_EQUIPMENT: 'Use a room that has the required equipment.',
  FACULTY_UNAVAILABLE: 'Move into the faculty member’s availability window.',
  ROOM_UNAVAILABLE: 'Move to a time when the room is open, or switch room.',
  INVALID_TIME: 'Keep the whole block inside operating hours and outside breaks.',
  MISSING_SESSION: 'Schedule the session — re-run the optimizer for a complete timetable.',
  FACULTY_NOT_ELIGIBLE: 'Assign a faculty member listed as eligible for this course.',
  COURSE_SAME_DAY: 'Spread the course’s sessions across different days.',
  FACULTY_DAILY_LOAD: 'Move a session of this faculty member to a lighter day.',
  FACULTY_WEEKLY_LOAD: 'Reassign a course to another eligible teacher.',
  TEACHER_CONSISTENCY: 'Use one teacher for every session of the course.',
  LUNCH_BREAK: 'Move one class out of the lunch window that day so the class gets a free lunch hour (or re-run the optimizer).',
}

export default function Conflicts() {
  const { active, data, focus, adopt, activate, toast, errMsg, baseline } = useApp()
  const [res, setRes] = useState<{ hard: ConflictItem[]; soft: ConflictItem[]; checks: CheckResult[] } | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const id = active?.record.id

  useEffect(() => {
    if (!id) return
    let live = true
    setRes(null)
    setErr(null)
    api.conflicts(id).then(r => live && setRes(r)).catch(e => live && setErr(errMsg(e)))
    return () => { live = false }
  }, [id]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!data || !active) return null
  const tc = data.dataset.time

  const apply = async (c: ConflictItem, i: number) => {
    const s = c.suggestions[i]
    setBusy(`${c.code}-${i}`)
    try {
      const r = await api.move(active.record.id, { session_id: s.session_id, day: s.assignment.day, start: s.assignment.start, room_id: s.assignment.room_id, faculty_id: s.assignment.faculty_id, commit: true, force: true })
      if (r.schedule) {
        const parent = active.record.id
        await adopt(r.schedule)
        toast({ tone: 'ok', title: `Applied fix for ${s.session_id}`, body: `${r.schedule.record.id}: ${r.schedule.validation.hard_count} hard violations remain.`, action: { label: 'Undo', run: () => activate(parent) } })
      }
    } catch (e) {
      toast({ tone: 'error', title: 'Fix failed', body: errMsg(e) })
    } finally {
      setBusy(null)
    }
  }

  const makeDiagnostic = async () => {
    setBusy('diag')
    try {
      const v = await api.diagnostic((baseline || active).record.id)
      await adopt(v)
      toast({ tone: 'info', title: `Diagnostic example ${v.record.id} created`, body: 'A deliberately corrupted copy for demonstrating detection. It can never be published.' })
    } catch (e) {
      toast({ tone: 'error', title: 'Could not create example', body: errMsg(e) })
    } finally {
      setBusy(null)
    }
  }

  const grouped = (res?.hard || []).reduce<Record<string, ConflictItem[]>>((acc, c) => { (acc[c.code] ||= []).push(c); return acc }, {})

  return (
    <Page title="Conflict Inspector" eyebrow={`04 · Independent validator · ${active.record.id}`}
      actions={<Button onClick={makeDiagnostic} loading={busy === 'diag'} title="Create a deliberately corrupted copy to demonstrate detection"><Wand2 className="h-4 w-4" /> Load diagnostic example</Button>}>
      {active.record.kind === 'diagnostic' && (
        <div className="mb-6 border border-navy bg-white px-4 py-3 text-sm">
          <Chip tone="red">Diagnostic example</Chip>
          <span className="ml-2">{active.record.solver.method}</span>
        </div>
      )}
      {err && <ErrorBox title="Validator request failed">{err}</ErrorBox>}
      {!res && !err && <Spinner label="Re-validating every constraint and searching validated fixes…" />}
      {res && (
        <div className="grid gap-8 xl:grid-cols-[1fr_320px]">
          <div className="min-w-0 space-y-8">
            <section>
              <SectionHead index="A" title={`Hard violations · ${res.hard.length}`} sub="Never permitted in a publishable timetable. Suggestions are re-validated before being offered." />
              {res.hard.length === 0 ? (
                <Empty icon={<ShieldCheck className="h-7 w-7 text-navy" />} title="No hard-constraint violations"
                  body={`${active.record.id} passes all ${res.checks.length} hard checks. Generated schedules are always valid; to see the inspector at work, load the labelled diagnostic example.`} />
              ) : Object.entries(grouped).map(([code, items]) => (
                <div key={code} className="mb-5">
                  <div className="mb-2 flex items-center gap-2"><Chip tone="red">{code.replace(/_/g, ' ')}</Chip><Mono className="text-xs text-slate">× {items.length}</Mono></div>
                  <div className="divide-y divide-navy/[0.06] border border-conflict/30 bg-white">
                    {items.map((c, k) => (
                      <div key={k} className="px-4 py-3">
                        <div className="text-sm font-medium">{c.message}</div>
                        <div className="mt-1.5 flex flex-wrap gap-x-5 gap-y-1 font-mono text-2xs text-slate">
                          {c.session_ids.length > 0 && <span>sessions: {c.session_ids.join(', ')}</span>}
                          {c.day != null && <span>slot: {whereLabel(tc, c.day, c.start ?? 0, Math.max(1, (c.end ?? (c.start ?? 0) + 1) - (c.start ?? 0)))}</span>}
                          {c.resource_id && <span>{c.resource_kind}: {c.resource_id}</span>}
                        </div>
                        <p className="mt-1.5 text-xs text-navy/75">Corrective action: {FIX_HINT[c.code] || 'Adjust the assignment.'}</p>
                        <div className="mt-2.5 flex flex-wrap items-center gap-2">
                          {c.session_ids[0] && (
                            <Button size="sm" tone="ghost" onClick={() => focus(c.session_ids[c.session_ids.length - 1], c.resource_kind === 'batch' ? { batch: c.resource_id! } : c.resource_kind === 'room' ? { room: c.resource_id! } : c.resource_kind === 'faculty' ? { faculty: c.resource_id! } : {})}>
                              <ExternalLink className="h-3.5 w-3.5" /> Show in timetable
                            </Button>
                          )}
                          {c.suggestions.map((s, i) => (
                            <Button key={i} size="sm" tone={i === 0 ? 'accent' : 'outline'} loading={busy === `${c.code}-${i}`} onClick={() => apply(c, i)} title={`Validated: introduces no hard violation for ${s.session_id}. Soft score Δ ${s.score_delta >= 0 ? '+' : ''}${s.score_delta.toFixed(3)}`}>
                              <Mono className="text-2xs">{s.session_id}</Mono> → {s.label}
                            </Button>
                          ))}
                          {c.suggestions.length === 0 && c.code !== 'FACULTY_DAILY_LOAD' && <span className="text-xs text-slate">No single validated move found — re-run the optimizer.</span>}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </section>

            <section>
              <SectionHead index="B" title={`Soft preference misses · ${res.soft.length}`} sub="Preferences are optimized, never enforced. They are never counted as conflicts." />
              {res.soft.length === 0 ? <p className="text-sm text-slate">Every faculty teaching preference is satisfied.</p> : (
                <div className="divide-y divide-navy/[0.06] border border-navy/15 bg-white">
                  {res.soft.map((c, i) => (
                    <button key={i} onClick={() => focus(c.session_ids[0], { faculty: c.resource_id || '' })} className="flex w-full items-center gap-3 px-4 py-2 text-left text-sm hover:bg-ivory/70">
                      <Chip tone="muted">pref</Chip><span className="flex-1">{c.message}</span><Mono className="text-2xs text-slate">{c.session_ids[0]}</Mono>
                    </button>
                  ))}
                </div>
              )}
            </section>
          </div>

          <aside>
            <SectionHead title="Hard checks" sub="Recomputed from raw data, independent of the solver." />
            <ul className="divide-y divide-navy/[0.06] border border-navy/15 bg-white">
              {res.checks.map(c => (
                <li key={c.code} className="flex items-center gap-2 px-3 py-1.5 text-xs">
                  {c.passed ? <Check className="h-3.5 w-3.5 text-navy" strokeWidth={2.5} /> : <X className="h-3.5 w-3.5 text-conflict" strokeWidth={2.5} />}
                  <span className={`flex-1 ${c.passed ? '' : 'text-conflict'}`}>{c.label}</span>
                  <Mono className={c.passed ? 'text-slate' : 'text-conflict'}>{c.violations}</Mono>
                </li>
              ))}
            </ul>
          </aside>
        </div>
      )}
    </Page>
  )
}
