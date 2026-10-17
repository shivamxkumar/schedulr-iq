import { useEffect, useMemo, useState } from 'react'
import type { TimeConfig, Window } from '../types'
import { isTeaching, slotLabel } from '../format'

export type CellState = 'free' | 'off' | 'pref'

export interface PainterMode { state: CellState; label: string; swatch: string }

const SW: Record<CellState, string> = {
  free: 'bg-white',
  off: 'bg-navy',
  pref: 'bg-slate-300',
}

/** Convert windows → per-cell map and back (contiguous runs per day). */
export function toCells(tc: TimeConfig, layers: { state: CellState; windows: Window[] }[]): CellState[][] {
  const g: CellState[][] = tc.days.map(() => Array(tc.slots_per_day).fill('free'))
  for (const { state, windows } of layers)
    for (const w of windows)
      for (let t = w.start; t < w.end; t++) if (g[w.day] && t < tc.slots_per_day) g[w.day][t] = state
  return g
}

export function toWindows(cells: CellState[][], state: CellState): Window[] {
  const out: Window[] = []
  cells.forEach((row, day) => {
    let start = -1
    row.forEach((c, t) => {
      if (c === state && start < 0) start = t
      if (c !== state && start >= 0) { out.push({ day, start, end: t }); start = -1 }
    })
    if (start >= 0) out.push({ day, start, end: row.length })
  })
  return out
}

interface Props {
  tc: TimeConfig
  cells: CellState[][]
  onChange: (cells: CellState[][]) => void
  modes: PainterMode[]
  disabled?: boolean
  overlay?: Record<string, string> // "d-t" -> short label (e.g. scheduled course code)
}

export default function AvailabilityPainter({ tc, cells, onChange, modes, disabled, overlay }: Props) {
  const [mode, setMode] = useState<CellState>(modes[1]?.state ?? 'off')
  const [painting, setPainting] = useState<CellState | null>(null)

  useEffect(() => {
    const up = () => setPainting(null)
    window.addEventListener('mouseup', up)
    return () => window.removeEventListener('mouseup', up)
  }, [])

  const editable = (d: number, t: number) => !disabled && isTeaching(tc, d, t)
  const set = (pairs: [number, number][], state: CellState) => {
    const next = cells.map(r => [...r])
    for (const [d, t] of pairs) if (editable(d, t)) next[d][t] = state
    onChange(next)
  }
  const counts = useMemo(() => {
    const c: Record<CellState, number> = { free: 0, off: 0, pref: 0 }
    cells.forEach((r, d) => r.forEach((s, t) => { if (isTeaching(tc, d, t)) c[s]++ }))
    return c
  }, [cells, tc])

  const toggleDay = (d: number) => {
    const slots = cells[d].map((_, t) => t).filter(t => editable(d, t))
    const all = slots.every(t => cells[d][t] === mode)
    set(slots.map(t => [d, t]), all ? 'free' : mode)
  }
  const toggleRow = (t: number) => {
    const ds = tc.days.map((_, d) => d).filter(d => editable(d, t))
    const all = ds.every(d => cells[d][t] === mode)
    set(ds.map(d => [d, t]), all ? 'free' : mode)
  }

  return (
    <div className="select-none">
      <div className="mb-2 flex flex-wrap items-center gap-1.5">
        <span className="mr-1 font-mono text-2xs uppercase tracking-wider text-slate">Paint</span>
        {modes.map(m => (
          <button key={m.state} type="button" disabled={disabled} onClick={() => setMode(m.state)}
            className={`flex h-7 items-center gap-1.5 border px-2 text-xs disabled:opacity-40 ${mode === m.state ? 'border-navy bg-lime' : 'border-slate-200 bg-white hover:border-navy/40'}`}>
            <span className={`h-3 w-3 border border-navy/30 ${m.swatch}`} />{m.label}
            <span className="font-mono text-2xs text-slate">{counts[m.state]}</span>
          </button>
        ))}
        <span className="ml-auto text-2xs text-slate">Click or drag cells · click a day or time to fill it</span>
      </div>
      <div className="overflow-x-auto border border-navy/15 bg-white">
        <table className="w-full min-w-[460px] border-collapse">
          <thead>
            <tr>
              <th className="w-14" />
              {tc.days.map((d, i) => (
                <th key={d} className="p-0">
                  <button type="button" disabled={disabled} onClick={() => toggleDay(i)} className="w-full py-1.5 font-mono text-2xs uppercase tracking-wider text-slate hover:bg-ivory hover:text-navy disabled:hover:bg-transparent">{d}</button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: tc.slots_per_day }, (_, t) => (
              <tr key={t}>
                <td className="p-0">
                  <button type="button" disabled={disabled} onClick={() => toggleRow(t)} className="w-full pr-2 text-right font-mono text-2xs text-slate hover:text-navy">{slotLabel(tc, t)}</button>
                </td>
                {tc.days.map((_, d) => {
                  const ok = isTeaching(tc, d, t)
                  const st = cells[d]?.[t] ?? 'free'
                  const lab = overlay?.[`${d}-${t}`]
                  return (
                    <td key={d} className="border border-navy/[0.07] p-0">
                      {ok ? (
                        <button type="button" disabled={disabled}
                          onMouseDown={() => { const target = st === mode ? 'free' : mode; setPainting(target); set([[d, t]], target) }}
                          onMouseEnter={() => painting && set([[d, t]], painting)}
                          title={`${tc.days[d]} ${slotLabel(tc, t)} · ${modes.find(m => m.state === st)?.label ?? 'Available'}${lab ? ` · scheduled: ${lab}` : ''}`}
                          className={`relative block h-7 w-full transition-colors ${SW[st]} ${!disabled ? 'hover:outline hover:outline-1 hover:outline-navy' : ''}`}>
                          {lab && <span className={`absolute inset-0 flex items-center justify-center font-mono text-[9px] ${st === 'off' ? 'text-lime' : 'text-navy'}`}>{lab}</span>}
                        </button>
                      ) : <span className={`block h-7 ${tc.break_slots.includes(t) ? 'hatch-break' : 'hatch-closed'}`} />}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
