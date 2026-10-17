import { useState } from 'react'
import { Check, Download, Printer, Send, X } from 'lucide-react'
import { api, ApiError } from '../api'
import { useApp } from '../store'
import { Page } from '../components/Shell'
import { Button, Chip, ErrorBox, Mono, SectionHead } from '../components/ui'
import { catColor, isTeaching, slotLabel } from '../format'

export default function Publish() {
  const { active, data, L, adopt, toast, errMsg } = useApp()
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  if (!active || !data) return null
  const tc = data.dataset.time
  const v = active.validation

  const publish = async () => {
    setBusy(true)
    setErr(null)
    try {
      const r = await api.publish(active.record.id)
      await adopt(r)
      toast({ tone: 'ok', title: `${r.record.id} published`, body: `All ${v.checks.length} hard checks verified at ${new Date().toLocaleTimeString()}.` })
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : errMsg(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Page title="Export & publish" eyebrow={`07 · ${active.record.id} · ${active.record.label}`}
      actions={<>
        <a href={api.exportUrl(active.record.id)} download className="inline-flex h-9 items-center gap-2 border border-slate-200 bg-white px-3.5 text-sm hover:border-navy/40"><Download className="h-4 w-4" /> CSV</a>
        <Button onClick={() => window.print()}><Printer className="h-4 w-4" /> Print</Button>
      </>}>
      <div className="no-print grid gap-8 lg:grid-cols-[1fr_360px]">
        <section>
          <SectionHead index="A" title="Pre-publication verification" sub="Run by the independent validator on the exact assignments that would be published." />
          <ul className="grid gap-px border border-navy/15 bg-navy/10 sm:grid-cols-2">
            {v.checks.map(c => (
              <li key={c.code} className="flex items-center gap-2 bg-white px-3 py-2 text-xs">
                {c.passed ? <Check className="h-3.5 w-3.5 text-navy" strokeWidth={2.5} /> : <X className="h-3.5 w-3.5 text-conflict" strokeWidth={2.5} />}
                <span className={`flex-1 ${c.passed ? '' : 'text-conflict'}`}>{c.label}</span>
                <Mono className={c.passed ? 'text-slate' : 'text-conflict'}>{c.passed ? 'pass' : `${c.violations} fail`}</Mono>
              </li>
            ))}
          </ul>
        </section>
        <section>
          <SectionHead index="B" title="Publish" />
          <div className="border border-navy/15 bg-white p-4 text-sm">
            <div className="flex flex-wrap gap-2">
              <Chip tone={v.feasible ? 'lime' : 'red'}>{v.hard_count} hard violations</Chip>
              <Chip tone={v.complete ? 'lime' : 'red'}>{v.scheduled}/{v.required} sessions</Chip>
              <Chip tone="muted">{v.soft_count} soft misses</Chip>
            </div>
            {active.record.published
              ? <p className="mt-3"><Chip tone="navy">Published</Chip> <Mono className="ml-1 text-xs text-slate">{active.record.published_at}</Mono></p>
              : active.publishable
                ? <p className="mt-3 text-xs text-slate">Publishing marks this schedule final and un-publishes any other version.</p>
                : <p className="mt-3 text-xs text-conflict">This schedule cannot be published{['diagnostic', 'partial', 'draft'].includes(active.record.kind) ? ` (kind: ${active.record.kind})` : ''}. Resolve every hard violation first.</p>}
            <Button tone="accent" className="mt-4 w-full" onClick={publish} loading={busy} disabled={!active.publishable || active.record.published}>
              <Send className="h-4 w-4" /> {active.record.published ? 'Already published' : 'Mark as final & publish'}
            </Button>
            {err && <div className="mt-3"><ErrorBox title="Publication refused">{err}</ErrorBox></div>}
          </div>
        </section>
      </div>

      <div className="mt-10">
        <SectionHead index="C" title="Print preview · per batch" sub="Uses the browser’s print dialog; navigation is hidden in print." />
        {data.dataset.batches.map(b => {
          const items = active.record.assignments.filter(a => L.sessions[a.session_id]?.batch_ids.includes(b.id))
          return (
            <div key={b.id} className="print-page mb-8 border border-navy/20 bg-white p-4">
              <div className="mb-3 flex items-baseline justify-between border-b border-navy pb-2">
                <div><span className="font-display text-lg font-semibold">{b.name}</span> <Mono className="text-xs text-slate">{b.id} · {b.size} students</Mono></div>
                <Mono className="text-2xs text-slate">SCHEDULR IQ · {active.record.id}{active.record.published ? ' · PUBLISHED' : ' · DRAFT'}</Mono>
              </div>
              <table className="w-full table-fixed border-collapse text-[10px]">
                <thead><tr><th className="w-12" />{tc.days.map(d => <th key={d} className="border border-navy/15 py-1 font-display text-xs">{d}</th>)}</tr></thead>
                <tbody>
                  {Array.from({ length: tc.slots_per_day }, (_, t) => (
                    <tr key={t}>
                      <td className="pr-1 text-right align-top font-mono text-slate">{slotLabel(tc, t)}</td>
                      {tc.days.map((_, d) => {
                        const a = items.find(x => x.day === d && x.start <= t && t < x.start + (L.sessions[x.session_id]?.duration ?? 1))
                        if (a && a.start !== t) return null
                        const s = a && L.sessions[a.session_id]
                        const c = s && L.courses[s.course_id]
                        return (
                          <td key={d} rowSpan={s?.duration ?? 1} className={`h-9 border border-navy/15 px-1 align-top ${!a && !isTeaching(tc, d, t) ? 'hatch-break' : ''}`}
                            style={c ? { boxShadow: `inset 3px 0 0 ${catColor(c.category)}` } : undefined}>
                            {c && <><div className="font-mono font-medium">{c.code} <span className="text-slate">{c.course_type.slice(0, 3).toUpperCase()}</span></div><div className="truncate">{c.name}</div><div className="font-mono text-slate">{a!.room_id} · {L.faculty[a!.faculty_id]?.name}</div></>}
                          </td>
                        )
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        })}
      </div>
    </Page>
  )
}
