import type { TimeConfig } from './types'

export function slotLabel(tc: TimeConfig, slot: number) {
  const [h, m] = tc.day_start.split(':').map(Number)
  const t = h * 60 + m + slot * tc.slot_minutes
  return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`
}

export function whereLabel(tc: TimeConfig, day: number, start: number, dur: number) {
  return `${tc.days[day]} ${slotLabel(tc, start)}–${slotLabel(tc, start + dur)}`
}

export function isTeaching(tc: TimeConfig, day: number, slot: number) {
  const lim = tc.day_slots[day] ?? tc.slots_per_day
  return slot >= 0 && slot < Math.min(lim, tc.slots_per_day) && !tc.break_slots.includes(slot)
}

export const pct = (v: number, d = 1) => `${(v * 100).toFixed(d)}%`
export const mins = (v: number) => `${v.toLocaleString()} min`

export const CAT_COLOR: Record<string, string> = {
  cs: '#3D5A80', math: '#9A6B3F', ece: '#3F7A65', ds: '#7A5C8F', core: '#5A6378',
}
export const catColor = (c: string) => CAT_COLOR[c] || CAT_COLOR.core
export const CAT_LABEL: Record<string, string> = {
  cs: 'Computer Science', math: 'Mathematics', ece: 'Electronics', ds: 'Data Science', core: 'Core',
}

export function download(name: string, text: string, type = 'text/csv') {
  const url = URL.createObjectURL(new Blob([text], { type }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  URL.revokeObjectURL(url)
}

export const OBJECTIVES: { key: 'student_idle' | 'faculty_idle' | 'room_fit' | 'workload_balance' | 'preferences'; label: string; def: string }[] = [
  { key: 'student_idle', label: 'Student idle gaps', def: 'Teachable minutes between a batch’s first and last class each day not spent in class. Lunch break excluded. Minimized.' },
  { key: 'faculty_idle', label: 'Faculty idle gaps', def: 'Same gap definition per faculty member. Minimized.' },
  { key: 'room_fit', label: 'Room fit (seat waste)', def: 'Σ (room capacity − enrollment) × hours. Fewer empty seats ⇒ higher seat utilization and big halls stay free. Minimized.' },
  { key: 'workload_balance', label: 'Daily workload balance', def: 'Σ over batches & faculty of busiest-day hours above an even daily spread. Minimized.' },
  { key: 'preferences', label: 'Faculty preferences', def: 'Sessions placed in a faculty “prefers not to teach” window. Minimized (satisfaction maximized).' },
]
